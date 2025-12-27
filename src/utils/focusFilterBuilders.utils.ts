import { calculateEffectiveDateBoundaries, parseDateInTimezone } from './timezone.utils';
import { addMidnightRecordDurationAdjustment, addYearAgnosticMidnightAdjustment } from './focus.utils';
import { Types, PipelineStage } from 'mongoose';
import { MongooseFilter } from '../types/aggregation';

// ============================================================================
// Focus Records - App Source Mapping
// ============================================================================

export const APP_SOURCE_MAPPING: Record<string, string> = {
	'session-app': 'FocusRecordSession',
	'be-focused-app': 'FocusRecordBeFocused',
	'forest-app': 'FocusRecordForest',
	'tide-ios-app': 'FocusRecordTide',
	'TickTick': 'FocusRecordTickTick'
};

// ============================================================================
// Focus Records - Search Filter
// ============================================================================

export function buildFocusSearchFilter(searchQuery?: string) {
	if (!searchQuery || !searchQuery.trim()) {
		return null;
	}

	const trimmedQuery = searchQuery.trim();
	return {
		$or: [
			{ note: { $regex: trimmedQuery, $options: 'i' } },
			{ tasks: { $elemMatch: { title: { $regex: trimmedQuery, $options: 'i' } } } },
			{ tasks: { $elemMatch: { projectName: { $regex: trimmedQuery, $options: 'i' } } } }
		]
	};
}

// ============================================================================
// Focus Records - Month-Day Filter (Year-Agnostic)
// ============================================================================

/**
 * Builds MongoDB filter conditions for month-day range filtering (year-agnostic).
 * Handles both same-year ranges (e.g., Mar 15 - May 20) and cross-year ranges (e.g., Dec 25 - Jan 5).
 *
 * @param startDate - Start date string (e.g., "December 25, 2024")
 * @param endDate - End date string (e.g., "January 5, 2025")
 * @param timezone - IANA timezone string
 * @param fieldPrefix - Field to filter on ('startTime' or 'endTime')
 * @returns MongoDB filter condition using $expr
 */
function buildMonthDayFilter(
	startDate: string | undefined,
	endDate: string | undefined,
	timezone: string,
	fieldPrefix: 'startTime' | 'endTime'
): MongooseFilter | null {
	if (!startDate && !endDate) {
		return null;
	}

	const tz = timezone || 'UTC';

	// Parse dates to extract month and day
	const parseMonthDay = (dateString: string) => {
		const date = new Date(dateString + ' 00:00:00 UTC');
		return {
			month: date.getUTCMonth() + 1,  // 1 through 12
			day: date.getUTCDate()           // 1 through 31
		};
	};

	// Parse start and end dates once (only if present)
	const start = startDate ? parseMonthDay(startDate) : null;
	const end = endDate ? parseMonthDay(endDate) : null;

	// Helper to build "on or after" month-day condition
	const buildOnOrAfterCondition = (month: number, day: number) => {
		return {
			$or: [
				{ $gt: [{ $month: { date: `$${fieldPrefix}`, timezone: tz } }, month] },
				{
					$and: [
						{ $eq: [{ $month: { date: `$${fieldPrefix}`, timezone: tz } }, month] },
						{ $gte: [{ $dayOfMonth: { date: `$${fieldPrefix}`, timezone: tz } }, day] }
					]
				}
			]
		};
	};

	// Helper to build "on or before" month-day condition
	const buildOnOrBeforeCondition = (month: number, day: number) => {
		return {
			$or: [
				{ $lt: [{ $month: { date: `$${fieldPrefix}`, timezone: tz } }, month] },
				{
					$and: [
						{ $eq: [{ $month: { date: `$${fieldPrefix}`, timezone: tz } }, month] },
						{ $lte: [{ $dayOfMonth: { date: `$${fieldPrefix}`, timezone: tz } }, day] }
					]
				}
			]
		};
	};

	if (start && end) {

		// Check if range crosses year boundary (e.g., Dec 25 to Jan 5)
		const crossesYear = start.month > end.month ||
			(start.month === end.month && start.day > end.day);

		if (crossesYear) {
			// Range crosses year boundary: Dec 25-31 OR Jan 1-5
			return {
				$expr: {
					$or: [
						buildOnOrAfterCondition(start.month, start.day),
						buildOnOrBeforeCondition(end.month, end.day)
					]
				}
			};
		} else {
			// Normal range within calendar year: month-day >= start AND month-day <= end
			return {
				$expr: {
					$and: [
						buildOnOrAfterCondition(start.month, start.day),
						buildOnOrBeforeCondition(end.month, end.day)
					]
				}
			};
		}
	} else if (start) {
		// Only start date specified: month-day >= start
		return {
			$expr: buildOnOrAfterCondition(start.month, start.day)
		};
	} else if (end) {
		// Only end date specified: month-day <= end
		return {
			$expr: buildOnOrBeforeCondition(end.month, end.day)
		};
	}

	return null;
}

// ============================================================================
// Focus Records - Match and Filter Conditions
// ============================================================================

export function buildFocusMatchAndFilterConditions(
	userId: Types.ObjectId,
	taskId: string | undefined,
	projectIds: string[],
	startDate: string | undefined,
	endDate: string | undefined,
	taskIdIncludeFocusRecordsFromSubtasks: boolean,
	appSources: string[],
	crossesMidnight?: boolean,
	intervalStartDate?: string | null,
	intervalEndDate?: string | null,
	emotions?: string[],
	timezone?: string,
	general?: string[],
	yearAgnostic?: boolean
) {
	// Validate userId is provided - critical for data isolation
	if (!userId) {
		throw new Error('buildFocusMatchAndFilterConditions requires userId parameter');
	}

	const focusRecordMatchConditions: MongooseFilter = {};
	const taskFilterConditions: MongooseFilter[] = [];
	const andedOrConditions: MongooseFilter[] = []; // Collect all $or conditions here to be AND-ed together

	// Add userId filter - critical for data isolation
	focusRecordMatchConditions.userId = userId;

	// Two-tier date filtering:
	// 1. First tier: Filter Sidebar dates (startDate, endDate) - broad filter at MongoDB level
	// 2. Second tier: Interval Dropdown dates (intervalStartDate, intervalEndDate) - will be applied later in pipeline

	// Add first tier date range to match conditions (Filter Sidebar)
	// Include records where EITHER startTime OR endTime falls within the date range
	// This ensures records that cross midnight are included on both days
	if (startDate || endDate) {
		const tz = timezone || 'UTC';

		if (yearAgnostic) {
			// Year-agnostic filtering: Match records where EITHER startTime OR endTime falls within month-day range
			const startTimeFilter = buildMonthDayFilter(startDate, endDate, tz, 'startTime');
			const endTimeFilter = buildMonthDayFilter(startDate, endDate, tz, 'endTime');

			if (startTimeFilter && endTimeFilter) {
				andedOrConditions.push({
					$or: [
						startTimeFilter,
						endTimeFilter
					]
				});
			}
		} else {
			// Regular year-specific filtering (existing logic)
			const startBoundary = startDate ? parseDateInTimezone(startDate, tz) : null;
			let endBoundary = null;
			if (endDate) {
				// Parse the end date, then add 1 day to the date string BEFORE parsing
				// This ensures DST transitions are handled correctly
				const endDateObj = new Date(endDate + ' 00:00:00 UTC');
				endDateObj.setUTCDate(endDateObj.getUTCDate() + 1);
				const nextDayFormatted = endDateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
				endBoundary = parseDateInTimezone(nextDayFormatted, tz);
			}

			// Build $or condition: record is included if it starts OR ends within the range
			const dateConditions = [];

			if (startBoundary && endBoundary) {
				// Both start and end date specified
				dateConditions.push({
					startTime: { $gte: startBoundary, $lt: endBoundary }
				});
				dateConditions.push({
					endTime: { $gt: startBoundary, $lte: endBoundary }
				});
			} else if (startBoundary) {
				// Only start date specified
				dateConditions.push({ startTime: { $gte: startBoundary } });
				dateConditions.push({ endTime: { $gt: startBoundary } });
			} else if (endBoundary) {
				// Only end date specified
				dateConditions.push({ startTime: { $lt: endBoundary } });
				dateConditions.push({ endTime: { $lte: endBoundary } });
			}

			if (dateConditions.length > 0) {
				andedOrConditions.push({ $or: dateConditions });
			}
		}
	}

	// Add second tier date range filter (Interval Dropdown)
	// This will be applied after the first tier filter
	if (intervalStartDate || intervalEndDate) {
		const tz = timezone || 'UTC';
		const intervalStartBoundary = intervalStartDate ? parseDateInTimezone(intervalStartDate, tz) : null;
		let intervalEndBoundary = null;
		if (intervalEndDate) {
			// Parse the end date, then add 1 day to the date string BEFORE parsing
			// This ensures DST transitions are handled correctly
			const endDateObj = new Date(intervalEndDate + ' 00:00:00 UTC');
			endDateObj.setUTCDate(endDateObj.getUTCDate() + 1);
			const nextDayFormatted = endDateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
			intervalEndBoundary = parseDateInTimezone(nextDayFormatted, tz);
		}

		// Build interval date conditions
		const intervalDateConditions = [];

		if (intervalStartBoundary && intervalEndBoundary) {
			// Both interval start and end date specified
			intervalDateConditions.push({
				startTime: { $gte: intervalStartBoundary, $lt: intervalEndBoundary }
			});
			intervalDateConditions.push({
				endTime: { $gt: intervalStartBoundary, $lte: intervalEndBoundary }
			});
		} else if (intervalStartBoundary) {
			// Only interval start date specified
			intervalDateConditions.push({ startTime: { $gte: intervalStartBoundary } });
			intervalDateConditions.push({ endTime: { $gt: intervalStartBoundary } });
		} else if (intervalEndBoundary) {
			// Only interval end date specified
			intervalDateConditions.push({ startTime: { $lt: intervalEndBoundary } });
			intervalDateConditions.push({ endTime: { $lte: intervalEndBoundary } });
		}

		if (intervalDateConditions.length > 0) {
			andedOrConditions.push({ $or: intervalDateConditions });
		}
	}

	// Add app source filter
	if (appSources.length > 0) {
		focusRecordMatchConditions.source = { $in: appSources };
	}

	// Add emotions filter
	if (emotions && emotions.length > 0) {
		// Check if "none" is included
		const hasNoEmotions = emotions.includes('none');
		const regularEmotions = emotions.filter(e => e !== 'none');

		if (hasNoEmotions && regularEmotions.length > 0) {
			// Include both records with no emotions AND records with the specified emotions
			andedOrConditions.push({
				$or: [
					{ $or: [{ emotions: [] }, { emotions: null }, { emotions: { $exists: false } }] },
					{ "emotions.emotion": { $in: regularEmotions } }
				]
			});
		} else if (hasNoEmotions) {
			// Only filter for records with no emotions
			andedOrConditions.push({
				$or: [
					{ emotions: [] },
					{ emotions: null },
					{ emotions: { $exists: false } }
				]
			});
		} else {
			// Only filter for regular emotions - no $or needed
			focusRecordMatchConditions["emotions.emotion"] = { $in: emotions };
		}
	}

	// Extract note filter booleans from general array
	const showOnlyWithNotes = general?.includes('with-notes') ?? false;
	const showOnlyWithoutNotes = general?.includes('without-notes') ?? false;

	// Add note filtering (mutually exclusive in UI, but defensive check here)
	if (showOnlyWithNotes && !showOnlyWithoutNotes) {
		// Only show records with notes (note exists, not null, and has length > 0)
		andedOrConditions.push({
			$and: [
				{ note: { $exists: true } },
				{ note: { $ne: null } },
				{ note: { $ne: '' } }
			]
		});
	} else if (showOnlyWithoutNotes && !showOnlyWithNotes) {
		// Only show records without notes (note doesn't exist, is null, or is empty)
		andedOrConditions.push({
			$or: [
				{ note: { $exists: false } },
				{ note: null },
				{ note: '' }
			]
		});
	}
	// If both are true (shouldn't happen with UI logic), ignore both filters

	// Extract tracking mode filter booleans from general array
	const showOnlyPomodoro = general?.includes('pomodoro-mode') ?? false;
	const showOnlyStopwatch = general?.includes('stopwatch-mode') ?? false;

	// Add tracking mode filtering
	if (showOnlyPomodoro && !showOnlyStopwatch) {
		// Only show pomodoro records
		focusRecordMatchConditions.trackingMode = 'pomodoro';
	} else if (showOnlyStopwatch && !showOnlyPomodoro) {
		// Only show stopwatch records
		focusRecordMatchConditions.trackingMode = 'stopwatch';
	} else if (showOnlyPomodoro && showOnlyStopwatch) {
		// Both selected - show records with either tracking mode
		focusRecordMatchConditions.trackingMode = { $in: ['pomodoro', 'stopwatch'] };
	}
	// If neither is selected, no filter is applied

	// Add crossesMidnight filter (only when explicitly true)
	if (crossesMidnight === true) {
		focusRecordMatchConditions.crossesMidnight = true;
	}

	// Add project filter
	if (projectIds.length > 0) {
		focusRecordMatchConditions["tasks.projectId"] = { $in: projectIds };
		taskFilterConditions.push({ $in: ["$$task.projectId", projectIds] });
	}

	// Add task filter
	if (taskId) {
		if (taskIdIncludeFocusRecordsFromSubtasks) {
			andedOrConditions.push({
				$or: [
					{ "tasks.taskId": taskId },
					{ "tasks.ancestorIds": taskId }
				]
			});

			taskFilterConditions.push({
				$or: [
					{ $eq: ["$$task.taskId", taskId] },
					{ $in: [taskId, "$$task.ancestorIds"] }
				]
			});
		} else {
			focusRecordMatchConditions["tasks.taskId"] = taskId;
			taskFilterConditions.push({ $eq: ["$$task.taskId", taskId] });
		}
	}

	// Combine all $or conditions with $and at the end
	if (andedOrConditions.length > 0) {
		focusRecordMatchConditions.$and = andedOrConditions;
	}

	return { focusRecordMatchConditions, taskFilterConditions };
}

// ============================================================================
// Focus Records - Base Pipeline
// ============================================================================

export function buildFocusBasePipeline(searchFilter: MongooseFilter | null, focusRecordMatchConditions: MongooseFilter) {
	const pipeline: PipelineStage[] = [];

	if (searchFilter) {
		pipeline.push({ $match: searchFilter });
	}

	if (Object.keys(focusRecordMatchConditions).length > 0) {
		pipeline.push({ $match: focusRecordMatchConditions });
	}

	return pipeline;
}

// ============================================================================
// Focus Records - Task Duration Calculation
// ============================================================================

/**
 * Adds task duration calculation stages to the pipeline.
 * This is shared logic for both challenges and medals services.
 */
export function addFocusTaskDurationCalculation(
	pipeline: PipelineStage[],
	taskFilterConditions: MongooseFilter[]
) {
	const hasTaskOrProjectFilters = taskFilterConditions.length > 0;

	if (hasTaskOrProjectFilters) {
		// Filter tasks based on conditions
		pipeline.push({
			$addFields: {
				filteredTasks: {
					$filter: {
						input: "$tasks",
						as: "task",
						cond: taskFilterConditions.length > 1
							? { $and: taskFilterConditions }
							: taskFilterConditions[0]
					}
				}
			}
		});

		// Calculate duration from filtered tasks
		pipeline.push({
			$addFields: {
				tasksDuration: {
					$reduce: {
						input: "$filteredTasks",
						initialValue: 0,
						in: { $add: ["$$value", "$$this.duration"] }
					}
				}
			}
		});
	} else {
		// No filters: calculate duration from all tasks
		pipeline.push({
			$addFields: {
				tasksDuration: {
					$reduce: {
						input: "$tasks",
						initialValue: 0,
						in: { $add: ["$$value", "$$this.duration"] }
					}
				}
			}
		});
	}
}

/**
 * Filters tasks array and recalculates duration based on filtered tasks.
 * Replaces the original tasks array and duration in-place.
 * Used by focusRecordsService and statsFocusService.
 *
 * @param pipeline - The aggregation pipeline to add stages to
 * @param taskFilterConditions - Conditions to filter tasks by
 * @param preserveOriginalDuration - If true, stores original duration before filtering
 */
export function addTaskFilteringAndDurationRecalculation(
	pipeline: PipelineStage[],
	taskFilterConditions: MongooseFilter[],
	preserveOriginalDuration: boolean = false
) {
	const hasTaskOrProjectFilters = taskFilterConditions.length > 0;

	if (hasTaskOrProjectFilters) {
		// Optionally preserve original duration before filtering
		if (preserveOriginalDuration) {
			pipeline.push({
				$addFields: {
					originalDuration: "$duration"
				}
			});
		}

		// Filter the tasks array to only include tasks that match our conditions
		// Example: if filtering by projectId 'abc', only keep tasks with projectId 'abc'
		pipeline.push({
			$addFields: {
				tasks: {
					$filter: {
						input: "$tasks",
						as: "task",
						cond: taskFilterConditions.length > 1
							? { $and: taskFilterConditions }
							: taskFilterConditions[0]
					}
				}
			}
		});

		// Recalculate duration based on filtered tasks only
		// Sums up the duration of each remaining task in the filtered array
		pipeline.push({
			$addFields: {
				duration: {
					$reduce: {
						input: "$tasks",
						initialValue: 0,
						in: { $add: ["$$value", "$$this.duration"] }
					}
				}
			}
		});
	}
}

// ============================================================================
// Focus Records - Totals Calculation Pipeline
// ============================================================================

/**
 * Builds a pipeline to calculate total counts and durations.
 * Returns both focus-record-level totals and task-level totals.
 * Extracted from focusRecordsService lines 97-182.
 */
export function buildFocusTotalsCalculationPipeline(
	basePipeline: PipelineStage[],
	taskFilterConditions: MongooseFilter[]
): PipelineStage[] {
	const hasTaskOrProjectFilters = taskFilterConditions.length > 0;
	const pipeline = [...basePipeline];

	if (hasTaskOrProjectFilters) {
		// Step 1: Store original duration and create a filtered tasks array
		pipeline.push({
			$addFields: {
				originalDuration: "$duration",
				filteredTasks: {
					$filter: {
						input: "$tasks",
						as: "task",
						cond: taskFilterConditions.length > 1
							? { $and: taskFilterConditions }
							: taskFilterConditions[0]
					}
				}
			}
		});

		// Step 2: Calculate the total duration of just the filtered tasks
		pipeline.push({
			$addFields: {
				filteredTasksDuration: {
					$reduce: {
						input: "$filteredTasks",
						initialValue: 0,
						in: { $add: ["$$value", "$$this.duration"] }
					}
				}
			}
		});

		// Step 3: Aggregate across ALL focus records to get totals
		pipeline.push({
			$group: {
				_id: null,
				total: { $sum: 1 },
				totalDuration: { $sum: "$originalDuration" },
				onlyTasksTotalDuration: { $sum: "$filteredTasksDuration" }
			}
		});
	} else {
		// Simple case (no task/project filters): use $facet to calculate 3 things in parallel
		pipeline.push({
			$facet: {
				// Pipeline 1: Count total number of focus records
				count: [{ $count: "total" }],

				// Pipeline 2: Sum up all focus record durations
				baseDuration: [
					{
						$group: {
							_id: null,
							total: { $sum: "$duration" }
						}
					}
				],

				// Pipeline 3: Sum up individual task durations
				tasksDuration: [
					{ $unwind: { path: "$tasks", preserveNullAndEmptyArrays: true } },
					{
						$group: {
							_id: null,
							total: { $sum: "$tasks.duration" }
						}
					}
				]
			}
		});
	}

	return pipeline;
}

/**
 * Extracts totals from the aggregation result.
 * Handles both filtered and non-filtered cases.
 * Extracted from focusRecordsService lines 186-198.
 */
export function extractFocusTotalsFromResult(
	result: Record<string, unknown>[],
	hasTaskOrProjectFilters: boolean
): { total: number; totalDuration: number; onlyTasksTotalDuration: number } {
	if (hasTaskOrProjectFilters) {
		return {
			total: (result[0]?.total as number) || 0,
			totalDuration: (result[0]?.totalDuration as number) || 0,
			onlyTasksTotalDuration: (result[0]?.onlyTasksTotalDuration as number) || 0
		};
	} else {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const firstResult = result[0] as any;
		return {
			total: firstResult?.count[0]?.total || 0,
			totalDuration: firstResult?.baseDuration[0]?.total || 0,
			onlyTasksTotalDuration: firstResult?.tasksDuration[0]?.total || 0
		};
	}
}

// ============================================================================
// Reusable Focus Filter Pipeline Builder
// ============================================================================

export interface BuildFocusFilterPipelineParams {
	userId: Types.ObjectId;
	searchQuery?: string;
	taskId?: string;
	projectIds?: string[];
	startDate?: string;
	endDate?: string;
	taskIdIncludeFocusRecordsFromSubtasks?: boolean;
	focusAppSources?: string[];
	crossesMidnight?: boolean;
	intervalStartDate?: string | null;
	intervalEndDate?: string | null;
	emotions?: string[];
	timezone: string;
	general?: string[];
	yearAgnostic?: boolean;
}

/**
 * Builds a complete focus filter pipeline with all filters and adjustments applied.
 * This is the shared filtering logic used across stats, streaks, and other focus-related services.
 *
 * @param params - All filter parameters
 * @returns An object containing the pipeline and additional filter data
 */
export function buildFocusFilterPipeline(params: BuildFocusFilterPipelineParams): {
	pipeline: PipelineStage[];
	effectiveStartDate?: string;
	effectiveEndDate?: string;
	taskFilterConditions: MongooseFilter[];
} {
	// Build filters (reuse existing filter logic)
	const searchFilter = buildFocusSearchFilter(params.searchQuery);
	const { focusRecordMatchConditions, taskFilterConditions } = buildFocusMatchAndFilterConditions(
		params.userId,
		params.taskId,
		params.projectIds || [],
		params.startDate,
		params.endDate,
		params.taskIdIncludeFocusRecordsFromSubtasks || false,
		params.focusAppSources || [],
		params.crossesMidnight,
		params.intervalStartDate,
		params.intervalEndDate,
		params.emotions,
		params.timezone,
		params.general,
		params.yearAgnostic
	);

	// Calculate the date boundaries for duration adjustment
	// Use interval dates if provided (second tier), otherwise use filter sidebar dates (first tier)
	const effectiveStartDate = params.intervalStartDate || params.startDate;
	const effectiveEndDate = params.intervalEndDate || params.endDate;
	const tz = params.timezone || 'UTC';
	const { startDateBoundary, endDateBoundary } = calculateEffectiveDateBoundaries(params);

	// Build base pipeline with shared filters
	const basePipeline = buildFocusBasePipeline(searchFilter, focusRecordMatchConditions);

	// Add duration adjustment for midnight crossing
	if (params.yearAgnostic && params.startDate && params.endDate) {
		// Year-agnostic clipping: use month/day from sidebar dates, apply to each record's own year
		addYearAgnosticMidnightAdjustment(basePipeline, params.startDate, params.endDate, tz);
	} else if (!params.yearAgnostic && (startDateBoundary || endDateBoundary)) {
		// Regular clipping: use specific date boundaries
		addMidnightRecordDurationAdjustment(basePipeline, startDateBoundary, endDateBoundary);
	}

	// Add task filtering and duration recalculation (does not preserve original duration)
	addTaskFilteringAndDurationRecalculation(basePipeline, taskFilterConditions, false);

	return {
		pipeline: basePipeline,
		effectiveStartDate,
		effectiveEndDate,
		taskFilterConditions
	};
}
