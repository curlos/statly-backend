import { Types } from 'mongoose';
import FocusRecord from '../models/FocusRecord';
import Project from '../models/projectModel';
import { addAncestorAndCompletedTasks, addMidnightRecordDurationAdjustment } from '../utils/focus.utils';
import {
	buildFocusSearchFilter,
	buildFocusMatchAndFilterConditions,
	buildFocusBasePipeline,
	addTaskFilteringAndDurationRecalculation,
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
		case 'Emotional Intensity: High-Low':
			return { firstEmotionScore: -1 };
		case 'Emotional Intensity: Low-High':
			return { firstEmotionScore: 1 };
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
	limit: number,
	startDateBoundary: Date | null = null,
	endDateBoundary: Date | null = null,
	needEmotionCalculations: boolean = true
) {
	const hasTaskOrProjectFilters = taskFilterConditions.length > 0;

	// Build base pipeline with filters and adjustments
	const basePipeline = buildFocusBasePipeline(searchFilter, focusRecordMatchConditions);

	// Add stage to adjust durations for records that cross midnight beyond date boundaries
	if (startDateBoundary || endDateBoundary) {
		addMidnightRecordDurationAdjustment(basePipeline, startDateBoundary, endDateBoundary);
	}

	// Add task filtering and duration recalculation (preserves original duration)
	addTaskFilteringAndDurationRecalculation(basePipeline, taskFilterConditions, true);

	// Build the totals pipeline based on whether we have task/project filters
	let totalsPipeline: any[];
	if (hasTaskOrProjectFilters) {
		// Filtered case: use originalDuration and recalculated duration
		totalsPipeline = [
			{
				$group: {
					_id: null,
					total: { $sum: 1 },
					totalDuration: { $sum: "$originalDuration" },
					onlyTasksTotalDuration: { $sum: "$duration" }
				}
			}
		];
	} else {
		// No filters: need to calculate base duration AND tasks duration
		// Add a field to store the sum of all task durations
		totalsPipeline = [
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
					totalDuration: { $sum: "$duration" },
					onlyTasksTotalDuration: { $sum: "$tasksDurationSum" }
				}
			}
		];
	}

	// Build paginated records pipeline
	const paginatedRecordsPipeline: any[] = [];

	// Only add firstEmotionScore field if sorting by emotional intensity
	const isSortingByEmotions = sortCriteria.firstEmotionScore !== undefined;
	if (isSortingByEmotions) {
		paginatedRecordsPipeline.push({
			$addFields: {
				firstEmotionScore: {
					$ifNull: [
						{ $arrayElemAt: ["$emotions.score", 0] },
						0
					]
				}
			}
		});
	}

	paginatedRecordsPipeline.push(
		{ $sort: sortCriteria },
		{ $skip: skip },
		{ $limit: limit },
		// Only select fields that are used by the frontend
		{
			$project: {
				id: 1,
				startTime: 1,
				endTime: 1,
				duration: 1,
				note: 1,
				crossesMidnight: 1,
				completedTasks: 1,
				emotions: 1,
				tasks: 1,
				pauseDuration: 1,
				source: 1
			}
		}
	);

	// Build $facet stages object conditionally
	const facetStages: any = {
		// Get paginated focus records
		paginatedFocusRecords: paginatedRecordsPipeline,

		// Calculate totals (count and durations)
		totals: totalsPipeline,
	};

	// Only add emotion calculations if needed
	if (needEmotionCalculations) {
		facetStages.emotionCounts = [
			{ $unwind: { path: '$emotions', preserveNullAndEmptyArrays: false } },
			{
				$group: {
					_id: '$emotions.emotion',
					count: { $sum: 1 }
				}
			},
			{
				$project: {
					_id: 0,
					emotion: '$_id',
					count: 1
				}
			}
		];

		facetStages.noEmotionCount = [
			{
				$match: {
					$or: [
						{ emotions: [] },
						{ emotions: null },
						{ emotions: { $exists: false } }
					]
				}
			},
			{ $count: 'count' }
		];
	}

	// Use $facet to run all aggregations in parallel within a single query
	basePipeline.push({
		$facet: facetStages
	});

	// Execute the combined query (1 database call instead of 4)
	const result = await FocusRecord.aggregate(basePipeline);

	// Extract results from facet
	const facetResult = result[0];
	const focusRecords = facetResult.paginatedFocusRecords || [];

	// Extract totals (same structure for both filtered and non-filtered cases now)
	const totalsResult = facetResult.totals || [];
	const total = totalsResult[0]?.total || 0;
	const totalDuration = totalsResult[0]?.totalDuration || 0;
	const onlyTasksTotalDuration = totalsResult[0]?.onlyTasksTotalDuration || 0;

	// Extract emotion counts (only if they were calculated)
	let emotionCounts: Record<string, number> = {};
	if (needEmotionCalculations) {
		const emotionCountResult = facetResult.emotionCounts || [];
		emotionCounts = emotionCountResult.reduce((acc: Record<string, number>, item: any) => {
			acc[item.emotion] = item.count;
			return acc;
		}, {} as Record<string, number>);

		// Add no emotion count if exists
		const noEmotionCountResult = facetResult.noEmotionCount || [];
		if (noEmotionCountResult.length > 0 && noEmotionCountResult[0].count > 0) {
			emotionCounts['none'] = noEmotionCountResult[0].count;
		}
	}

	return {
		focusRecords,
		total,
		totalDuration,
		onlyTasksTotalDuration,
		emotionCounts
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
	startDate?: string; // Filter Sidebar dates (first tier filter)
	endDate?: string; // Filter Sidebar dates (first tier filter)
	intervalStartDate?: string; // Interval Dropdown dates (second tier filter)
	intervalEndDate?: string; // Interval Dropdown dates (second tier filter)
	sortBy: string;
	taskIdIncludeFocusRecordsFromSubtasks: boolean;
	searchQuery?: string;
	focusAppSources: string[]; // Mapped focus app sources
	emotions: string[]; // Emotions filter
	crossesMidnight?: boolean;
	timezone?: string;
	showEmotionCount?: boolean; // User setting to show emotion counts
}

export async function getFocusRecords(params: FocusRecordsQueryParams, userId: Types.ObjectId) {
	const skip = params.page * params.limit;

	// Build filters
	const searchFilter = buildFocusSearchFilter(params.searchQuery);
	const sortCriteria = buildSortCriteria(params.sortBy);
	const { focusRecordMatchConditions, taskFilterConditions } = buildFocusMatchAndFilterConditions(
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
		params.timezone
	);

	// Calculate the date boundaries for duration adjustment
	// Use interval dates if provided (second tier), otherwise use filter sidebar dates (first tier)
	const effectiveStartDate = params.intervalStartDate || params.startDate;
	const effectiveEndDate = params.intervalEndDate || params.endDate;

	const startDateBoundary = effectiveStartDate ? new Date(effectiveStartDate) : null;
	let endDateBoundary: Date | null = null;
	if (effectiveEndDate) {
		endDateBoundary = new Date(effectiveEndDate);
		endDateBoundary.setDate(endDateBoundary.getDate() + 1);
	}

	// Determine if we need emotion calculations based on user settings
	const needEmotionCalculations = params.showEmotionCount === true;

	// Execute unified query (conditionally adds stages based on filters)
	const { focusRecords, total, totalDuration, onlyTasksTotalDuration, emotionCounts } = await executeQuery(
		searchFilter,
		focusRecordMatchConditions,
		taskFilterConditions,
		sortCriteria,
		skip,
		params.limit,
		startDateBoundary,
		endDateBoundary,
		needEmotionCalculations
	);

	// Add ancestor tasks and completed tasks
	const { focusRecordsWithCompletedTasks, ancestorTasksById } = await addAncestorAndCompletedTasks(focusRecords, userId);

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
		emotionCounts,
	};
}

// ============================================================================
// Export Service Method
// ============================================================================

export interface ExportFocusRecordsQueryParams {
	projectIds: string[];
	taskId?: string;
	startDate?: string;
	endDate?: string;
	intervalStartDate?: string;
	intervalEndDate?: string;
	sortBy: string;
	taskIdIncludeFocusRecordsFromSubtasks: boolean;
	searchQuery?: string;
	focusAppSources: string[];
	emotions: string[];
	crossesMidnight?: boolean;
	groupBy: 'none' | 'project' | 'task' | 'emotion';
	onlyExportTasksWithNoParent: boolean;
	timezone?: string;
}

export async function exportFocusRecords(params: ExportFocusRecordsQueryParams, userId: Types.ObjectId) {
	// Map special focus app source IDs to friendly names
	const sourceToAppName: Record<string, string> = {
		'FocusRecordSession': 'Session',
		'FocusRecordBeFocused': 'Be Focused',
		'FocusRecordForest': 'Forest',
		'FocusRecordTide': 'Tide'
	};

	// Fetch all projects and create lookup by ID for current project names
	const projects = await Project.find({ userId }).lean();
	const projectsById: Record<string, any> = {};
	projects.forEach((project: any) => {
		projectsById[project.id] = project;
	});

	// Build filters (reuse existing logic from getFocusRecords)
	const searchFilter = buildFocusSearchFilter(params.searchQuery);
	const sortCriteria = buildSortCriteria(params.sortBy);
	const { focusRecordMatchConditions, taskFilterConditions } = buildFocusMatchAndFilterConditions(
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
		params.timezone
	);

	// Calculate date boundaries for duration adjustment
	const effectiveStartDate = params.intervalStartDate || params.startDate;
	const effectiveEndDate = params.intervalEndDate || params.endDate;

	const startDateBoundary = effectiveStartDate ? new Date(effectiveStartDate) : null;
	let endDateBoundary: Date | null = null;
	if (effectiveEndDate) {
		endDateBoundary = new Date(effectiveEndDate);
		endDateBoundary.setDate(endDateBoundary.getDate() + 1);
	}

	// Execute query without pagination (get all records)
	const { focusRecords, total, totalDuration, onlyTasksTotalDuration, emotionCounts } = await executeQuery(
		searchFilter,
		focusRecordMatchConditions,
		taskFilterConditions,
		sortCriteria,
		0, // skip
		Number.MAX_SAFE_INTEGER, // Get all records
		startDateBoundary,
		endDateBoundary
	);

	// Add ancestor tasks and completed tasks
	const { focusRecordsWithCompletedTasks, ancestorTasksById } = await addAncestorAndCompletedTasks(focusRecords, userId);

	// Build a lookup for tasks not in ancestorTasksById (deleted tasks)
	// Store the last occurrence of each task from focus records
	const focusRecordTasksById: Record<string, any> = {};

	// Enrich task titles with breadcrumbs (ancestor path) and update with current task data
	focusRecordsWithCompletedTasks.forEach((focusRecord: any) => {
		if (focusRecord.tasks && focusRecord.tasks.length > 0) {
			focusRecord.tasks.forEach((task: any) => {
				// Get current task data from database (ancestorTasksById has fresh data)
				const currentTask = ancestorTasksById[task.taskId];

				// If task not in ancestorTasksById (deleted), store focus record data for later use
				if (!currentTask && task.taskId) {
					focusRecordTasksById[task.taskId] = {
						title: task.title,
						projectId: task.projectId,
						projectName: task.projectName,
					};
				}

				// Use current task data if available, otherwise fall back to focus record data
				const taskTitle = currentTask?.title || task.title || 'No Name';
				const taskProjectId = currentTask?.projectId || task.projectId;
				const taskAncestorIds = currentTask?.ancestorIds || task.ancestorIds;

				// Build breadcrumb path: "Child - Parent - Grandparent"
				const taskNamesPath = [taskTitle];

				if (taskAncestorIds && taskAncestorIds.length > 0) {
					// Skip the first ancestorId since it's the task itself (would be a duplicate)
					taskAncestorIds.slice(1).forEach((ancestorId: string) => {
						const ancestorTask = ancestorTasksById[ancestorId];
						if (ancestorTask && ancestorTask.title) {
							taskNamesPath.push(ancestorTask.title);
						}
					});
				}

				// Wrap the actual task name (first element) with ** for markdown bold
				if (taskNamesPath.length > 0) {
					taskNamesPath[0] = `**${taskNamesPath[0]}**`;
				}

				// Join breadcrumbs with > for hierarchy
				let fullTaskTitle = taskNamesPath.join(' > ');

				// Append project name with - separator
				if (taskProjectId) {
					// Get current project name from lookup
					const currentProject = projectsById[taskProjectId];
					const currentProjectName = currentProject?.name;

					// Map special source IDs to friendly app names, or use current project name, or fall back to old project name
					const displayName = sourceToAppName[taskProjectId] || currentProjectName || task.projectName || taskProjectId;
					fullTaskTitle += ` - (${displayName})`;
				}

				// Update the task with current data
				task.title = fullTaskTitle;
				task.projectId = taskProjectId; // Update to current projectId
				task.ancestorIds = taskAncestorIds; // Update to current ancestorIds
			});
		}
	});

	// If no grouping, return records directly
	if (params.groupBy === 'none') {
		return {
			records: focusRecordsWithCompletedTasks,
			totalRecords: total,
			totalDuration: onlyTasksTotalDuration,
			emotionCounts,
		};
	}

	// Group records by project, task, or emotion
	const grouped: { [key: string]: { records: any[], totalDuration: number, groupName: string, emotionCounts: Record<string, number> } } = {};

	for (const focusRecord of focusRecordsWithCompletedTasks) {
		const uniqueIds = new Set<string>();

		// Collect unique project, task, or emotion IDs
		if (params.groupBy === 'project') {
			// Group by project
			if (focusRecord.tasks && focusRecord.tasks.length > 0) {
				focusRecord.tasks.forEach((task: any) => {
					if (task.projectId) {
						uniqueIds.add(task.projectId);
					} else {
						uniqueIds.add('no-project-id');
					}
				});
			}
		} else if (params.groupBy === 'emotion') {
			// Group by emotion - add all emotions this record has
			if (focusRecord.emotions && focusRecord.emotions.length > 0) {
				focusRecord.emotions.forEach((emotionObj: any) => {
					uniqueIds.add(emotionObj.emotion);
				});
			} else {
				uniqueIds.add('none');
			}
		} else {
			// Group by task
			if (focusRecord.tasks && focusRecord.tasks.length > 0) {
				focusRecord.tasks.forEach((task: any) => {
					uniqueIds.add(task.taskId);

					// Include ancestor task IDs if setting enabled
					if (params.taskIdIncludeFocusRecordsFromSubtasks && task.ancestorIds) {
						task.ancestorIds.forEach((ancestorId: string) => {
							uniqueIds.add(ancestorId);
						});
					}
				});
			}
		}

		// Add focus record to each group
		for (const id of uniqueIds) {
			if (!grouped[id]) {
				// Determine group name
				let groupName = id;
				if (params.groupBy === 'project') {
					if (id === 'no-project-id') {
						groupName = 'No Project ID';
					} else {
						// Try source mapping first, then project name from database, then fall back to ID
						const project = projectsById[id];
						groupName = sourceToAppName[id] || project?.name || id;
					}
				} else if (params.groupBy === 'emotion') {
					// For emotions, use uppercase emotion name
					groupName = id.toUpperCase();
				} else {
					// For tasks, use the task name from ancestorTasksById
					const taskInfo = ancestorTasksById[id];
					if (taskInfo && taskInfo.title) {
						groupName = taskInfo.title;
					} else {
						// Fallback to focus record stored data for deleted tasks
						const focusRecordTask = focusRecordTasksById[id];
						groupName = focusRecordTask?.title || (id === 'no-task-id' ? 'No Task Id' : id);
					}
				}

				grouped[id] = {
					records: [],
					totalDuration: 0,
					groupName,
					emotionCounts: {},
				};
			}

			// Filter tasks that belong to this group, or use full record for emotions
			let filteredTasks = [];
			let duration = 0;

			if (params.groupBy === 'emotion') {
				// For emotion grouping, include the entire focus record (no task filtering)
				// Use task-level duration sum to match stats page behavior
				filteredTasks = focusRecord.tasks || [];
				duration = filteredTasks.reduce((sum: number, task: any) => sum + (task.duration || 0), 0);
			} else if (params.groupBy === 'project') {
				// For project grouping, only include tasks in this project
				filteredTasks = focusRecord.tasks?.filter((task: any) => (task.projectId || 'no-project-id') === id) || [];
				// Calculate duration for this specific group
				duration = filteredTasks.reduce((sum: number, task: any) => sum + task.duration, 0);
			} else {
				// For task grouping, only include tasks matching this task ID
				filteredTasks = focusRecord.tasks?.filter((task: any) => {
					if (task.taskId === id) return true;
					if (params.taskIdIncludeFocusRecordsFromSubtasks && task.ancestorIds?.includes(id)) {
						return true;
					}
					return false;
				}) || [];
				// Calculate duration for this specific group
				duration = filteredTasks.reduce((sum: number, task: any) => sum + task.duration, 0);
			}

			// Skip this focus record if no tasks match after filtering (not applicable for emotion grouping)
			if (params.groupBy !== 'emotion' && filteredTasks.length === 0) {
				continue;
			}

			// Create a filtered copy of the focus record with only matching tasks
			const filteredFocusRecord = {
				...focusRecord,
				tasks: filteredTasks
			};

			grouped[id].records.push(filteredFocusRecord);
			grouped[id].totalDuration += duration;

			// Update emotion counts for this group
			if (focusRecord.emotions && focusRecord.emotions.length > 0) {
				focusRecord.emotions.forEach((emotionObj: any) => {
					const emotion = emotionObj.emotion;
					grouped[id].emotionCounts[emotion] = (grouped[id].emotionCounts[emotion] || 0) + 1;
				});
			} else {
				// No emotions - count as 'none'
				grouped[id].emotionCounts['none'] = (grouped[id].emotionCounts['none'] || 0) + 1;
			}
		}
	}

	// Filter out tasks with parents if onlyExportTasksWithNoParent is enabled
	if (params.groupBy === 'task' && params.onlyExportTasksWithNoParent) {
		// Remove groups where the task has a parent
		Object.keys(grouped).forEach((taskId) => {
			const taskInfo = ancestorTasksById[taskId];
			if (taskInfo && taskInfo.parentId) {
				delete grouped[taskId];
			}
		});
	}

	return {
		grouped,
		totalRecords: total,
		totalDuration: onlyTasksTotalDuration,
		emotionCounts,
	};
}
