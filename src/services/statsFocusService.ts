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

// ============================================================================
// Stats Aggregation Service
// ============================================================================

export interface FocusRecordsStatsQueryParams {
	projectIds: string[];
	taskId?: string;
	startDate?: string;
	endDate?: string;
	taskIdIncludeFocusRecordsFromSubtasks: boolean;
	searchQuery?: string;
	focusAppSources: string[];
	toDoListAppSources: string[];
	crossesMidnight?: boolean;
	groupBy: string; // 'day' | 'project' | 'task' | 'hour' | 'timeline'
	nested?: boolean; // If true, include ancestorTasksById for nested display
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
		params.crossesMidnight
	);

	// Calculate the date boundaries for duration adjustment
	const startDateBoundary = params.startDate ? new Date(params.startDate) : null;
	let endDateBoundary: Date | null = null;
	if (params.endDate) {
		endDateBoundary = new Date(params.endDate);
		endDateBoundary.setDate(endDateBoundary.getDate() + 1);
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
			return await groupByDay(basePipeline, params.startDate, params.endDate, taskFilterConditions);
		case 'project':
			return await groupByProject(basePipeline, taskFilterConditions, nested);
		case 'task':
			return await groupByTask(basePipeline, taskFilterConditions, nested);
		// case 'hour':
		// 	return await groupByHour(basePipeline, taskFilterConditions);
		// case 'timeline':
		// 	return await getTimeline(basePipeline);
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

async function groupByDay(pipeline: any[], startDate?: string, endDate?: string, taskFilterConditions: any[] = []) {
	// Calculate totals using task-level durations (not focus record durations)
	const { totalRecords, totalDuration } = await calculateTotals(pipeline, taskFilterConditions);

	// Now group by date for the byDay breakdown
	// Unwind tasks array to use task-level durations
	const aggPipeline = [...pipeline];
	aggPipeline.push({ $unwind: { path: "$tasks", preserveNullAndEmptyArrays: false } });

	aggPipeline.push({
		$group: {
			_id: {
				$dateToString: { format: "%Y-%m-%d", date: "$startTime" }
			},
			duration: { $sum: "$tasks.duration" },
			count: { $sum: 1 }
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
			count: r.count
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

	// Only include ancestorTasksById if nested=true
	if (nested) {
		response.ancestorTasksById = ancestorTasksById;
	}

	return response;
}

// async function groupByHour(pipeline: any[], taskFilterConditions: any[] = []) {
// 	// Calculate totals using task-level durations
// 	const { totalRecords, totalDuration } = await calculateTotals(pipeline, taskFilterConditions);

// 	const aggPipeline = [...pipeline];

// 	// Unwind tasks array to use task-level durations
// 	aggPipeline.push({ $unwind: { path: "$tasks", preserveNullAndEmptyArrays: false } });

// 	// Extract hour from startTime
// 	aggPipeline.push({
// 		$addFields: {
// 			hour: { $hour: "$startTime" }
// 		}
// 	});

// 	// Group by hour
// 	aggPipeline.push({
// 		$group: {
// 			_id: "$hour",
// 			duration: { $sum: "$tasks.duration" },
// 			count: { $sum: 1 }
// 		}
// 	});

// 	aggPipeline.push({ $sort: { _id: 1 } });

// 	const results = await FocusRecordTickTick.aggregate(aggPipeline);

// 	// Fill in missing hours with 0
// 	const byHour = Array.from({ length: 24 }, (_, i) => {
// 		const hourData = results.find(r => r._id === i);
// 		return {
// 			hour: i,
// 			duration: hourData?.duration || 0,
// 			count: hourData?.count || 0
// 		};
// 	});

// 	return {
// 		summary: {
// 			totalDuration,
// 			totalRecords,
// 			dateRange: { start: null, end: null }
// 		},
// 		byHour
// 	};
// }

// async function getTimeline(pipeline: any[]) {
// 	const aggPipeline = [...pipeline];

// 	// Sort by start time
// 	aggPipeline.push({ $sort: { startTime: 1 } });

// 	const focusRecords = await FocusRecordTickTick.aggregate(aggPipeline);

// 	// Calculate summary
// 	const totalDuration = focusRecords.reduce((sum, record) => sum + (record.duration || 0), 0);
// 	const totalRecords = focusRecords.length;

// 	// Format records for timeline view
// 	const records = focusRecords.flatMap(record => {
// 		return (record.tasks || []).map((task: any) => ({
// 			id: record.id || record._id.toString(),
// 			taskId: task.taskId,
// 			taskName: task.title,
// 			projectId: task.projectId,
// 			projectName: task.projectName,
// 			projectColor: '#808080', // Default color
// 			startTime: task.startTime,
// 			endTime: task.endTime,
// 			duration: task.duration
// 		}));
// 	});

// 	return {
// 		summary: {
// 			totalDuration,
// 			totalRecords,
// 			dateRange: { start: null, end: null }
// 		},
// 		records
// 	};
// }
