import Task from '../models/TaskModel';
import { buildAncestorData } from '../utils/task.utils';
import { getDateGroupingExpression } from '../utils/filterBuilders.utils';
import { buildTaskSearchFilter, buildTaskMatchConditions } from '../utils/taskFilterBuilders.utils';

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

export async function getCompletedTasksStats(params: CompletedTasksStatsQueryParams) {
	// Build filters (reuse existing filter logic)
	const searchFilter = buildTaskSearchFilter(params.searchQuery);
	const matchConditions = buildTaskMatchConditions(
		params.taskId,
		params.projectIds,
		params.startDate,
		params.endDate,
		params.taskIdIncludeSubtasks,
		params.toDoListAppSources,
		'completedTime',
		params.intervalStartDate,
		params.intervalEndDate
	);

	// Build base pipeline with filters
	const basePipeline: any[] = [];

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
			return await groupByProject(basePipeline, nested);
		case 'task':
			return await groupByTask(basePipeline, nested);
		default:
			throw new Error(`Invalid group-by parameter: ${params.groupBy}`);
	}
}

// ============================================================================
// Aggregation Helper Functions
// ============================================================================

/**
 * Shared helper to calculate totals for completed tasks.
 */
async function calculateTotals(pipeline: any[]) {
	const totalsPipeline = [...pipeline];
	totalsPipeline.push({
		$group: {
			_id: null,
			totalCount: { $sum: 1 }
		}
	});

	const totalsResult = await Task.aggregate(totalsPipeline);
	const totalCount = totalsResult.length > 0 ? totalsResult[0].totalCount : 0;

	return { totalCount };
}

/**
 * Shared helper to aggregate task-level data and fetch ancestor information.
 */
async function aggregateTaskData(pipeline: any[], totalCount: number) {
	const taskResults = await Task.aggregate(pipeline);

	let ancestorTasksById: Record<string, any> = {};

	if (taskResults.length > 0) {
		const ancestorData = await buildAncestorData(taskResults);
		ancestorTasksById = ancestorData.ancestorTasksById;

		taskResults.forEach((task: any) => {
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
	const byTask = taskResults.map(r => {
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

async function groupByDay(pipeline: any[], startDate?: string, endDate?: string, timezone: string = 'UTC') {
	// Calculate totals
	const { totalCount } = await calculateTotals(pipeline);

	// Group by date
	const aggPipeline = [...pipeline];
	aggPipeline.push({
		$group: {
			_id: {
				$dateToString: { format: "%Y-%m-%d", date: "$completedTime", timezone: timezone }
			},
			count: { $sum: 1 }
		}
	});

	aggPipeline.push({ $sort: { _id: 1 } });

	const results = await Task.aggregate(aggPipeline);

	return {
		summary: {
			totalCount,
			dateRange: { start: startDate || null, end: endDate || null }
		},
		byDay: results.map(r => ({
			date: r._id,
			count: r.count
		}))
	};
}

async function groupByWeek(pipeline: any[], startDate?: string, endDate?: string, timezone: string = 'UTC') {
	// Calculate totals
	const { totalCount } = await calculateTotals(pipeline);

	// Group by week (Monday of each week)
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
		$group: {
			_id: getDateGroupingExpression('weekly', timezone, '$completedTime'),
			weekStartDate: { $first: "$weekStartDate" },
			count: { $sum: 1 }
		}
	});

	// Sort by actual date, not the formatted string
	aggPipeline.push({ $sort: { weekStartDate: 1 } });

	const results = await Task.aggregate(aggPipeline);

	return {
		summary: {
			totalCount,
			dateRange: { start: startDate || null, end: endDate || null }
		},
		byWeek: results.map(r => ({
			date: r._id, // Format: "January 1, 2025" (Monday of the week)
			count: r.count
		}))
	};
}

async function groupByMonth(pipeline: any[], startDate?: string, endDate?: string, timezone: string = 'UTC') {
	// Calculate totals
	const { totalCount } = await calculateTotals(pipeline);

	// Group by month
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
		$group: {
			_id: getDateGroupingExpression('monthly', timezone, '$completedTime'),
			monthStartDate: { $first: "$monthStartDate" },
			count: { $sum: 1 }
		}
	});

	// Sort by actual date, not the formatted string
	aggPipeline.push({ $sort: { monthStartDate: 1 } });

	const results = await Task.aggregate(aggPipeline);

	return {
		summary: {
			totalCount,
			dateRange: { start: startDate || null, end: endDate || null }
		},
		byMonth: results.map(r => ({
			date: r._id, // Format: "January 2025"
			count: r.count
		}))
	};
}

async function groupByYear(pipeline: any[], startDate?: string, endDate?: string, timezone: string = 'UTC') {
	// Calculate totals
	const { totalCount } = await calculateTotals(pipeline);

	// Group by year
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
		$group: {
			_id: {
				$dateToString: { format: "%Y", date: "$completedTime", timezone: timezone }
			},
			yearStartDate: { $first: "$yearStartDate" },
			count: { $sum: 1 }
		}
	});

	// Sort by actual date, not the formatted string
	aggPipeline.push({ $sort: { yearStartDate: 1 } });

	const results = await Task.aggregate(aggPipeline);

	return {
		summary: {
			totalCount,
			dateRange: { start: startDate || null, end: endDate || null }
		},
		byYear: results.map(r => ({
			date: r._id, // Format: "2025"
			count: r.count
		}))
	};
}

async function groupByProject(pipeline: any[], nested: boolean = false) {
	// Calculate totals
	const { totalCount } = await calculateTotals(pipeline);

	const aggPipeline = [...pipeline];

	// Group by both projectId and source (composite key)
	aggPipeline.push({
		$group: {
			_id: {
				projectId: "$projectId",
				source: "$source"
			},
			count: { $sum: 1 }
		}
	});

	aggPipeline.push({ $sort: { count: -1 } });

	const results = await Task.aggregate(aggPipeline);

	const response: any = {
		summary: {
			totalCount,
			dateRange: { start: null, end: null }
		},
		byProject: results.map(r => {
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

	// If nested, also fetch task-level data and ancestorTasksById
	if (nested) {
		const { byTask, ancestorTasksById } = await aggregateTaskData(pipeline, totalCount);
		response.byTask = byTask;
		response.ancestorTasksById = ancestorTasksById;
	}

	return response;
}

async function groupByTask(pipeline: any[], nested: boolean = false) {
	// Calculate totals
	const { totalCount } = await calculateTotals(pipeline);

	const response: any = {
		summary: {
			totalCount,
			dateRange: { start: null, end: null }
		}
	};

	// Use shared helper to aggregate task data
	const { byTask, ancestorTasksById } = await aggregateTaskData(pipeline, totalCount);
	response.byTask = byTask;

	// Always include ancestorTasksById for task grouping on frontend
	response.ancestorTasksById = ancestorTasksById;

	return response;
}
