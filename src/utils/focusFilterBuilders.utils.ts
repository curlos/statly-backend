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
// Focus Records - Match and Filter Conditions
// ============================================================================

export function buildFocusMatchAndFilterConditions(
	taskId: string | undefined,
	projectIds: string[],
	startDate: string | undefined,
	endDate: string | undefined,
	taskIdIncludeFocusRecordsFromSubtasks: boolean,
	appSources: string[],
	crossesMidnight?: boolean,
	intervalStartDate?: string | null,
	intervalEndDate?: string | null,
	emotions?: string[]
) {
	const focusRecordMatchConditions: any = {};
	const taskFilterConditions: any[] = [];

	// Two-tier date filtering:
	// 1. First tier: Filter Sidebar dates (startDate, endDate) - broad filter at MongoDB level
	// 2. Second tier: Interval Dropdown dates (intervalStartDate, intervalEndDate) - will be applied later in pipeline

	// Add first tier date range to match conditions (Filter Sidebar)
	// Include records where EITHER startTime OR endTime falls within the date range
	// This ensures records that cross midnight are included on both days
	if (startDate || endDate) {
		const startBoundary = startDate ? new Date(startDate) : null;
		let endBoundary = null;
		if (endDate) {
			endBoundary = new Date(endDate);
			endBoundary.setDate(endBoundary.getDate() + 1);
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
			focusRecordMatchConditions.$or = dateConditions;
		}
	}

	// Add second tier date range filter (Interval Dropdown)
	// This will be applied after the first tier filter
	if (intervalStartDate || intervalEndDate) {
		const intervalStartBoundary = intervalStartDate ? new Date(intervalStartDate) : null;
		let intervalEndBoundary = null;
		if (intervalEndDate) {
			intervalEndBoundary = new Date(intervalEndDate);
			intervalEndBoundary.setDate(intervalEndBoundary.getDate() + 1);
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
			// Combine with existing $or conditions if they exist
			if (focusRecordMatchConditions.$or) {
				// If we already have $or conditions (from first tier), we need to AND them together
				focusRecordMatchConditions.$and = [
					{ $or: focusRecordMatchConditions.$or },
					{ $or: intervalDateConditions }
				];
				delete focusRecordMatchConditions.$or;
			} else {
				focusRecordMatchConditions.$or = intervalDateConditions;
			}
		}
	}

	// Add app source filter
	if (appSources.length > 0) {
		focusRecordMatchConditions.source = { $in: appSources };
	}

	// Add emotions filter
	if (emotions && emotions.length > 0) {
		focusRecordMatchConditions["emotions.emotion"] = { $in: emotions };
	}

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
			focusRecordMatchConditions.$or = [
				{ "tasks.taskId": taskId },
				{ "tasks.ancestorIds": taskId }
			];
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

	return { focusRecordMatchConditions, taskFilterConditions };
}

// ============================================================================
// Focus Records - Base Pipeline
// ============================================================================

export function buildFocusBasePipeline(searchFilter: any, focusRecordMatchConditions: any) {
	const pipeline: any[] = [];

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
	pipeline: any[],
	taskFilterConditions: any[]
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
	pipeline: any[],
	taskFilterConditions: any[],
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
	basePipeline: any[],
	taskFilterConditions: any[]
): any[] {
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
	result: any[],
	hasTaskOrProjectFilters: boolean
): { total: number; totalDuration: number; onlyTasksTotalDuration: number } {
	if (hasTaskOrProjectFilters) {
		return {
			total: result[0]?.total || 0,
			totalDuration: result[0]?.totalDuration || 0,
			onlyTasksTotalDuration: result[0]?.onlyTasksTotalDuration || 0
		};
	} else {
		return {
			total: result[0]?.count[0]?.total || 0,
			totalDuration: result[0]?.baseDuration[0]?.total || 0,
			onlyTasksTotalDuration: result[0]?.tasksDuration[0]?.total || 0
		};
	}
}
