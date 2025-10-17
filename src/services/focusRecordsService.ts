import FocusRecordTickTick from '../models/FocusRecord';
import { addAncestorAndCompletedTasks } from '../utils/focus.utils';
import {
	buildFocusSearchFilter,
	buildFocusMatchAndFilterConditions,
	buildFocusBasePipeline,
} from '../utils/focusFilterBuilders.utils';

// ============================================================================
// Sort Criteria Builder
// ============================================================================

function buildSortCriteria(sortBy: string): { [key: string]: 1 | -1 } {
	switch (sortBy) {
		case 'Oldest':
			return { startTime: 1 };
		case 'Focus Hours: Most-Least':
			return { duration: -1 };
		case 'Focus Hours: Least-Most':
			return { duration: 1 };
		case 'Newest':
		default:
			return { startTime: -1 };
	}
}

// ============================================================================
// Unified Query Executor
// ============================================================================

async function executeQuery(
	searchFilter: any,
	focusRecordMatchConditions: any,
	taskFilterConditions: any[],
	sortCriteria: { [key: string]: 1 | -1 },
	skip: number,
	limit: number
) {
	const hasTaskOrProjectFilters = taskFilterConditions.length > 0;

	// Build main query pipeline
	const queryPipeline = buildFocusBasePipeline(searchFilter, focusRecordMatchConditions);

	// Conditionally add task filtering stages (only when filtering tasks array)
	if (hasTaskOrProjectFilters) {
		// Store the original duration before we filter tasks
		queryPipeline.push({
			$addFields: {
				originalDuration: "$duration"
			}
		});

		// Filter the tasks array to only include tasks that match our conditions
		// Example: if filtering by projectId 'abc', only keep tasks with projectId 'abc'
		queryPipeline.push({
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
		queryPipeline.push({
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

	queryPipeline.push({ $sort: sortCriteria });
	queryPipeline.push({ $skip: skip });
	queryPipeline.push({ $limit: limit });

	const focusRecords = await FocusRecordTickTick.aggregate(queryPipeline);

	// Build count and duration pipeline
	const countAndDurationPipeline = buildFocusBasePipeline(searchFilter, focusRecordMatchConditions);

	// Conditionally add task filtering for complex queries
	if (hasTaskOrProjectFilters) {
		// Step 1: Store original duration and create a filtered tasks array
		// We need both to calculate totals later
		countAndDurationPipeline.push({
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
		// This sums up the duration of each task that matched our filters
		countAndDurationPipeline.push({
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
		// - total: count of focus records
		// - totalDuration: sum of all original durations (before filtering)
		// - onlyTasksTotalDuration: sum of filtered tasks durations only
		countAndDurationPipeline.push({
			$group: {
				_id: null,
				total: { $sum: 1 },
				totalDuration: { $sum: "$originalDuration" },
				onlyTasksTotalDuration: { $sum: "$filteredTasksDuration" }
			}
		});
	} else {
		// Simple case (no task/project filters): use $facet to calculate 3 things in parallel
		// $facet runs multiple pipelines in parallel on the same input documents
		countAndDurationPipeline.push({
			$facet: {
				// Pipeline 1: Count total number of focus records
				count: [{ $count: "total" }],

				// Pipeline 2: Sum up all focus record durations
				// This gives the total time across all focus records
				baseDuration: [
					{
						$group: {
							_id: null,
							total: { $sum: "$duration" }
						}
					}
				],

				// Pipeline 3: Sum up individual task durations
				// Unwind flattens the tasks array so we can sum each task's duration
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

	const countAndDurationResult = await FocusRecordTickTick.aggregate(countAndDurationPipeline);

	let total: number;
	let totalDuration: number;
	let onlyTasksTotalDuration: number;

	if (hasTaskOrProjectFilters) {
		total = countAndDurationResult[0]?.total || 0;
		totalDuration = countAndDurationResult[0]?.totalDuration || 0;
		onlyTasksTotalDuration = countAndDurationResult[0]?.onlyTasksTotalDuration || 0;
	} else {
		total = countAndDurationResult[0]?.count[0]?.total || 0;
		totalDuration = countAndDurationResult[0]?.baseDuration[0]?.total || 0;
		onlyTasksTotalDuration = countAndDurationResult[0]?.tasksDuration[0]?.total || 0;
	}

	return {
		focusRecords,
		total,
		totalDuration,
		onlyTasksTotalDuration
	};
}

// ============================================================================
// Main Service Method
// ============================================================================

export interface FocusRecordsQueryParams {
	page: number;
	limit: number;
	projectIds: string[]; // Combined projects and categories, already split
	taskId?: string;
	startDate?: string;
	endDate?: string;
	sortBy: string;
	taskIdIncludeFocusRecordsFromSubtasks: boolean;
	searchQuery?: string;
	focusAppSources: string[]; // Mapped focus app sources
}

export async function getFocusRecords(params: FocusRecordsQueryParams) {
	const skip = params.page * params.limit;

	// Build filters
	const searchFilter = buildFocusSearchFilter(params.searchQuery);
	const sortCriteria = buildSortCriteria(params.sortBy);
	const { focusRecordMatchConditions, taskFilterConditions } = buildFocusMatchAndFilterConditions(
		params.taskId,
		params.projectIds,
		params.startDate,
		params.endDate,
		params.taskIdIncludeFocusRecordsFromSubtasks,
		params.focusAppSources
	);

	// Execute unified query (conditionally adds stages based on filters)
	const { focusRecords, total, totalDuration, onlyTasksTotalDuration } = await executeQuery(
		searchFilter,
		focusRecordMatchConditions,
		taskFilterConditions,
		sortCriteria,
		skip,
		params.limit
	);

	// Add ancestor tasks and completed tasks
	const { focusRecordsWithCompletedTasks, ancestorTasksById } = await addAncestorAndCompletedTasks(focusRecords);

	// Calculate pagination metadata
	const totalPages = Math.ceil(total / params.limit);
	const hasMore = skip + focusRecords.length < total;

	return {
		data: focusRecordsWithCompletedTasks,
		ancestorTasksById,
		total,
		totalPages,
		page: params.page,
		limit: params.limit,
		hasMore,
		totalDuration,
		onlyTasksTotalDuration,
	};
}
