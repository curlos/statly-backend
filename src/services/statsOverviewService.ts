import Task from '../models/TaskModel';
import Project from '../models/projectModel';
import FocusRecordTickTick from '../models/FocusRecord';
import { buildTaskSearchFilter, buildTaskMatchConditions } from '../utils/taskFilterBuilders.utils';
import { buildFocusMatchAndFilterConditions, buildFocusSearchFilter } from '../utils/focusFilterBuilders.utils';
import { BaseQueryParams } from '../utils/queryParams.utils';

// ============================================================================
// Overview Stats Service
// ============================================================================

export interface OverviewStatsQueryParams extends BaseQueryParams {
	// No additional fields needed - using base query params
}

export interface OverviewStats {
	totalTasksCount: number;
	totalCompletedTasksCount: number;
	totalProjectsCount: number;
	numOfDaysSinceAccountCreated: number;
	todayCompletedTasksCount: number;
	todayFocusRecordCount: number;
	todayFocusDuration: number;
	totalFocusRecordCount: number;
	totalFocusDuration: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get task statistics using $facet to run all counts in parallel
 */
async function getTaskStats(params: OverviewStatsQueryParams, todayDateString: string) {
	const searchFilter = buildTaskSearchFilter(params.searchQuery);

	// Build filter for all tasks
	const allTasksFilter = buildTaskMatchConditions(
		params.taskId,
		params.projectIds,
		params.startDate,
		params.endDate,
		params.taskIdIncludeFocusRecordsFromSubtasks,
		params.toDoListAppSources,
		'createdTime',
		undefined,
		undefined,
		params.timezone
	);

	// Build filter for completed tasks
	const completedTasksFilter = buildTaskMatchConditions(
		params.taskId,
		params.projectIds,
		params.startDate,
		params.endDate,
		params.taskIdIncludeFocusRecordsFromSubtasks,
		params.toDoListAppSources,
		'completedTime',
		undefined,
		undefined,
		params.timezone
	);

	// Build filter for today's completed tasks
	const todayCompletedTasksFilter = buildTaskMatchConditions(
		params.taskId,
		params.projectIds,
		todayDateString,
		todayDateString,
		params.taskIdIncludeFocusRecordsFromSubtasks,
		params.toDoListAppSources,
		'completedTime',
		undefined,
		undefined,
		params.timezone
	);

	// Apply search filters
	const allTasksQuery = searchFilter ? { $and: [searchFilter, allTasksFilter] } : allTasksFilter;
	const completedTasksQuery = searchFilter ? { $and: [searchFilter, completedTasksFilter] } : completedTasksFilter;
	const todayCompletedTasksQuery = searchFilter ? { $and: [searchFilter, todayCompletedTasksFilter] } : todayCompletedTasksFilter;

	// Run all task counts in parallel using $facet
	const [result] = await Task.aggregate([
		{
			$facet: {
				allTasks: [
					{ $match: allTasksQuery },
					{ $count: 'count' }
				],
				completedTasks: [
					{ $match: completedTasksQuery },
					{ $count: 'count' }
				],
				todayCompletedTasks: [
					{ $match: todayCompletedTasksQuery },
					{ $count: 'count' }
				]
			}
		}
	]);

	return {
		totalTasksCount: result?.allTasks[0]?.count || 0,
		totalCompletedTasksCount: result?.completedTasks[0]?.count || 0,
		todayCompletedTasksCount: result?.todayCompletedTasks[0]?.count || 0
	};
}

/**
 * Get focus record statistics using $facet to run today & all-time stats in parallel
 */
async function getFocusStats(params: OverviewStatsQueryParams, todayDateString: string) {
	// Build search filter
	const searchFilter = buildFocusSearchFilter(params.searchQuery);

	// Build today's focus record filter
	const { focusRecordMatchConditions: todayFocusMatch } = buildFocusMatchAndFilterConditions(
		params.taskId,
		params.projectIds,
		todayDateString,
		todayDateString,
		params.taskIdIncludeFocusRecordsFromSubtasks,
		params.focusAppSources,
		params.crossesMidnight,
		null,
		null,
		params.emotions,
		params.timezone
	);

	// Build all-time focus record filter
	const { focusRecordMatchConditions: totalFocusMatch } = buildFocusMatchAndFilterConditions(
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

	// Apply search filters
	const todayFocusQuery = searchFilter ? { $and: [searchFilter, todayFocusMatch] } : todayFocusMatch;
	const totalFocusQuery = searchFilter ? { $and: [searchFilter, totalFocusMatch] } : totalFocusMatch;

	// Run both focus queries in parallel using $facet
	const [result] = await FocusRecordTickTick.aggregate([
		{
			$facet: {
				todayStats: [
					{ $match: todayFocusQuery },
					{
						$group: {
							_id: null,
							count: { $sum: 1 },
							duration: {
								$sum: {
									$reduce: {
										input: "$tasks",
										initialValue: 0,
										in: { $add: ["$$value", "$$this.duration"] }
									}
								}
							}
						}
					}
				],
				totalStats: [
					{ $match: totalFocusQuery },
					{
						$group: {
							_id: null,
							count: { $sum: 1 },
							duration: {
								$sum: {
									$reduce: {
										input: "$tasks",
										initialValue: 0,
										in: { $add: ["$$value", "$$this.duration"] }
									}
								}
							}
						}
					}
				]
			}
		}
	]);

	return {
		todayFocusRecordCount: result?.todayStats[0]?.count || 0,
		todayFocusDuration: result?.todayStats[0]?.duration || 0,
		totalFocusRecordCount: result?.totalStats[0]?.count || 0,
		totalFocusDuration: result?.totalStats[0]?.duration || 0
	};
}

/**
 * Get project count
 */
async function getProjectStats(params: OverviewStatsQueryParams) {
	const projectFilter: any = {};

	if (params.projectIds.length > 0) {
		projectFilter.id = { $in: params.projectIds };
	}

	const totalProjectsCount = await Project.countDocuments(projectFilter);
	return { totalProjectsCount };
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

	// Calculate today's date in user's timezone
	const tz = params.timezone || 'UTC';
	const now = new Date();
	const todayDateString = now.toLocaleDateString('en-US', {
		timeZone: tz,
		year: 'numeric',
		month: 'long',
		day: 'numeric'
	});

	// Run all stats queries in parallel
	const [taskStats, focusStats, projectStats] = await Promise.all([
		getTaskStats(params, todayDateString),
		getFocusStats(params, todayDateString),
		getProjectStats(params)
	]);

	return {
		...taskStats,
		...focusStats,
		...projectStats,
		numOfDaysSinceAccountCreated
	};
}
