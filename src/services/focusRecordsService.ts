import FocusRecordTickTick from '../models/FocusRecord';
import Project from '../models/projectModel';
import { addAncestorAndCompletedTasks, addMidnightRecordDurationAdjustment } from '../utils/focus.utils';
import {
	buildFocusSearchFilter,
	buildFocusMatchAndFilterConditions,
	buildFocusBasePipeline,
	buildFocusTotalsCalculationPipeline,
	extractFocusTotalsFromResult,
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
	endDateBoundary: Date | null = null
) {
	const hasTaskOrProjectFilters = taskFilterConditions.length > 0;

	// Build main query pipeline
	const queryPipeline = buildFocusBasePipeline(searchFilter, focusRecordMatchConditions);

	// Add stage to adjust durations for records that cross midnight beyond date boundaries
	if (startDateBoundary || endDateBoundary) {
		addMidnightRecordDurationAdjustment(queryPipeline, startDateBoundary, endDateBoundary);
	}

	// Add task filtering and duration recalculation (preserves original duration)
	addTaskFilteringAndDurationRecalculation(queryPipeline, taskFilterConditions, true);

	queryPipeline.push({ $sort: sortCriteria });
	queryPipeline.push({ $skip: skip });
	queryPipeline.push({ $limit: limit });

	const focusRecords = await FocusRecordTickTick.aggregate(queryPipeline);

	// Build count and duration pipeline (using extracted function)
	const basePipelineForTotals = buildFocusBasePipeline(searchFilter, focusRecordMatchConditions);

	// Add the same duration adjustment logic for the count/duration pipeline
	if (startDateBoundary || endDateBoundary) {
		addMidnightRecordDurationAdjustment(basePipelineForTotals, startDateBoundary, endDateBoundary);
	}

	// Use extracted function to build totals calculation pipeline
	const countAndDurationPipeline = buildFocusTotalsCalculationPipeline(basePipelineForTotals, taskFilterConditions);
	const countAndDurationResult = await FocusRecordTickTick.aggregate(countAndDurationPipeline);

	// Use extracted function to parse the result
	const { total, totalDuration, onlyTasksTotalDuration } = extractFocusTotalsFromResult(
		countAndDurationResult,
		hasTaskOrProjectFilters
	);

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
	startDate?: string; // Filter Sidebar dates (first tier filter)
	endDate?: string; // Filter Sidebar dates (first tier filter)
	intervalStartDate?: string; // Interval Dropdown dates (second tier filter)
	intervalEndDate?: string; // Interval Dropdown dates (second tier filter)
	sortBy: string;
	taskIdIncludeFocusRecordsFromSubtasks: boolean;
	searchQuery?: string;
	focusAppSources: string[]; // Mapped focus app sources
	crossesMidnight?: boolean;
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
		params.focusAppSources,
		params.crossesMidnight,
		params.intervalStartDate,
		params.intervalEndDate
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

	// Execute unified query (conditionally adds stages based on filters)
	const { focusRecords, total, totalDuration, onlyTasksTotalDuration } = await executeQuery(
		searchFilter,
		focusRecordMatchConditions,
		taskFilterConditions,
		sortCriteria,
		skip,
		params.limit,
		startDateBoundary,
		endDateBoundary
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
	crossesMidnight?: boolean;
	groupBy: 'none' | 'project' | 'task';
	onlyExportTasksWithNoParent: boolean;
}

export async function exportFocusRecords(params: ExportFocusRecordsQueryParams) {
	// Map special focus app source IDs to friendly names
	const sourceToAppName: Record<string, string> = {
		'FocusRecordSession': 'Session',
		'FocusRecordBeFocused': 'Be Focused',
		'FocusRecordForest': 'Forest',
		'FocusRecordTide': 'Tide'
	};

	// Fetch all projects and create lookup by ID for current project names
	const projects = await Project.find({}).lean();
	const projectsById: Record<string, any> = {};
	projects.forEach((project: any) => {
		projectsById[project.id] = project;
	});

	// Build filters (reuse existing logic from getFocusRecords)
	const searchFilter = buildFocusSearchFilter(params.searchQuery);
	const sortCriteria = buildSortCriteria(params.sortBy);
	const { focusRecordMatchConditions, taskFilterConditions } = buildFocusMatchAndFilterConditions(
		params.taskId,
		params.projectIds,
		params.startDate,
		params.endDate,
		params.taskIdIncludeFocusRecordsFromSubtasks,
		params.focusAppSources,
		params.crossesMidnight,
		params.intervalStartDate,
		params.intervalEndDate
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
	const { focusRecords, total, totalDuration, onlyTasksTotalDuration } = await executeQuery(
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
	const { focusRecordsWithCompletedTasks, ancestorTasksById } = await addAncestorAndCompletedTasks(focusRecords);

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
		};
	}

	// Group records by project or task
	const grouped: { [key: string]: { records: any[], totalDuration: number, groupName: string } } = {};

	for (const focusRecord of focusRecordsWithCompletedTasks) {
		const uniqueIds = new Set<string>();

		// Collect unique project or task IDs
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
				};
			}

			// Filter tasks that belong to this group
			let filteredTasks = [];
			if (params.groupBy === 'project') {
				// For project grouping, only include tasks in this project
				filteredTasks = focusRecord.tasks?.filter((task: any) => (task.projectId || 'no-project-id') === id) || [];
			} else {
				// For task grouping, only include tasks matching this task ID
				filteredTasks = focusRecord.tasks?.filter((task: any) => {
					if (task.taskId === id) return true;
					if (params.taskIdIncludeFocusRecordsFromSubtasks && task.ancestorIds?.includes(id)) {
						return true;
					}
					return false;
				}) || [];
			}

			// Skip this focus record if no tasks match after filtering
			if (filteredTasks.length === 0) {
				continue;
			}

			// Calculate duration for this specific group
			const duration = filteredTasks.reduce((sum: number, task: any) => sum + task.duration, 0);

			// Create a filtered copy of the focus record with only matching tasks
			const filteredFocusRecord = {
				...focusRecord,
				tasks: filteredTasks
			};

			grouped[id].records.push(filteredFocusRecord);
			grouped[id].totalDuration += duration;
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
	};
}
