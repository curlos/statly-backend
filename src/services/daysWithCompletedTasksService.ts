import { Task } from '../models/TaskModel';
import { buildTaskSearchFilter, buildTaskMatchConditions } from '../utils/taskFilterBuilders.utils';
import { buildAncestorData } from '../utils/task.utils';
import { DaysWithCompletedTasksQueryParams } from '../utils/queryParams.utils';

// ============================================================================
// Sort Criteria Builder
// ============================================================================

function buildSortStage(sortBy: string) {
	switch (sortBy) {
		case 'Oldest':
			return { $sort: { firstCompletedTime: 1 } };
		case 'Completed Tasks: Most-Least':
			return { $sort: { taskCount: -1 } };
		case 'Completed Tasks: Least-Most':
			return { $sort: { taskCount: 1 } };
		case 'Newest':
		default:
			return { $sort: { firstCompletedTime: -1 } };
	}
}

// ============================================================================
// Main Service Method
// ============================================================================

export async function getDaysWithCompletedTasks(params: DaysWithCompletedTasksQueryParams) {
	// Build filters using shared builder
	const searchFilter = buildTaskSearchFilter(params.searchQuery);
	const matchFilter = buildTaskMatchConditions(
		params.taskId,
		params.projectIds,
		params.startDate,
		params.endDate,
		params.taskIdIncludeSubtasks,
		params.toDoListAppSources
	);

	// Build aggregation pipeline
	const aggregationPipeline: any[] = [];

	// Step 1: Apply search filter if it exists
	if (searchFilter) {
		aggregationPipeline.push({ $match: searchFilter });
	}

	// Step 2: Filter completed tasks and apply other filters
	aggregationPipeline.push({ $match: matchFilter });

	// Step 3: Sort by completedTime ascending (oldest first within each day)
	aggregationPipeline.push({ $sort: { completedTime: 1 } });

	// Step 4: Group tasks by formatted date string (in user's timezone)
	aggregationPipeline.push({
		$group: {
			_id: {
				$dateToString: {
					format: "%B %d, %Y",
					date: "$completedTime",
					timezone: params.timezone
				}
			},
			completedTasksForDay: { $push: "$$ROOT" },
			firstCompletedTime: { $first: "$completedTime" },
			taskCount: { $sum: 1 }
		}
	});

	// Step 5: Sort based on sortBy parameter
	aggregationPipeline.push(buildSortStage(params.sortBy));

	// Step 6: Paginate days (not tasks)
	aggregationPipeline.push(
		{ $skip: params.page * params.maxDaysPerPage },
		{ $limit: params.maxDaysPerPage }
	);

	// Step 7: Format output
	aggregationPipeline.push({
		$project: {
			dateStr: "$_id",
			completedTasksForDay: 1,
			_id: 0
		}
	});

	const result = await Task.aggregate(aggregationPipeline);

	// Extract all tasks from the paginated days
	const allTasksInPage: any[] = [];
	result.forEach(day => {
		allTasksInPage.push(...day.completedTasksForDay);
	});

	// Build ancestor data for all tasks
	const { ancestorTasksById } = await buildAncestorData(allTasksInPage);

	// Build count pipelines
	const countDaysPipeline: any[] = [];
	const countTasksPipeline: any[] = [];

	// Add search filter to both count pipelines if it exists
	if (searchFilter) {
		countDaysPipeline.push({ $match: searchFilter });
		countTasksPipeline.push({ $match: searchFilter });
	}

	// Add match filter to both
	countDaysPipeline.push({ $match: matchFilter });
	countTasksPipeline.push({ $match: matchFilter });

	// Count total tasks (before grouping)
	countTasksPipeline.push({ $count: "total" });

	// Count total days (after grouping by date)
	countDaysPipeline.push({
		$group: {
			_id: {
				$dateToString: {
					format: "%B %d, %Y",
					date: "$completedTime",
					timezone: params.timezone
				}
			}
		}
	});
	countDaysPipeline.push({ $count: "total" });

	// Run both counts in parallel with main query results
	const [totalTasksResult, totalDaysResult] = await Promise.all([
		Task.aggregate(countTasksPipeline),
		Task.aggregate(countDaysPipeline)
	]);

	const totalTasks = totalTasksResult[0]?.total || 0;
	const totalDays = totalDaysResult[0]?.total || 0;
	const totalPages = Math.ceil(totalDays / params.maxDaysPerPage);

	// Calculate hasMore by checking if there's another day after this page
	const hasMore = (params.page + 1) * params.maxDaysPerPage < totalDays;

	return {
		data: result,
		ancestorTasksById,
		totalTasks,
		totalPages,
		page: params.page,
		limit: params.maxDaysPerPage,
		hasMore,
	};
}
