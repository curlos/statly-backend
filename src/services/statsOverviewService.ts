import { Types } from 'mongoose';
import Task from '../models/TaskModel';
import Project from '../models/ProjectModel';
import FocusRecordTickTick from '../models/FocusRecord';
import { buildTaskSearchFilter, buildTaskMatchConditions } from '../utils/taskFilterBuilders.utils';
import { buildFocusMatchAndFilterConditions, buildFocusSearchFilter } from '../utils/focusFilterBuilders.utils';
import { BaseQueryParams } from '../utils/queryParams.utils';
import { PipelineStage } from 'mongoose';
import { MongooseFilter } from '../types/aggregation';
import { addMidnightRecordDurationAdjustment, addYearAgnosticMidnightAdjustment } from '../utils/focus.utils';
import { calculateEffectiveDateBoundaries, parseDateInTimezone } from '../utils/timezone.utils';

// ============================================================================
// Overview Stats Service
// ============================================================================

export interface OverviewStatsQueryParams extends BaseQueryParams {
	skipTodayStats?: boolean;
	includeFirstData?: boolean;
}

export interface OverviewStats {
	totalTasksCount: number;
	totalCompletedTasksCount: number;
	totalProjectsCount: number;
	activeDays: number;
	todayCompletedTasksCount?: number;
	todayFocusRecordCount?: number;
	todayFocusDuration?: number;
	totalFocusRecordCount: number;
	totalFocusDuration: number;
	firstCompletedTaskDate?: string | null;
	firstFocusRecordDate?: string | null;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get task statistics using $facet to run all counts in parallel
 */
async function getTaskStats(userId: Types.ObjectId, params: OverviewStatsQueryParams, todayDateString: string, skipTodayStats: boolean) {
	const searchFilter = buildTaskSearchFilter(params.searchQuery);

	// Build filter for all tasks
	const allTasksFilter = buildTaskMatchConditions(
		userId,
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
		userId,
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
		userId,
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

	// Build facet stages based on skipTodayStats
	const facetStages: Record<string, PipelineStage[]> = {
		allTasks: [
			{ $match: allTasksQuery },
			{ $count: 'count' }
		],
		completedTasks: [
			{ $match: completedTasksQuery },
			{ $count: 'count' }
		]
	};

	if (!skipTodayStats) {
		facetStages.todayCompletedTasks = [
			{ $match: todayCompletedTasksQuery },
			{ $count: 'count' }
		];
	}

	// Run all task counts in parallel using $facet
	// TypeScript expects FacetPipelineStage[] but mongoose doesn't export this type.
	// Our stages are valid for $facet, so we cast to any to bypass the type check.
	const [result] = await Task.aggregate([
		{
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			$facet: facetStages as any
		}
	]);

	const stats: Record<string, number> = {
		totalTasksCount: result?.allTasks[0]?.count || 0,
		totalCompletedTasksCount: result?.completedTasks[0]?.count || 0
	};

	if (!skipTodayStats) {
		stats.todayCompletedTasksCount = result?.todayCompletedTasks[0]?.count || 0;
	}

	return stats;
}

/**
 * Get focus record statistics using $facet to run today & all-time stats in parallel
 */
async function getFocusStats(userId: Types.ObjectId, params: OverviewStatsQueryParams, todayDateString: string, skipTodayStats: boolean, tz: string) {
	// Build search filter
	const searchFilter = buildFocusSearchFilter(params.searchQuery);

	// Build today's focus record filter
	const { focusRecordMatchConditions: todayFocusMatch } = buildFocusMatchAndFilterConditions(
		userId,
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
		params.timezone,
		params.general,
		false
	);

	// Calculate date boundaries for today's stats (for midnight crossing adjustment)
	const todayStartBoundary = parseDateInTimezone(todayDateString, tz);
	const todayEndBoundary = new Date(todayStartBoundary);
	todayEndBoundary.setUTCDate(todayEndBoundary.getUTCDate() + 1);

	// Build all-time focus record filter
	const { focusRecordMatchConditions: totalFocusMatch } = buildFocusMatchAndFilterConditions(
		userId,
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
		params.timezone,
		params.general,
		params.yearAgnostic
	);

	// Calculate date boundaries for total stats (for midnight crossing adjustment)
	const { startDateBoundary: totalStartBoundary, endDateBoundary: totalEndBoundary } =
		calculateEffectiveDateBoundaries(params);

	// Apply search filters
	const todayFocusQuery = searchFilter ? { $and: [searchFilter, todayFocusMatch] } : todayFocusMatch;
	const totalFocusQuery = searchFilter ? { $and: [searchFilter, totalFocusMatch] } : totalFocusMatch;

	// Build pipeline for total stats with midnight crossing adjustment
	const totalStatsPipeline: PipelineStage[] = [
		{ $match: totalFocusQuery }
	];

	// Add midnight crossing duration adjustment if date boundaries exist
	if (params.yearAgnostic && params.startDate && params.endDate) {
		// Year-agnostic clipping: use month/day from sidebar dates, apply to each record's own year
		addYearAgnosticMidnightAdjustment(totalStatsPipeline, params.startDate, params.endDate, tz);
	} else if (!params.yearAgnostic && (totalStartBoundary || totalEndBoundary)) {
		// Regular clipping: use specific date boundaries
		addMidnightRecordDurationAdjustment(totalStatsPipeline, totalStartBoundary, totalEndBoundary);
	}

	// Add group stage to calculate count and duration
	totalStatsPipeline.push({
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
	});

	// Build facet stages based on skipTodayStats
	const facetStages: Record<string, PipelineStage[]> = {
		totalStats: totalStatsPipeline
	};

	if (!skipTodayStats) {
		// Build pipeline for today's stats with midnight crossing adjustment
		const todayStatsPipeline: PipelineStage[] = [
			{ $match: todayFocusQuery }
		];

		// Always add midnight crossing adjustment for today
		addMidnightRecordDurationAdjustment(todayStatsPipeline, todayStartBoundary, todayEndBoundary);

		// Add group stage to calculate count and duration
		todayStatsPipeline.push({
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
		});

		facetStages.todayStats = todayStatsPipeline;
	}

	// Run focus queries in parallel using $facet
	// TypeScript expects FacetPipelineStage[] but mongoose doesn't export this type.
	// Our stages are valid for $facet, so we cast to any to bypass the type check.
	const [result] = await FocusRecordTickTick.aggregate([
		{
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			$facet: facetStages as any
		}
	]);

	const stats: Record<string, number> = {
		totalFocusRecordCount: result?.totalStats[0]?.count || 0,
		totalFocusDuration: result?.totalStats[0]?.duration || 0
	};

	if (!skipTodayStats) {
		stats.todayFocusRecordCount = result?.todayStats[0]?.count || 0;
		stats.todayFocusDuration = result?.todayStats[0]?.duration || 0;
	}

	return stats;
}

/**
 * Get project count
 */
async function getProjectStats(userId: Types.ObjectId, params: OverviewStatsQueryParams) {
	const projectFilter: MongooseFilter = { userId };

	if (params.projectIds.length > 0) {
		projectFilter.id = { $in: params.projectIds };
	}

	const totalProjectsCount = await Project.countDocuments(projectFilter);
	return { totalProjectsCount };
}

/**
 * Get first task completion date and first focus record date
 */
async function getFirstData(userId: Types.ObjectId) {
	// Get first completed task (find tasks with non-null completedTime)
	const firstCompletedTask = await Task.findOne({ userId, completedTime: { $ne: null } })
		.sort({ completedTime: 1 })
		.select('completedTime')
		.lean();

	// Get first focus record
	const firstFocusRecord = await FocusRecordTickTick.findOne({ userId })
		.sort({ startTime: 1 })
		.select('startTime')
		.lean();

	return {
		firstCompletedTaskDate: firstCompletedTask?.completedTime || null,
		firstFocusRecordDate: firstFocusRecord?.startTime || null
	};
}

/**
 * Calculate the number of active days (days where user either completed a task or added a focus record)
 */
async function getActiveDays(userId: Types.ObjectId, timezone: string = 'UTC') {
	// Get all unique dates where tasks were completed
	const completedTaskDates = await Task.aggregate([
		{
			$match: {
				userId,
				completedTime: { $ne: null }
			}
		},
		{
			$project: {
				date: {
					$dateToString: {
						format: '%Y-%m-%d',
						date: '$completedTime',
						timezone
					}
				}
			}
		},
		{
			$group: {
				_id: '$date'
			}
		}
	]);

	// Get all unique dates where focus records were added
	const focusRecordDates = await FocusRecordTickTick.aggregate([
		{
			$match: {
				userId
			}
		},
		{
			$project: {
				date: {
					$dateToString: {
						format: '%Y-%m-%d',
						date: '$startTime',
						timezone
					}
				}
			}
		},
		{
			$group: {
				_id: '$date'
			}
		}
	]);

	// Combine both date sets and count unique dates
	const uniqueDates = new Set([
		...completedTaskDates.map((d) => d._id),
		...focusRecordDates.map((d) => d._id)
	]);

	return uniqueDates.size;
}

/**
 * Get overview statistics including task counts, project counts, and active days
 * Supports filtering by projects, date range, search query, task sources, and specific taskId
 */
export async function getOverviewStats(params: OverviewStatsQueryParams, userId: Types.ObjectId): Promise<OverviewStats> {
	// Calculate today's date in user's timezone
	const tz = params.timezone || 'UTC';
	const now = new Date();
	const todayDateString = now.toLocaleDateString('en-US', {
		timeZone: tz,
		year: 'numeric',
		month: 'long',
		day: 'numeric'
	});

	const skipTodayStats = params.skipTodayStats || false;
	const includeFirstData = params.includeFirstData || false;

	// Build promises array for parallel execution
	const promises: Promise<unknown>[] = [
		getTaskStats(userId, params, todayDateString, skipTodayStats),
		getFocusStats(userId, params, todayDateString, skipTodayStats, tz),
		getProjectStats(userId, params),
		getActiveDays(userId, tz)
	];

	if (includeFirstData) {
		promises.push(getFirstData(userId));
	}

	// Run all stats queries in parallel
	const results = await Promise.all(promises);

	const taskStats = results[0] as Record<string, number>;
	const focusStats = results[1] as Record<string, number>;
	const projectStats = results[2] as { totalProjectsCount: number };
	const activeDays = results[3] as number;
	const firstData = results[4] as { firstCompletedTaskDate: string | null; firstFocusRecordDate: string | null } | undefined;

	const overviewStats = {
		...taskStats,
		...focusStats,
		...projectStats,
		activeDays
	} as OverviewStats;

	if (includeFirstData && firstData) {
		overviewStats.firstCompletedTaskDate = firstData.firstCompletedTaskDate;
		overviewStats.firstFocusRecordDate = firstData.firstFocusRecordDate;
	}

	return overviewStats;
}
