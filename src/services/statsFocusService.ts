import { Types } from 'mongoose';
import FocusRecord from '../models/FocusRecord';
import Task from '../models/TaskModel';
import { buildFocusFilterPipeline } from '../utils/focusFilterBuilders.utils';
import { buildAncestorData } from '../utils/task.utils';
import { getDateGroupingExpression } from '../utils/filterBuilders.utils';

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

export async function getFocusRecordsStats(params: FocusRecordsStatsQueryParams, userId: Types.ObjectId) {
	// Build complete filter pipeline using shared utility
	const { pipeline: basePipeline, effectiveStartDate, effectiveEndDate, taskFilterConditions } = buildFocusFilterPipeline({
		...params,
		userId
	});

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
			return await groupByProject(basePipeline, taskFilterConditions, nested, userId);
		case 'task':
			return await groupByTask(basePipeline, taskFilterConditions, nested, userId);
		case 'emotion':
			return await groupByEmotion(basePipeline, taskFilterConditions, nested, userId);
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
 * Returns pipeline stages for calculating totals (record count and duration sum).
 * Used within $facet to run totals calculation in parallel with grouping logic.
 */
function buildTotalsPipelineStages(taskFilterConditions: any[] = []): any[] {
	const hasTaskOrProjectFilters = taskFilterConditions.length > 0;

	if (hasTaskOrProjectFilters) {
		// Filtered case: use recalculated duration
		return [
			{
				$group: {
					_id: null,
					total: { $sum: 1 },
					totalDuration: { $sum: "$duration" }
				}
			}
		];
	} else {
		// No filters: calculate tasks duration using $reduce
		return [
			{
				$addFields: {
					tasksDurationSum: {
						$reduce: {
							input: "$tasks",
							initialValue: 0,
							in: { $add: ["$$value", "$$this.duration"] }
						}
					}
				}
			},
			{
				$group: {
					_id: null,
					total: { $sum: 1 },
					totalDuration: { $sum: "$tasksDurationSum" }
				}
			}
		];
	}
}

/**
 * Returns the aggregation stages needed to group tasks by taskId.
 * Use this in a $facet to fetch task data in parallel with other aggregations.
 */
function getTaskAggregationStages() {
	return [
		{ $unwind: { path: "$tasks", preserveNullAndEmptyArrays: false } },
		{
			$group: {
				_id: "$tasks.taskId",
				taskName: { $first: "$tasks.title" },
				projectId: { $first: "$tasks.projectId" },
				source: { $first: "$source" },
				duration: { $sum: "$tasks.duration" },
				count: { $sum: 1 }
			}
		},
		{ $sort: { duration: -1 } }
	];
}

/**
 * Processes task aggregation results that were already fetched (e.g., from a $facet).
 * Fetches actual task names and ancestor data for TickTick tasks.
 */
async function processTaskData(taskResults: any[], totalDuration: number, userId: Types.ObjectId) {
	// Fetch actual task data from MongoDB for TickTick tasks
	const tickTickTaskIds = taskResults
		.filter((r: any) => r.source === 'FocusRecordTickTick')
		.map((r: any) => r._id);

	let actualTaskNames: Record<string, string> = {};
	let ancestorTasksById: Record<string, any> = {};

	if (tickTickTaskIds.length > 0) {
		const tasks = await Task.find({ userId, id: { $in: tickTickTaskIds } })
			.select('id title parentId ancestorIds projectId')
			.lean();

		actualTaskNames = tasks.reduce((acc, task) => {
			acc[task.id] = task.title;
			return acc;
		}, {} as Record<string, string>);

		const ancestorData = await buildAncestorData(tasks, userId);
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
	const byTask = taskResults.map((r: any) => {
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
	// Use $facet to calculate totals and group by day in a single query
	pipeline.push({
		$facet: {
			totals: buildTotalsPipelineStages(taskFilterConditions),
			byDay: [
				{ $unwind: { path: "$tasks", preserveNullAndEmptyArrays: false } },
				{
					$group: {
						_id: {
							$dateToString: { format: "%Y-%m-%d", date: "$tasks.startTime", timezone: timezone }
						},
						duration: { $sum: "$tasks.duration" },
						uniqueRecords: { $addToSet: "$_id" }
					}
				},
				{ $sort: { _id: 1 } }
			]
		}
	});

	const result = await FocusRecord.aggregate(pipeline);
	const facetResult = result[0];

	const totalRecords = facetResult.totals[0]?.total || 0;
	const totalDuration = facetResult.totals[0]?.totalDuration || 0;
	const results = facetResult.byDay || [];

	return {
		summary: {
			totalDuration,
			totalRecords,
			dateRange: { start: startDate || null, end: endDate || null }
		},
		byDay: results.map((r: any) => ({
			date: r._id,
			duration: r.duration,
			count: r.uniqueRecords.length
		}))
	};
}

async function groupByWeek(pipeline: any[], startDate?: string, endDate?: string, taskFilterConditions: any[] = [], timezone: string = 'UTC') {
	// Use $facet to calculate totals and group by week in a single query
	pipeline.push({
		$facet: {
			// Calculate totals using task-level durations
			totals: buildTotalsPipelineStages(taskFilterConditions),

			// Group by week (Monday of each week)
			byWeek: [
				{ $unwind: { path: "$tasks", preserveNullAndEmptyArrays: false } },
				// Add a field to get the Monday of the week for sorting purposes
				{
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
				},
				{
					$group: {
						_id: getDateGroupingExpression('weekly', timezone),
						weekStartDate: { $first: "$weekStartDate" }, // Keep for sorting
						duration: { $sum: "$tasks.duration" },
						uniqueRecords: { $addToSet: "$_id" } // Collect unique focus record IDs
					}
				},
				// Sort by actual date, not the formatted string
				{ $sort: { weekStartDate: 1 } }
			]
		}
	});

	const result = await FocusRecord.aggregate(pipeline);
	const facetResult = result[0];

	const totalRecords = facetResult.totals[0]?.total || 0;
	const totalDuration = facetResult.totals[0]?.totalDuration || 0;
	const results = facetResult.byWeek || [];

	return {
		summary: {
			totalDuration,
			totalRecords,
			dateRange: { start: startDate || null, end: endDate || null }
		},
		byWeek: results.map((r: any) => ({
			date: r._id, // Format: "January 1, 2025" (Monday of the week)
			duration: r.duration,
			count: r.uniqueRecords.length // Count unique focus records
		}))
	};
}

async function groupByMonth(pipeline: any[], startDate?: string, endDate?: string, taskFilterConditions: any[] = [], timezone: string = 'UTC') {
	// Use $facet to calculate totals and group by month in a single query
	pipeline.push({
		$facet: {
			// Calculate totals using task-level durations
			totals: buildTotalsPipelineStages(taskFilterConditions),

			// Group by month
			byMonth: [
				{ $unwind: { path: "$tasks", preserveNullAndEmptyArrays: false } },
				// Add a field to get the first day of the month for sorting purposes
				{
					$addFields: {
						monthStartDate: {
							$dateTrunc: {
								date: "$startTime",
								unit: "month",
								timezone: timezone
							}
						}
					}
				},
				{
					$group: {
						_id: getDateGroupingExpression('monthly', timezone),
						monthStartDate: { $first: "$monthStartDate" }, // Keep for sorting
						duration: { $sum: "$tasks.duration" },
						uniqueRecords: { $addToSet: "$_id" } // Collect unique focus record IDs
					}
				},
				// Sort by actual date, not the formatted string
				{ $sort: { monthStartDate: 1 } }
			]
		}
	});

	const result = await FocusRecord.aggregate(pipeline);
	const facetResult = result[0];

	const totalRecords = facetResult.totals[0]?.total || 0;
	const totalDuration = facetResult.totals[0]?.totalDuration || 0;
	const results = facetResult.byMonth || [];

	return {
		summary: {
			totalDuration,
			totalRecords,
			dateRange: { start: startDate || null, end: endDate || null }
		},
		byMonth: results.map((r: any) => ({
			date: r._id, // Format: "January 2025"
			duration: r.duration,
			count: r.uniqueRecords.length // Count unique focus records
		}))
	};
}

async function groupByYear(pipeline: any[], startDate?: string, endDate?: string, taskFilterConditions: any[] = [], timezone: string = 'UTC') {
	// Use $facet to calculate totals and group by year in a single query
	pipeline.push({
		$facet: {
			// Calculate totals using task-level durations
			totals: buildTotalsPipelineStages(taskFilterConditions),

			// Group by year
			byYear: [
				{ $unwind: { path: "$tasks", preserveNullAndEmptyArrays: false } },
				// Add a field to get the first day of the year for sorting purposes
				{
					$addFields: {
						yearStartDate: {
							$dateTrunc: {
								date: "$startTime",
								unit: "year",
								timezone: timezone
							}
						}
					}
				},
				{
					$group: {
						_id: {
							$dateToString: { format: "%Y", date: "$tasks.startTime", timezone: timezone }
						},
						yearStartDate: { $first: "$yearStartDate" }, // Keep for sorting
						duration: { $sum: "$tasks.duration" },
						uniqueRecords: { $addToSet: "$_id" } // Collect unique focus record IDs
					}
				},
				// Sort by actual date, not the formatted string
				{ $sort: { yearStartDate: 1 } }
			]
		}
	});

	const result = await FocusRecord.aggregate(pipeline);
	const facetResult = result[0];

	const totalRecords = facetResult.totals[0]?.total || 0;
	const totalDuration = facetResult.totals[0]?.totalDuration || 0;
	const results = facetResult.byYear || [];

	return {
		summary: {
			totalDuration,
			totalRecords,
			dateRange: { start: startDate || null, end: endDate || null }
		},
		byYear: results.map((r: any) => ({
			date: r._id, // Format: "2025"
			duration: r.duration,
			count: r.uniqueRecords.length // Count unique focus records
		}))
	};
}

async function groupByProject(pipeline: any[], taskFilterConditions: any[] = [], nested: boolean = false, userId: Types.ObjectId) {
	// Use $facet to calculate totals and group by project in a single query
	const facetStages: any = {
		// Calculate totals using task-level durations
		totals: buildTotalsPipelineStages(taskFilterConditions),

		// Unwind tasks array to access project information
		byProject: [
			{ $unwind: { path: "$tasks", preserveNullAndEmptyArrays: false } },
			// Group by project for TickTick/Session, or by source for other apps
			// Use a composite key: if projectId exists, use it; otherwise use source
			{
				$group: {
					_id: {
						projectId: "$tasks.projectId",
						source: "$source"
					},
					duration: { $sum: "$tasks.duration" },
				}
			},
			{ $sort: { duration: -1 } }
		]
	};

	// If nested, also fetch task-level data in the same query
	if (nested) {
		facetStages.byTask = getTaskAggregationStages();
	}

	pipeline.push({ $facet: facetStages });

	const result = await FocusRecord.aggregate(pipeline);
	const facetResult = result[0];

	const totalRecords = facetResult.totals[0]?.total || 0;
	const totalDuration = facetResult.totals[0]?.totalDuration || 0;
	const results = facetResult.byProject || [];

	const response: any = {
		summary: {
			totalDuration,
			totalRecords,
			dateRange: { start: null, end: null }
		},
		byProject: results.map((r: any) => {
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

	// If nested, process the task results that were fetched in the same query
	if (nested) {
		const { byTask, ancestorTasksById } = await processTaskData(facetResult.byTask, totalDuration, userId);
		response.byTask = byTask;
		response.ancestorTasksById = ancestorTasksById;
	}

	return response;
}

async function groupByTask(pipeline: any[], taskFilterConditions: any[] = [], nested: boolean = false, userId: Types.ObjectId) {
	// Use $facet to calculate totals and fetch task data in a single query
	pipeline.push({
		$facet: {
			// Calculate totals using task-level durations
			totals: buildTotalsPipelineStages(taskFilterConditions),
			// Fetch task-level aggregation data
			byTask: getTaskAggregationStages()
		}
	});

	const result = await FocusRecord.aggregate(pipeline);
	const facetResult = result[0];

	const totalRecords = facetResult.totals[0]?.total || 0;
	const totalDuration = facetResult.totals[0]?.totalDuration || 0;

	// Process the task results that were fetched in the same query
	const { byTask, ancestorTasksById } = await processTaskData(facetResult.byTask, totalDuration, userId);

	const response: any = {
		summary: {
			totalDuration,
			totalRecords,
			dateRange: { start: null, end: null }
		},
		byTask,
		ancestorTasksById
	};

	return response;
}

async function aggregateProjectAndTaskDataByEmotion(basePipeline: any[], emotions: string[], totalDuration: number, userId: Types.ObjectId) {
	// Run all emotion queries in parallel for better performance
	const emotionPromises = emotions.map(async (emotion) => {
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

		// Use $facet to aggregate both projects and tasks in a single query
		emotionPipeline.push({
			$facet: {
				byProject: [
					{ $unwind: { path: "$tasks", preserveNullAndEmptyArrays: false } },
					{
						$group: {
							_id: {
								projectId: "$tasks.projectId",
								source: "$source"
							},
							duration: { $sum: "$tasks.duration" },
						}
					},
					{ $sort: { duration: -1 } }
				],
				byTask: getTaskAggregationStages()
			}
		});

		const result = await FocusRecord.aggregate(emotionPipeline);
		const facetResult = result[0];

		const byProject = facetResult.byProject.map((r: any) => {
			const percentage = totalDuration > 0 ? (r.duration / totalDuration) * 100 : 0;
			const projectId = r._id.projectId || r._id.source;

			return {
				id: projectId,
				duration: r.duration,
				percentage: Number(percentage.toFixed(2)),
				type: 'project'
			};
		});

		// Process the task results that were fetched in the same query
		const { byTask, ancestorTasksById } = await processTaskData(facetResult.byTask, totalDuration, userId);

		return {
			emotion,
			data: {
				byProject,
				byTask,
				ancestorTasksById
			}
		};
	});

	// Wait for all emotion queries to complete in parallel
	const emotionResults = await Promise.all(emotionPromises);

	// Convert array of results back to object keyed by emotion
	const byEmotionWithTasks: any = {};
	emotionResults.forEach(({ emotion, data }) => {
		byEmotionWithTasks[emotion] = data;
	});

	return byEmotionWithTasks;
}

async function groupByEmotion(pipeline: any[], taskFilterConditions: any[] = [], nested: boolean = false, userId: Types.ObjectId) {
	// Save a clean copy of the pipeline before adding $facet (needed for nested queries)
	const cleanPipeline = [...pipeline];

	// Use $facet to run totals calculation and grouping in a single query
	pipeline.push({
		$facet: {
			totals: buildTotalsPipelineStages(taskFilterConditions),
			byEmotion: [
				// Unwind tasks array first to use task-level durations
				{ $unwind: { path: "$tasks", preserveNullAndEmptyArrays: false } },

				// Add a field to handle empty emotions array
				{
					$addFields: {
						emotionToGroup: {
							$cond: {
								if: { $or: [{ $eq: ["$emotions", []] }, { $eq: ["$emotions", null] }] },
								then: [{ emotion: "none" }],
								else: "$emotions"
							}
						}
					}
				},

				// Then unwind emotions array to access individual emotion objects
				{ $unwind: { path: "$emotionToGroup", preserveNullAndEmptyArrays: false } },

				// Group by emotion name - sum task-level durations (not record-level)
				{
					$group: {
						_id: "$emotionToGroup.emotion",
						duration: { $sum: "$tasks.duration" },
						count: { $sum: 1 }
					}
				},

				{ $sort: { duration: -1 } }
			]
		}
	});

	const result = await FocusRecord.aggregate(pipeline);
	const facetResult = result[0];

	// Extract totals
	const totalRecords = facetResult.totals[0]?.total || 0;
	const totalDuration = facetResult.totals[0]?.totalDuration || 0;

	// Extract results
	const results = facetResult.byEmotion;

	const response: any = {
		summary: {
			totalDuration,
			totalRecords,
			dateRange: { start: null, end: null }
		},
		byEmotion: results.map((r: any) => {
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
		const emotions = results.map((r: any) => r._id); // Get list of emotion names
		// Note: Runs 1 query per emotion in parallel (projects + tasks via $facet, all emotions simultaneously)
		// Pass the clean pipeline (without $facet) to allow further aggregation
		const byEmotionWithTasks = await aggregateProjectAndTaskDataByEmotion(cleanPipeline, emotions, totalDuration, userId);
		response.byEmotionWithTasks = byEmotionWithTasks;
	}

	return response;
}

async function groupByHour(pipeline: any[], taskFilterConditions: any[] = [], timezone: string = 'UTC') {
	// Use $facet to run totals calculation and grouping in a single query
	pipeline.push({
		$facet: {
			totals: buildTotalsPipelineStages(taskFilterConditions),
			byHour: [
				// Unwind tasks array to use task-level durations
				{ $unwind: { path: "$tasks", preserveNullAndEmptyArrays: false } },

				// Split each task across the hours it spans
				{
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
				},

				// Unwind the hour splits so each becomes a separate document
				{ $unwind: { path: "$taskHourSplits", preserveNullAndEmptyArrays: false } },

				// Group by hour
				{
					$group: {
						_id: "$taskHourSplits.hour",
						duration: { $sum: "$taskHourSplits.duration" },
						uniqueRecords: { $addToSet: "$_id" } // Collect unique focus record IDs
					}
				},

				{ $sort: { _id: 1 } }
			]
		}
	});

	const result = await FocusRecord.aggregate(pipeline);
	const facetResult = result[0];

	// Extract totals
	const totalRecords = facetResult.totals[0]?.total || 0;
	const totalDuration = facetResult.totals[0]?.totalDuration || 0;

	// Extract results
	const results = facetResult.byHour;

	// Fill in missing hours with 0
	const byHour = Array.from({ length: 24 }, (_, i) => {
		const hourData = results.find((r: any) => r._id === i);
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
	// Use $facet to run totals calculation and sorting in a single query
	pipeline.push({
		$facet: {
			totals: buildTotalsPipelineStages(taskFilterConditions),
			byRecord: [
				// Get individual records sorted by start time (oldest to newest)
				{ $sort: { startTime: 1 } }
			]
		}
	});

	const result = await FocusRecord.aggregate(pipeline);
	const facetResult = result[0];

	// Extract totals
	const totalRecords = facetResult.totals[0]?.total || 0;
	const totalDuration = facetResult.totals[0]?.totalDuration || 0;

	// Extract results
	const results = facetResult.byRecord;

	return {
		summary: {
			totalDuration,
			totalRecords,
			dateRange: { start: startDate || null, end: endDate || null }
		},
		byRecord: results.map((r: any) => ({
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

	const focusRecords = await FocusRecord.aggregate(aggPipeline);

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
