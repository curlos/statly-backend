import { Task } from '../models/TaskModel';
import { buildTaskSearchFilter, buildTaskMatchConditions } from '../utils/taskFilterBuilders.utils';
import { buildAncestorData } from '../utils/task.utils';
import { DaysWithCompletedTasksQueryParams, ExportDaysWithCompletedTasksQueryParams } from '../utils/queryParams.utils';
import Project from '../models/projectModel';

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
		params.toDoListAppSources,
		'completedTime',
		params.intervalStartDate,
		params.intervalEndDate
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

// ============================================================================
// Export Service Method
// ============================================================================

export async function exportDaysWithCompletedTasks(params: ExportDaysWithCompletedTasksQueryParams) {
	// Fetch all projects and create lookup by ID for current project names
	const projects = await Project.find({}).lean();
	const projectsById: Record<string, any> = {};
	projects.forEach((project: any) => {
		projectsById[project.id] = project;
	});

	// Build filters using shared builder
	const searchFilter = buildTaskSearchFilter(params.searchQuery);
	const matchFilter = buildTaskMatchConditions(
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

	// Step 6: Format output
	aggregationPipeline.push({
		$project: {
			dateStr: "$_id",
			completedTasksForDay: 1,
			_id: 0
		}
	});

	const result = await Task.aggregate(aggregationPipeline);

	// Extract all tasks from all days
	const allTasks: any[] = [];
	result.forEach(day => {
		allTasks.push(...day.completedTasksForDay);
	});

	// Build ancestor data for all tasks
	const { ancestorTasksById } = await buildAncestorData(allTasks);

	// Group tasks by parent/child relationship for each day
	const daysWithGroupedTasks: any[] = [];

	for (const day of result) {
		const { dateStr, completedTasksForDay } = day;

		// Group subtasks by parent task
		const groupedSubtasksByParentTask: Record<string, any[]> = {};

		for (const task of completedTasksForDay) {
			// Use parentId if it exists, otherwise treat task as its own parent
			const parentId = task.parentId || task.id;

			if (!groupedSubtasksByParentTask[parentId]) {
				groupedSubtasksByParentTask[parentId] = [];
			}

			groupedSubtasksByParentTask[parentId].push(task);
		}

		// Build parent task data with enriched titles
		const parentTasks: any[] = [];

		for (const parentTaskId of Object.keys(groupedSubtasksByParentTask)) {
			const completedSubtasks = groupedSubtasksByParentTask[parentTaskId];
			const parentTask = ancestorTasksById[parentTaskId];

			// Skip if parent task not found (shouldn't happen but defensive check)
			if (!parentTask) {
				continue;
			}

			// Build breadcrumb path: "Child - Parent - Grandparent"
			const taskNamesPath = [parentTask.title];

			if (parentTask.ancestorIds && parentTask.ancestorIds.length > 1) {
				// Skip the first ancestorId since it's the task itself
				parentTask.ancestorIds.slice(1).forEach((ancestorId: string) => {
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
			const projectId = parentTask.projectId;
			if (projectId) {
				const currentProject = projectsById[projectId];
				const projectName = currentProject?.name || projectId;
				fullTaskTitle += ` - (${projectName})`;
			}

			// Append subtask count
			fullTaskTitle += ` (${completedSubtasks.length})`;

			parentTasks.push({
				name: fullTaskTitle,
				ancestorIds: parentTask.ancestorIds || [],
				completedSubtasks,
				id: parentTask.id,
				projectId: parentTask.projectId,
			});
		}

		// Calculate total completed tasks for this day
		const taskCount = parentTasks.reduce((sum: number, pt: any) => sum + pt.completedSubtasks.length, 0);

		daysWithGroupedTasks.push({
			dateStr,
			parentTasks,
			taskCount,
		});
	}

	// If no grouping, return days directly
	if (params.groupBy === 'none') {
		return {
			days: daysWithGroupedTasks,
			totalTasks: allTasks.length,
		};
	}

	// ============================================================================
	// Group Standalone Daily Habit Tasks (for groupBy='task' only)
	// ============================================================================
	// Identify standalone tasks that appear multiple times across days with the same name
	// and create grouped task IDs like "grouped-Check Streaks"
	const groupedTasksInfo: Record<string, any> = {};
	const taskIdToGroupedId: Record<string, string> = {}; // Maps original task ID to grouped ID

	if (params.groupBy === 'task') {
		// Collect all parent tasks across all days
		const allParentTasks: any[] = [];
		for (const day of daysWithGroupedTasks) {
			allParentTasks.push(...day.parentTasks);
		}

		// Separate standalone tasks from those with children
		const standaloneTasksByName: Record<string, any[]> = {};

		for (const parentTaskData of allParentTasks) {
			const { completedSubtasks, id: taskId } = parentTaskData;

			// Check if this is a standalone task (only 1 completed subtask)
			if (completedSubtasks.length === 1) {
				const taskInfo = ancestorTasksById[taskId];
				const taskName = taskInfo?.title || taskId;

				if (!standaloneTasksByName[taskName]) {
					standaloneTasksByName[taskName] = [];
				}
				standaloneTasksByName[taskName].push(parentTaskData);
			}
		}

		// Group standalone tasks that share the same name
		for (const [taskName, tasks] of Object.entries(standaloneTasksByName)) {
			// Only group if there are multiple instances with the same name
			if (tasks.length > 1) {
				const groupedId = `grouped-${taskName}`;

				// Track which task IDs should use this grouped ID
				tasks.forEach(task => {
					taskIdToGroupedId[task.id] = groupedId;
				});

				// Store grouped task info
				const totalCompletedTasks = tasks.reduce((sum, t) => sum + t.completedSubtasks.length, 0);
				groupedTasksInfo[groupedId] = {
					id: groupedId,
					name: taskName,
					projectId: tasks[0].projectId,
					isGrouped: true,
					instanceCount: tasks.length,
					totalCompletedTasks,
				};
			}
		}
	}

	// Group by project or task
	const grouped: { [key: string]: { days: any[], totalCompletedTasks: number, groupName: string } } = {};

	for (const day of daysWithGroupedTasks) {
		const { dateStr, parentTasks } = day;

		for (const parentTaskData of parentTasks) {
			const { completedSubtasks, ancestorIds, projectId, id: taskId } = parentTaskData;

			// Collect unique IDs to group by
			const uniqueIds = new Set<string>();

			if (params.groupBy === 'project') {
				// Group by project
				uniqueIds.add(projectId || 'no-project-id');
			} else {
				// Group by task
				// Check if this task should use a grouped ID (for standalone daily habits)
				const effectiveTaskId = taskIdToGroupedId[taskId] || taskId;
				uniqueIds.add(effectiveTaskId);

				// Include ancestor task IDs if setting enabled (BUG FIX #1)
				if (params.taskIdIncludeSubtasks && ancestorIds && ancestorIds.length > 1) {
					// Skip first element (task itself) and add all ancestors
					ancestorIds.slice(1).forEach((ancestorId: string) => {
						uniqueIds.add(ancestorId);
					});
				}
			}

			// Add to each group
			for (const groupId of uniqueIds) {
				// Initialize group if needed
				if (!grouped[groupId]) {
					let groupName = groupId;

					if (params.groupBy === 'project') {
						if (groupId === 'no-project-id') {
							groupName = 'No Project ID';
						} else {
							const project = projectsById[groupId];
							groupName = project?.name || groupId;
						}
					} else {
						// Check if this is a grouped task ID
						if (groupedTasksInfo[groupId]) {
							groupName = groupedTasksInfo[groupId].name;
						} else {
							const taskInfo = ancestorTasksById[groupId];
							groupName = taskInfo?.title || (groupId === 'no-task-id' ? 'No Task Id' : groupId);
						}
					}

					grouped[groupId] = {
						days: [],
						totalCompletedTasks: 0,
						groupName,
					};
				}

				// Find or create day within this group
				let groupDay = grouped[groupId].days.find((d: any) => d.dateStr === dateStr);
				if (!groupDay) {
					groupDay = { dateStr, parentTasks: [], taskCount: 0 };
					grouped[groupId].days.push(groupDay);
				}

				// Add parent task to this group's day
				groupDay.parentTasks.push(parentTaskData);
				groupDay.taskCount += completedSubtasks.length;
				grouped[groupId].totalCompletedTasks += completedSubtasks.length;
			}
		}
	}

	// BUG FIX #2: Filter out tasks with parents when onlyExportTasksWithNoParent is enabled
	if (params.groupBy === 'task' && params.onlyExportTasksWithNoParent) {
		Object.keys(grouped).forEach((taskId) => {
			// Skip grouped tasks (they don't have entries in ancestorTasksById)
			if (groupedTasksInfo[taskId]) {
				return;
			}

			const taskInfo = ancestorTasksById[taskId];
			if (taskInfo && taskInfo.parentId) {
				delete grouped[taskId];
			}
		});
	}

	// Sort days within each group by sortBy parameter
	for (const groupId of Object.keys(grouped)) {
		grouped[groupId].days.sort((a: any, b: any) => {
			const dateA = new Date(a.dateStr);
			const dateB = new Date(b.dateStr);

			switch (params.sortBy) {
				case 'Oldest':
					return dateA.getTime() - dateB.getTime();
				case 'Completed Tasks: Most-Least':
					// Primary sort by task count (descending), secondary sort by date (ascending)
					if (b.taskCount !== a.taskCount) {
						return b.taskCount - a.taskCount;
					}
					return dateA.getTime() - dateB.getTime();
				case 'Completed Tasks: Least-Most':
					// Primary sort by task count (ascending), secondary sort by date (ascending)
					if (a.taskCount !== b.taskCount) {
						return a.taskCount - b.taskCount;
					}
					return dateA.getTime() - dateB.getTime();
				case 'Newest':
				default:
					return dateB.getTime() - dateA.getTime();
			}
		});
	}

	return {
		grouped,
		totalTasks: allTasks.length,
	};
}
