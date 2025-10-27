import Task from '../models/TaskModel';
import Project from '../models/projectModel';
import { buildTaskSearchFilter, buildTaskMatchConditions } from '../utils/taskFilterBuilders.utils';
import { BaseQueryParams } from '../utils/queryParams.utils';

// ============================================================================
// Overview Stats Service
// ============================================================================

export interface OverviewStatsQueryParams extends BaseQueryParams {
	// No additional fields needed - using base query params
}

export interface OverviewStats {
	numOfAllTasks: number;
	numOfCompletedTasks: number;
	numOfProjects: number;
	numOfDaysSinceAccountCreated: number;
}

/**
 * Get overview statistics including task counts, project counts, and account age
 * Supports filtering by projects, date range, search query, task sources, and specific taskId
 */
export async function getOverviewStats(params: OverviewStatsQueryParams): Promise<OverviewStats> {
	// Account created date (hardcoded as per requirement)
	const accountCreatedDate = new Date('2020-11-02');
	const today = new Date();
	const timeDiff = today.getTime() - accountCreatedDate.getTime();
	const numOfDaysSinceAccountCreated = Math.floor(timeDiff / (1000 * 60 * 60 * 24));

	// Build search filter
	const searchFilter = buildTaskSearchFilter(params.searchQuery);

	// Build filter for all tasks (no date filtering, but apply other filters)
	const allTasksFilter = buildTaskMatchConditions(
		params.taskId,
		params.projectIds,
		params.startDate,
		params.endDate,
		params.taskIdIncludeFocusRecordsFromSubtasks,
		params.toDoListAppSources,
		'createdTime' // Skip date filtering for all tasks
	);

	// Apply search filter to all tasks
	const allTasksQuery = searchFilter
		? { $and: [searchFilter, allTasksFilter] }
		: allTasksFilter;

	// Count all tasks with filters
	const numOfAllTasks = await Task.countDocuments(allTasksQuery);

	// Build filter for completed tasks (defaults to completedTime with date filtering)
	const completedTasksFilter = buildTaskMatchConditions(
		params.taskId,
		params.projectIds,
		params.startDate,
		params.endDate,
		params.taskIdIncludeFocusRecordsFromSubtasks,
		params.toDoListAppSources
	);

	// Apply search filter to completed tasks
	const completedTasksQuery = searchFilter
		? { $and: [searchFilter, completedTasksFilter] }
		: completedTasksFilter;

	// Count completed tasks with filters
	const numOfCompletedTasks = await Task.countDocuments(completedTasksQuery);

	// Build filter for projects
	const projectFilter: any = {};

	// Filter projects by projectIds
	if (params.projectIds.length > 0) {
		projectFilter.id = { $in: params.projectIds };
	}

	// Count projects with filters
	const numOfProjects = await Project.countDocuments(projectFilter);

	return {
		numOfAllTasks,
		numOfCompletedTasks,
		numOfProjects,
		numOfDaysSinceAccountCreated
	};
}
