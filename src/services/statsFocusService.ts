import FocusRecordTickTick from '../models/FocusRecord';
import Task from '../models/TaskModel';
import { addMidnightRecordDurationAdjustment } from '../utils/focus.utils';
import {
	buildFocusSearchFilter,
	buildFocusMatchAndFilterConditions,
	buildFocusBasePipeline,
	buildFocusTotalsCalculationPipeline,
	extractFocusTotalsFromResult,
	addTaskFilteringAndDurationRecalculation,
} from '../utils/focusFilterBuilders.utils';
import { buildAncestorData } from '../utils/task.utils';
import { getDateGroupingExpression } from '../utils/filterBuilders.utils';
import { parseDateInTimezone } from '../utils/timezone.utils';

// ============================================================================
// Stats Aggregation Service
// ============================================================================

export interface FocusRecordsStatsQueryParams {
	projectIds: string[];
	taskId?: string;
	startDate?: string; // Filter Sidebar dates (first tier filter)
	endDate?: string; // Filter Sidebar dates (first tier filter)
	intervalStartDate?: string; // Interval Dropdown dates (second tier filter)
	intervalEndDate?: string; // Interval Dropdown dates (second tier filter)
	taskIdIncludeFocusRecordsFromSubtasks: boolean;
	searchQuery?: string;
	focusAppSources: string[];
	toDoListAppSources: string[];
	timezone: string;
	crossesMidnight?: boolean;
	groupBy: string; // 'day' | 'project' | 'task' | 'hour' | 'timeline'
	nested?: boolean; // If true, include ancestorTasksById for nested display
	emotions?: string[]; // Emotions filter (anger, joy, sadness, etc.)

}

export async function getFocusRecordsStats(params: FocusRecordsStatsQueryParams) {
	// Build filters (reuse existing filter logic)
	const searchFilter = buildFocusSearchFilter(params.searchQuery);
	const { focusRecordMatchConditions, taskFilterConditions } = buildFocusMatchAndFilterConditions(
		params.taskId,
		params.projectIds,
		params.startDate,
		params.endDate,
		params.taskIdIncludeFocusRecordsFromSubtasks,
		params.focusAppSources,
		params.crossesMidnight,
		params.intervalStartDate,
		params.intervalEndDate,
		params.emotions,
		params.timezone
	);

	// Calculate the date boundaries for duration adjustment
	// Use interval dates if provided (second tier), otherwise use filter sidebar dates (first tier)
	const effectiveStartDate = params.intervalStartDate || params.startDate;
	const effectiveEndDate = params.intervalEndDate || params.endDate;

	const tz = params.timezone || 'UTC';
	const startDateBoundary = effectiveStartDate ? parseDateInTimezone(effectiveStartDate, tz) : null;
	let endDateBoundary: Date | null = null;
	if (effectiveEndDate) {
		endDateBoundary = parseDateInTimezone(effectiveEndDate, tz);
		endDateBoundary.setUTCDate(endDateBoundary.getUTCDate() + 1);
	}

	// Build base pipeline with shared filters
	const basePipeline = buildFocusBasePipeline(searchFilter, focusRecordMatchConditions);

	// Add duration adjustment for midnight crossing
	if (startDateBoundary || endDateBoundary) {
		addMidnightRecordDurationAdjustment(basePipeline, startDateBoundary, endDateBoundary);
	}

	// Add task filtering and duration recalculation (does not preserve original duration)
	addTaskFilteringAndDurationRecalculation(basePipeline, taskFilterConditions, false);

	// Apply grouping based on groupBy parameter
	const nested = params.nested ?? false;

	switch (params.groupBy) {
		case 'day':
			return await groupByDay(basePipeline, effectiveStartDate, effectiveEndDate, taskFilterConditions, params.timezone);
		case 'week':
			return await groupByWeek(basePipeline, effectiveStartDate, effectiveEndDate, taskFilterConditions, params.timezone);
		case 'month':
			return await groupByMonth(basePipeline, effectiveStartDate, effectiveEndDate, taskFilterConditions, params.timezone);
		case 'year':
			return await groupByYear(basePipeline, effectiveStartDate, effectiveEndDate, taskFilterConditions, params.timezone);
		case 'project':
			return await groupByProject(basePipeline, taskFilterConditions, nested);
		case 'task':
			return await groupByTask(basePipeline, taskFilterConditions, nested);
		case 'emotion':
			return await groupByEmotion(basePipeline, taskFilterConditions, nested);
		case 'hour':
			return await groupByHour(basePipeline, taskFilterConditions, params.timezone);
		case 'timeline':
			return await getTimeline(basePipeline, params.timezone);
		case 'record':
			return await groupByRecord(basePipeline, effectiveStartDate, effectiveEndDate, taskFilterConditions, params.timezone);
		default:
			throw new Error(`Invalid group-by parameter: ${params.groupBy}`);
	}
}

// ============================================================================
// Aggregation Helper Functions
// ============================================================================

/**
 * Shared helper to calculate totals using task-level durations.
 * Reusable across all grouping functions.
 */
async function calculateTotals(pipeline: any[], taskFilterConditions: any[] = []) {
	const totalsPipeline = buildFocusTotalsCalculationPipeline(pipeline, taskFilterConditions);
	const totalsResult = await FocusRecordTickTick.aggregate(totalsPipeline);
	const hasTaskOrProjectFilters = taskFilterConditions.length > 0;
	const { total: totalRecords, onlyTasksTotalDuration: totalDuration } = extractFocusTotalsFromResult(totalsResult, hasTaskOrProjectFilters);

	return { totalRecords, totalDuration };
}

/**
 * Shared helper to aggregate task-level data and fetch ancestor information.
 * Used by both groupByTask and groupByProject (when nested=true).
 */
async function aggregateTaskData(pipeline: any[], totalDuration: number) {
	// Build task-level aggregation
	const taskPipeline = [...pipeline];
	taskPipeline.push({ $unwind: { path: "$tasks", preserveNullAndEmptyArrays: false } });
	taskPipeline.push({
		$group: {
			_id: "$tasks.taskId",
			taskName: { $first: "$tasks.title" },
			projectId: { $first: "$tasks.projectId" },
			source: { $first: "$source" },
			duration: { $sum: "$tasks.duration" },
			count: { $sum: 1 }
		}
	});
	taskPipeline.push({ $sort: { duration: -1 } });

	const taskResults = await FocusRecordTickTick.aggregate(taskPipeline);

	// Fetch actual task data from MongoDB for TickTick tasks
	const tickTickTaskIds = taskResults
		.filter(r => r.source === 'FocusRecordTickTick')
		.map(r => r._id);

	let actualTaskNames: Record<string, string> = {};
	let ancestorTasksById: Record<string, any> = {};

	if (tickTickTaskIds.length > 0) {
		const tasks = await Task.find({ id: { $in: tickTickTaskIds } }).lean();

		actualTaskNames = tasks.reduce((acc, task) => {
			acc[task.id] = task.title;
			return acc;
		}, {} as Record<string, string>);

		const ancestorData = await buildAncestorData(tasks);
		ancestorTasksById = ancestorData.ancestorTasksById;

		tasks.forEach((task: any) => {
			ancestorTasksById[task.id] = {
				id: task.id,
				title: task.title,
				parentId: task.parentId ?? null,
				ancestorIds: task.ancestorIds,
				projectId: task.projectId ?? null
			};
		});
	}

	// Map results to formatted task data
	const byTask = taskResults.map(r => {
		const taskName = (r.source === 'FocusRecordTickTick' && actualTaskNames[r._id])
			? actualTaskNames[r._id]
			: r.taskName || 'Unknown Task';

		const percentage = totalDuration > 0 ? (r.duration / totalDuration) * 100 : 0;

		return {
			id: r._id,
			name: taskName,
			projectId: r.projectId,
			duration: r.duration,
			percentage: Number(percentage.toFixed(2)),
			count: r.count,
			type: 'task'
		};
	});

	return { byTask, ancestorTasksById };
}

async function groupByDay(pipeline: any[], startDate?: string, endDate?: string, taskFilterConditions: any[] = [], timezone: string = 'UTC') {
	// Calculate totals using task-level durations (not focus record durations)
	const { totalRecords, totalDuration } = await calculateTotals(pipeline, taskFilterConditions);

	// Now group by date for the byDay breakdown
	// Unwind tasks array to use task-level durations
	const aggPipeline = [...pipeline];
	aggPipeline.push({ $unwind: { path: "$tasks", preserveNullAndEmptyArrays: false } });

	aggPipeline.push({
		$group: {
			_id: {
				$dateToString: { format: "%Y-%m-%d", date: "$tasks.startTime", timezone: timezone }
			},
			duration: { $sum: "$tasks.duration" },
			uniqueRecords: { $addToSet: "$_id" } // Collect unique focus record IDs
		}
	});

	aggPipeline.push({ $sort: { _id: 1 } });

	const results = await FocusRecordTickTick.aggregate(aggPipeline);

	return {
		summary: {
			totalDuration,
			totalRecords,
			dateRange: { start: startDate || null, end: endDate || null }
		},
		byDay: results.map(r => ({
			date: r._id,
			duration: r.duration,
			count: r.uniqueRecords.length // Count unique focus records
		}))
	};
}

async function groupByWeek(pipeline: any[], startDate?: string, endDate?: string, taskFilterConditions: any[] = [], timezone: string = 'UTC') {
	// Calculate totals using task-level durations
	const { totalRecords, totalDuration } = await calculateTotals(pipeline, taskFilterConditions);

	// Group by week (Monday of each week)
	const aggPipeline = [...pipeline];
	aggPipeline.push({ $unwind: { path: "$tasks", preserveNullAndEmptyArrays: false } });

	// Add a field to get the Monday of the week for sorting purposes
	aggPipeline.push({
		$addFields: {
			weekStartDate: {
				$dateSubtract: {
					startDate: "$startTime",
					unit: "day",
					amount: {
						$subtract: [
							{ $isoDayOfWeek: { date: "$startTime", timezone: timezone } },
							1
						]
					},
					timezone: timezone
				}
			}
		}
	});

	aggPipeline.push({
		$group: {
			_id: getDateGroupingExpression('weekly', timezone),
			weekStartDate: { $first: "$weekStartDate" }, // Keep for sorting
			duration: { $sum: "$tasks.duration" },
			uniqueRecords: { $addToSet: "$_id" } // Collect unique focus record IDs
		}
	});

	// Sort by actual date, not the formatted string
	aggPipeline.push({ $sort: { weekStartDate: 1 } });

	const results = await FocusRecordTickTick.aggregate(aggPipeline);

	return {
		summary: {
			totalDuration,
			totalRecords,
			dateRange: { start: startDate || null, end: endDate || null }
		},
		byWeek: results.map(r => ({
			date: r._id, // Format: "January 1, 2025" (Monday of the week)
			duration: r.duration,
			count: r.uniqueRecords.length // Count unique focus records
		}))
	};
}

async function groupByMonth(pipeline: any[], startDate?: string, endDate?: string, taskFilterConditions: any[] = [], timezone: string = 'UTC') {
	// Calculate totals using task-level durations
	const { totalRecords, totalDuration } = await calculateTotals(pipeline, taskFilterConditions);

	// Group by month
	const aggPipeline = [...pipeline];
	aggPipeline.push({ $unwind: { path: "$tasks", preserveNullAndEmptyArrays: false } });

	// Add a field to get the first day of the month for sorting purposes
	aggPipeline.push({
		$addFields: {
			monthStartDate: {
				$dateTrunc: {
					date: "$startTime",
					unit: "month",
					timezone: timezone
				}
			}
		}
	});

	aggPipeline.push({
		$group: {
			_id: getDateGroupingExpression('monthly', timezone),
			monthStartDate: { $first: "$monthStartDate" }, // Keep for sorting
			duration: { $sum: "$tasks.duration" },
			uniqueRecords: { $addToSet: "$_id" } // Collect unique focus record IDs
		}
	});

	// Sort by actual date, not the formatted string
	aggPipeline.push({ $sort: { monthStartDate: 1 } });

	const results = await FocusRecordTickTick.aggregate(aggPipeline);

	return {
		summary: {
			totalDuration,
			totalRecords,
			dateRange: { start: startDate || null, end: endDate || null }
		},
		byMonth: results.map(r => ({
			date: r._id, // Format: "January 2025"
			duration: r.duration,
			count: r.uniqueRecords.length // Count unique focus records
		}))
	};
}

async function groupByYear(pipeline: any[], startDate?: string, endDate?: string, taskFilterConditions: any[] = [], timezone: string = 'UTC') {
	// Calculate totals using task-level durations
	const { totalRecords, totalDuration } = await calculateTotals(pipeline, taskFilterConditions);

	// Group by year
	const aggPipeline = [...pipeline];
	aggPipeline.push({ $unwind: { path: "$tasks", preserveNullAndEmptyArrays: false } });

	// Add a field to get the first day of the year for sorting purposes
	aggPipeline.push({
		$addFields: {
			yearStartDate: {
				$dateTrunc: {
					date: "$startTime",
					unit: "year",
					timezone: timezone
				}
			}
		}
	});

	aggPipeline.push({
		$group: {
			_id: {
				$dateToString: { format: "%Y", date: "$tasks.startTime", timezone: timezone }
			},
			yearStartDate: { $first: "$yearStartDate" }, // Keep for sorting
			duration: { $sum: "$tasks.duration" },
			uniqueRecords: { $addToSet: "$_id" } // Collect unique focus record IDs
		}
	});

	// Sort by actual date, not the formatted string
	aggPipeline.push({ $sort: { yearStartDate: 1 } });

	const results = await FocusRecordTickTick.aggregate(aggPipeline);

	return {
		summary: {
			totalDuration,
			totalRecords,
			dateRange: { start: startDate || null, end: endDate || null }
		},
		byYear: results.map(r => ({
			date: r._id, // Format: "2025"
			duration: r.duration,
			count: r.uniqueRecords.length // Count unique focus records
		}))
	};
}

async function groupByProject(pipeline: any[], taskFilterConditions: any[] = [], nested: boolean = false) {
	// Calculate totals using task-level durations
	const { totalRecords, totalDuration } = await calculateTotals(pipeline, taskFilterConditions);

	const aggPipeline = [...pipeline];

	// Unwind tasks array to access project information
	aggPipeline.push({ $unwind: { path: "$tasks", preserveNullAndEmptyArrays: false } });

	// Group by project for TickTick/Session, or by source for other apps
	// Use a composite key: if projectId exists, use it; otherwise use source
	aggPipeline.push({
		$group: {
			_id: {
				projectId: "$tasks.projectId",
				source: "$source"
			},
			duration: { $sum: "$tasks.duration" },
		}
	});

	aggPipeline.push({ $sort: { duration: -1 } });

	const results = await FocusRecordTickTick.aggregate(aggPipeline);

	const response: any = {
		summary: {
			totalDuration,
			totalRecords,
			dateRange: { start: null, end: null }
		},
		byProject: results.map(r => {
			const percentage = totalDuration > 0 ? (r.duration / totalDuration) * 100 : 0
			const projectId = r._id.projectId || r._id.source;

			return {
				id: projectId,
				duration: r.duration,
				percentage: Number(percentage.toFixed(2)),
				type: 'project'
			};
		})
	};

	// If nested, also fetch task-level data and ancestorTasksById
	if (nested) {
		const { byTask, ancestorTasksById } = await aggregateTaskData(pipeline, totalDuration);
		response.byTask = byTask;
		response.ancestorTasksById = ancestorTasksById;
	}

	return response;
}

async function groupByTask(pipeline: any[], taskFilterConditions: any[] = [], nested: boolean = false) {
	// Calculate totals using task-level durations
	const { totalRecords, totalDuration } = await calculateTotals(pipeline, taskFilterConditions);

	const response: any = {
		summary: {
			totalDuration,
			totalRecords,
			dateRange: { start: null, end: null }
		}
	};

	// Use shared helper to aggregate task data
	const { byTask, ancestorTasksById } = await aggregateTaskData(pipeline, totalDuration);
	response.byTask = byTask;
	response.ancestorTasksById = ancestorTasksById;

	return response;
}

async function aggregateProjectAndTaskDataByEmotion(basePipeline: any[], emotions: string[], totalDuration: number) {
	const byEmotionWithTasks: any = {};

	for (const emotion of emotions) {
		// Create emotion-filtered pipeline
		const emotionPipeline = [...basePipeline];

		// Filter focus records that contain this emotion
		if (emotion === 'none') {
			// Match records with empty or null emotions array
			emotionPipeline.push({
				$match: {
					$or: [
						{ emotions: [] },
						{ emotions: null },
						{ emotions: { $exists: false } }
					]
				}
			});
		} else {
			// Match records containing this specific emotion
			emotionPipeline.push({
				$match: {
					"emotions.emotion": emotion
				}
			});
		}

		// Aggregate projects for this emotion
		const projectPipeline = [...emotionPipeline];
		projectPipeline.push({ $unwind: { path: "$tasks", preserveNullAndEmptyArrays: false } });
		projectPipeline.push({
			$group: {
				_id: {
					projectId: "$tasks.projectId",
					source: "$source"
				},
				duration: { $sum: "$tasks.duration" },
			}
		});
		projectPipeline.push({ $sort: { duration: -1 } });

		const projectResults = await FocusRecordTickTick.aggregate(projectPipeline);

		const byProject = projectResults.map(r => {
			const percentage = totalDuration > 0 ? (r.duration / totalDuration) * 100 : 0;
			const projectId = r._id.projectId || r._id.source;

			return {
				id: projectId,
				duration: r.duration,
				percentage: Number(percentage.toFixed(2)),
				type: 'project'
			};
		});

		// Aggregate tasks for this emotion
		const { byTask, ancestorTasksById } = await aggregateTaskData(emotionPipeline, totalDuration);

		byEmotionWithTasks[emotion] = {
			byProject,
			byTask,
			ancestorTasksById
		};
	}

	return byEmotionWithTasks;
}

async function groupByEmotion(pipeline: any[], taskFilterConditions: any[] = [], nested: boolean = false) {
	// Calculate totals using task-level durations
	const { totalRecords, totalDuration } = await calculateTotals(pipeline, taskFilterConditions);

	const aggPipeline = [...pipeline];

	// Unwind tasks array first to use task-level durations
	aggPipeline.push({ $unwind: { path: "$tasks", preserveNullAndEmptyArrays: false } });

	// Add a field to handle empty emotions array
	aggPipeline.push({
		$addFields: {
			emotionToGroup: {
				$cond: {
					if: { $or: [{ $eq: ["$emotions", []] }, { $eq: ["$emotions", null] }] },
					then: [{ emotion: "none" }],
					else: "$emotions"
				}
			}
		}
	});

	// Then unwind emotions array to access individual emotion objects
	aggPipeline.push({ $unwind: { path: "$emotionToGroup", preserveNullAndEmptyArrays: false } });

	// Group by emotion name - sum task-level durations (not record-level)
	aggPipeline.push({
		$group: {
			_id: "$emotionToGroup.emotion",
			duration: { $sum: "$tasks.duration" },
			count: { $sum: 1 }
		}
	});

	aggPipeline.push({ $sort: { duration: -1 } });

	const results = await FocusRecordTickTick.aggregate(aggPipeline);

	const response: any = {
		summary: {
			totalDuration,
			totalRecords,
			dateRange: { start: null, end: null }
		},
		byEmotion: results.map(r => {
			const percentage = totalDuration > 0 ? (r.duration / totalDuration) * 100 : 0;

			return {
				id: r._id,
				name: r._id,
				duration: r.duration,
				percentage: Number(percentage.toFixed(2)),
				count: r.count,
				type: 'emotion'
			};
		})
	};

	// If nested, fetch emotion-specific project and task data
	if (nested) {
		const emotions = results.map(r => r._id); // Get list of emotion names
		const byEmotionWithTasks = await aggregateProjectAndTaskDataByEmotion(pipeline, emotions, totalDuration);
		response.byEmotionWithTasks = byEmotionWithTasks;
	}

	return response;
}

async function groupByHour(pipeline: any[], taskFilterConditions: any[] = [], timezone: string = 'UTC') {
	// Calculate totals using task-level durations
	const { totalRecords, totalDuration } = await calculateTotals(pipeline, taskFilterConditions);

	const aggPipeline = [...pipeline];

	// Unwind tasks array to use task-level durations
	aggPipeline.push({ $unwind: { path: "$tasks", preserveNullAndEmptyArrays: false } });

	// Split each task across the hours it spans
	aggPipeline.push({
		$addFields: {
			taskHourSplits: {
				$let: {
					vars: {
						startHour: { $hour: { date: "$tasks.startTime", timezone: timezone } },
						endHour: { $hour: { date: "$tasks.endTime", timezone: timezone } },
						startMinute: { $minute: { date: "$tasks.startTime", timezone: timezone } },
						endMinute: { $minute: { date: "$tasks.endTime", timezone: timezone } },
						startSecond: { $second: { date: "$tasks.startTime", timezone: timezone } },
						endSecond: { $second: { date: "$tasks.endTime", timezone: timezone } }
					},
					in: {
						$cond: {
							// If start and end are in the same hour
							if: { $eq: ["$$startHour", "$$endHour"] },
							then: [{
								hour: "$$startHour",
								duration: "$tasks.duration"
							}],
							else: {
								// Task spans multiple hours - need to split it
								$map: {
									input: {
										$range: [
											"$$startHour",
											{ $add: ["$$endHour", 1] }
										]
									},
									as: "hour",
									in: {
										hour: "$$hour",
										duration: {
											$let: {
												vars: {
													// Seconds from start of current hour
													hourStartSeconds: {
														$cond: {
															if: { $eq: ["$$hour", "$$startHour"] },
															then: { $add: [{ $multiply: ["$$startMinute", 60] }, "$$startSecond"] },
															else: 0
														}
													},
													// Seconds to end of current hour
													hourEndSeconds: {
														$cond: {
															if: { $eq: ["$$hour", "$$endHour"] },
															then: { $add: [{ $multiply: ["$$endMinute", 60] }, "$$endSecond"] },
															else: 3600
														}
													}
												},
												in: {
													// Duration for this hour = (end - start) seconds
													$subtract: ["$$hourEndSeconds", "$$hourStartSeconds"]
												}
											}
										}
									}
								}
							}
						}
					}
				}
			}
		}
	});

	// Unwind the hour splits so each becomes a separate document
	aggPipeline.push({ $unwind: { path: "$taskHourSplits", preserveNullAndEmptyArrays: false } });

	// Group by hour
	aggPipeline.push({
		$group: {
			_id: "$taskHourSplits.hour",
			duration: { $sum: "$taskHourSplits.duration" },
			uniqueRecords: { $addToSet: "$_id" } // Collect unique focus record IDs
		}
	});

	aggPipeline.push({ $sort: { _id: 1 } });

	const results = await FocusRecordTickTick.aggregate(aggPipeline);

	// Fill in missing hours with 0
	const byHour = Array.from({ length: 24 }, (_, i) => {
		const hourData = results.find(r => r._id === i);
		return {
			hour: i,
			duration: hourData?.duration || 0,
			count: hourData?.uniqueRecords?.length || 0 // Count unique focus records
		};
	});

	return {
		summary: {
			totalDuration,
			totalRecords,
			dateRange: { start: null, end: null }
		},
		byHour
	};
}

async function groupByRecord(pipeline: any[], startDate?: string, endDate?: string, taskFilterConditions: any[] = [], timezone: string = 'UTC') {
	// Calculate totals using task-level durations
	const { totalRecords, totalDuration } = await calculateTotals(pipeline, taskFilterConditions);

	// Get individual records sorted by start time (oldest to newest)
	const aggPipeline = [...pipeline];
	aggPipeline.push({ $sort: { startTime: 1 } });

	const results = await FocusRecordTickTick.aggregate(aggPipeline);

	return {
		summary: {
			totalDuration,
			totalRecords,
			dateRange: { start: startDate || null, end: endDate || null }
		},
		byRecord: results.map(r => ({
			date: r.startTime, // Use startTime as the date identifier
			duration: r.duration,
			count: 1, // Each record is its own group
			startTime: r.startTime,
			endTime: r.endTime
		}))
	};
}

async function getTimeline(pipeline: any[], timezone: string = 'UTC') {
	const aggPipeline = [...pipeline];

	// Sort by start time
	aggPipeline.push({ $sort: { startTime: 1 } });

	const focusRecords = await FocusRecordTickTick.aggregate(aggPipeline);

	// Calculate summary
	const totalDuration = focusRecords.reduce((sum, record) => sum + (record.duration || 0), 0);
	const totalRecords = focusRecords.length;

	// Format records for timeline view
	// Note: Times are already stored in UTC in the database and will be displayed
	// according to the user's timezone on the frontend
	const records = focusRecords.flatMap(record => {
		return (record.tasks || []).map((task: any) => ({
			id: record.id || record._id.toString(),
			taskId: task.taskId,
			taskName: task.title,
			projectId: task.projectId,
			projectName: task.projectName,
			projectColor: '#808080', // Default color
			startTime: task.startTime,
			endTime: task.endTime,
			duration: task.duration
		}));
	});

	return {
		summary: {
			totalDuration,
			totalRecords,
			dateRange: { start: null, end: null }
		},
		records
	};
}
