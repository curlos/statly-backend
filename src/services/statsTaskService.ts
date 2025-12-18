import { Types } from 'mongoose';
import Task from '../models/TaskModel';
import { buildAncestorData } from '../utils/task.utils';
import { getDateGroupingExpression } from '../utils/filterBuilders.utils';
import { buildTaskSearchFilter, buildTaskMatchConditions } from '../utils/taskFilterBuilders.utils';
import { PipelineStage } from 'mongoose';
import { TaskAncestorInfo } from '../types/aggregation';

// Service-specific types
interface TaskResult {
	id: string;
	title: string;
	parentId?: string | null;
	projectId?: string | null;
	ancestorIds: string[];
	[key: string]: unknown;
}

interface DateGroupResult {
	_id: string;
	count: number;
	[key: string]: unknown;
}

interface ProjectGroupResult {
	_id: {
		projectId?: string;
		source?: string;
	};
	count: number;
}

interface StatsResponse {
	summary: {
		totalCount: number;
		dateRange: { start: string | null; end: string | null };
	};
	byTask?: Array<{
		id: string;
		name: string;
		projectId?: string | null;
		count: number;
		percentage: number;
		type: string;
	}>;
	byProject?: Array<{
		id: string;
		count: number;
		percentage: number;
		type: string;
	}>;
	ancestorTasksById?: Record<string, TaskAncestorInfo>;
	[key: string]: unknown;
}

// ============================================================================
// Stats Aggregation Service for Completed Tasks
// ============================================================================

export interface CompletedTasksStatsQueryParams {
	projectIds: string[];
	taskId?: string;
	startDate?: string; // Filter Sidebar dates (first tier filter)
	endDate?: string; // Filter Sidebar dates (first tier filter)
	intervalStartDate?: string; // Interval Dropdown dates (second tier filter)
	intervalEndDate?: string; // Interval Dropdown dates (second tier filter)
	taskIdIncludeSubtasks: boolean;
	searchQuery?: string;
	toDoListAppSources: string[];
	timezone: string;
	groupBy: string; // 'day' | 'week' | 'month' | 'year' | 'project' | 'task'
	nested?: boolean; // If true, include ancestorTasksById for nested display
}

export async function getCompletedTasksStats(params: CompletedTasksStatsQueryParams, userId: Types.ObjectId) {
	// Build filters (reuse existing filter logic)
	const searchFilter = buildTaskSearchFilter(params.searchQuery);
	const matchConditions = buildTaskMatchConditions(
		userId,
		params.taskId,
		params.projectIds,
		params.startDate,
		params.endDate,
		params.taskIdIncludeSubtasks,
		params.toDoListAppSources,
		'completedTime',
		params.intervalStartDate,
		params.intervalEndDate,
		params.timezone
	);

	// Build base pipeline with filters
	const basePipeline: PipelineStage[] = [];

	// Step 1: Apply search filter if it exists
	if (searchFilter) {
		basePipeline.push({ $match: searchFilter });
	}

	// Step 2: Apply match conditions (includes two-tier date filtering)
	basePipeline.push({ $match: matchConditions });

	// Apply grouping based on groupBy parameter
	const nested = params.nested ?? false;

	// Use interval dates if provided (second tier), otherwise use filter sidebar dates (first tier)
	const effectiveStartDate = params.intervalStartDate || params.startDate;
	const effectiveEndDate = params.intervalEndDate || params.endDate;

	switch (params.groupBy) {
		case 'day':
			return await groupByDay(basePipeline, effectiveStartDate, effectiveEndDate, params.timezone);
		case 'week':
			return await groupByWeek(basePipeline, effectiveStartDate, effectiveEndDate, params.timezone);
		case 'month':
			return await groupByMonth(basePipeline, effectiveStartDate, effectiveEndDate, params.timezone);
		case 'year':
			return await groupByYear(basePipeline, effectiveStartDate, effectiveEndDate, params.timezone);
		case 'project':
			return await groupByProject(basePipeline, nested, userId);
		case 'task':
			return await groupByTask(basePipeline, nested, userId);
		default:
			throw new Error(`Invalid group-by parameter: ${params.groupBy}`);
	}
}

// ============================================================================
// Aggregation Helper Functions
// ============================================================================

/**
 * Shared helper to process task results and fetch ancestor information.
 * This processes task documents that were already fetched (e.g., from a $facet).
 */
async function processTaskResults(taskResults: TaskResult[], totalCount: number, userId: Types.ObjectId) {
	let ancestorTasksById: Record<string, TaskAncestorInfo> = {};

	if (taskResults.length > 0) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const ancestorData = await buildAncestorData(taskResults as any, userId);
		ancestorTasksById = ancestorData.ancestorTasksById;

		taskResults.forEach((task: TaskResult) => {
			ancestorTasksById[task.id] = {
				id: task.id,
				title: task.title,
				parentId: task.parentId ?? null,
				ancestorIds: task.ancestorIds,
				projectId: task.projectId ?? null
			};
		});
	}

	// Calculate percentage once for all tasks (since each task appears exactly once)
	const percentage = totalCount > 0 ? (1 / totalCount) * 100 : 0;
	const formattedPercentage = Number(percentage.toFixed(2));

	// Map results to formatted task data
	const byTask = taskResults.map((r: TaskResult) => {
		return {
			id: r.id,
			name: r.title || 'Unknown Task',
			projectId: r.projectId,
			count: 1,
			percentage: formattedPercentage,
			type: 'task'
		};
	});

	return { byTask, ancestorTasksById };
}

// ============================================================================
// Grouping Functions
// ============================================================================

async function groupByDay(pipeline: PipelineStage[], startDate?: string, endDate?: string, timezone: string = 'UTC') {
	// Use $facet to calculate totals and group by date in a single query
	const aggPipeline = [...pipeline];
	aggPipeline.push({
		$facet: {
			totals: [
				{ $group: { _id: null, totalCount: { $sum: 1 } } }
			],
			byDay: [
				{
					$group: {
						_id: {
							$dateToString: { format: "%Y-%m-%d", date: "$completedTime", timezone: timezone }
						},
						count: { $sum: 1 }
					}
				},
				{ $sort: { _id: 1 } }
			]
		}
	});

	const result = await Task.aggregate(aggPipeline);
	const facetResult = result[0];
	const totalCount = facetResult.totals[0]?.totalCount || 0;

	return {
		summary: {
			totalCount,
			dateRange: { start: startDate || null, end: endDate || null }
		},
		byDay: facetResult.byDay.map((r: DateGroupResult) => ({
			date: r._id,
			count: r.count
		}))
	};
}

async function groupByWeek(pipeline: PipelineStage[], startDate?: string, endDate?: string, timezone: string = 'UTC') {
	// Use $facet to calculate totals and group by week in a single query
	const aggPipeline = [...pipeline];

	// Add a field to get the Monday of the week for sorting purposes
	aggPipeline.push({
		$addFields: {
			weekStartDate: {
				$dateSubtract: {
					startDate: "$completedTime",
					unit: "day",
					amount: {
						$subtract: [
							{ $isoDayOfWeek: { date: "$completedTime", timezone: timezone } },
							1
						]
					},
					timezone: timezone
				}
			}
		}
	});

	aggPipeline.push({
		$facet: {
			totals: [
				{ $group: { _id: null, totalCount: { $sum: 1 } } }
			],
			byWeek: [
				{
					$group: {
						_id: getDateGroupingExpression('weekly', timezone, '$completedTime'),
						weekStartDate: { $first: "$weekStartDate" },
						count: { $sum: 1 }
					}
				},
				{ $sort: { weekStartDate: 1 } }
			]
		}
	});

	const result = await Task.aggregate(aggPipeline);
	const facetResult = result[0];
	const totalCount = facetResult.totals[0]?.totalCount || 0;

	return {
		summary: {
			totalCount,
			dateRange: { start: startDate || null, end: endDate || null }
		},
		byWeek: facetResult.byWeek.map((r: DateGroupResult) => ({
			date: r._id, // Format: "January 1, 2025" (Monday of the week)
			count: r.count
		}))
	};
}

async function groupByMonth(pipeline: PipelineStage[], startDate?: string, endDate?: string, timezone: string = 'UTC') {
	// Use $facet to calculate totals and group by month in a single query
	const aggPipeline = [...pipeline];

	// Add a field to get the first day of the month for sorting purposes
	aggPipeline.push({
		$addFields: {
			monthStartDate: {
				$dateTrunc: {
					date: "$completedTime",
					unit: "month",
					timezone: timezone
				}
			}
		}
	});

	aggPipeline.push({
		$facet: {
			totals: [
				{ $group: { _id: null, totalCount: { $sum: 1 } } }
			],
			byMonth: [
				{
					$group: {
						_id: getDateGroupingExpression('monthly', timezone, '$completedTime'),
						monthStartDate: { $first: "$monthStartDate" },
						count: { $sum: 1 }
					}
				},
				{ $sort: { monthStartDate: 1 } }
			]
		}
	});

	const result = await Task.aggregate(aggPipeline);
	const facetResult = result[0];
	const totalCount = facetResult.totals[0]?.totalCount || 0;

	return {
		summary: {
			totalCount,
			dateRange: { start: startDate || null, end: endDate || null }
		},
		byMonth: facetResult.byMonth.map((r: DateGroupResult) => ({
			date: r._id, // Format: "January 2025"
			count: r.count
		}))
	};
}

async function groupByYear(pipeline: PipelineStage[], startDate?: string, endDate?: string, timezone: string = 'UTC') {
	// Use $facet to calculate totals and group by year in a single query
	const aggPipeline = [...pipeline];

	// Add a field to get the first day of the year for sorting purposes
	aggPipeline.push({
		$addFields: {
			yearStartDate: {
				$dateTrunc: {
					date: "$completedTime",
					unit: "year",
					timezone: timezone
				}
			}
		}
	});

	aggPipeline.push({
		$facet: {
			totals: [
				{ $group: { _id: null, totalCount: { $sum: 1 } } }
			],
			byYear: [
				{
					$group: {
						_id: {
							$dateToString: { format: "%Y", date: "$completedTime", timezone: timezone }
						},
						yearStartDate: { $first: "$yearStartDate" },
						count: { $sum: 1 }
					}
				},
				{ $sort: { yearStartDate: 1 } }
			]
		}
	});

	const result = await Task.aggregate(aggPipeline);
	const facetResult = result[0];
	const totalCount = facetResult.totals[0]?.totalCount || 0;

	return {
		summary: {
			totalCount,
			dateRange: { start: startDate || null, end: endDate || null }
		},
		byYear: facetResult.byYear.map((r: DateGroupResult) => ({
			date: r._id, // Format: "2025"
			count: r.count
		}))
	};
}

async function groupByProject(pipeline: PipelineStage[], nested: boolean = false, userId: Types.ObjectId) {
	// Use $facet to calculate totals and group by project in a single query
	const aggPipeline = [...pipeline];

	const facetStages: Record<string, PipelineStage[]> = {
		totals: [
			{ $group: { _id: null, totalCount: { $sum: 1 } } }
		],
		byProject: [
			{
				$group: {
					_id: {
						projectId: "$projectId",
						source: "$source"
					},
					count: { $sum: 1 }
				}
			},
			{ $sort: { count: -1 } }
		]
	};

	// If nested, also fetch all tasks in the same query
	if (nested) {
		facetStages.tasks = [];
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	aggPipeline.push({ $facet: facetStages as any });

	const result = await Task.aggregate(aggPipeline);
	const facetResult = result[0];
	const totalCount = facetResult.totals[0]?.totalCount || 0;

	const response: StatsResponse = {
		summary: {
			totalCount,
			dateRange: { start: null, end: null }
		},
		byProject: facetResult.byProject.map((r: ProjectGroupResult) => {
			const percentage = totalCount > 0 ? (r.count / totalCount) * 100 : 0;
			const projectId = r._id.projectId || r._id.source;

			return {
				id: projectId,
				count: r.count,
				percentage: Number(percentage.toFixed(2)),
				type: 'project'
			};
		})
	};

	// If nested, process the task results that were fetched in the same query
	if (nested) {
		const { byTask, ancestorTasksById } = await processTaskResults(facetResult.tasks, totalCount, userId);
		response.byTask = byTask;
		response.ancestorTasksById = ancestorTasksById;
	}

	return response;
}

async function groupByTask(pipeline: PipelineStage[], _nested: boolean = false, userId: Types.ObjectId) {
	// Use $facet to calculate totals and fetch all tasks in a single query
	const aggPipeline = [...pipeline];

	aggPipeline.push({
		$facet: {
			totals: [
				{ $group: { _id: null, totalCount: { $sum: 1 } } }
			],
			tasks: []
		}
	});

	const result = await Task.aggregate(aggPipeline);
	const facetResult = result[0];
	const totalCount = facetResult.totals[0]?.totalCount || 0;

	// Process the task results that were fetched in the same query
	const { byTask, ancestorTasksById } = await processTaskResults(facetResult.tasks, totalCount, userId);

	const response: StatsResponse = {
		summary: {
			totalCount,
			dateRange: { start: null, end: null }
		},
		byTask,
		ancestorTasksById
	};

	return response;
}
