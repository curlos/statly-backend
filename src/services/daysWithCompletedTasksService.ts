import { Types } from 'mongoose';
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
// Reusable Aggregation Pipeline Function
// ============================================================================

async function executeCompletedTasksAggregation(
	params: DaysWithCompletedTasksQueryParams | ExportDaysWithCompletedTasksQueryParams,
	userId: Types.ObjectId,
	pagination?: { page: number; maxDaysPerPage: number }
) {
	// Build filters using shared builder
	const searchFilter = buildTaskSearchFilter(params.searchQuery);
	const matchFilter = buildTaskMatchConditions(
		userId,
		params.taskId,
		params.projectIds,
		params.startDate,
		params.endDate,
		params.taskIdIncludeSubtasks,
		params.toDoListAppSources,
		'completedTime',
		params.intervalStartDate,
		params.intervalEndDate,
		params.timezone
	);

	// Build base filtering pipeline (shared by all queries)
	const baseFilterPipeline: any[] = [];

	// Step 1: Apply search filter if it exists
	if (searchFilter) {
		baseFilterPipeline.push({ $match: searchFilter });
	}

	// Step 2: Filter completed tasks and apply other filters
	baseFilterPipeline.push({ $match: matchFilter });

	// Build shared data pipeline (used for both paginated and export queries)
	const dataPipeline: any[] = [
		// Step 3: Sort by completedTime ascending (oldest first within each day)
		{ $sort: { completedTime: 1 } },

		// Step 4: Group tasks by formatted date string (in user's timezone)
		{
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
		},

		// Step 5: Sort based on sortBy parameter
		buildSortStage(params.sortBy)
	];

	// Build aggregation pipeline
	const aggregationPipeline: any[] = [...baseFilterPipeline];

	// If pagination is provided, use $facet to run counts + paginated data in single query
	if (pagination) {
		aggregationPipeline.push({
			$facet: {
				// Facet 1: Paginated results
				paginatedData: [
					...dataPipeline,
					{ $skip: pagination.page * pagination.maxDaysPerPage },
					{ $limit: pagination.maxDaysPerPage },
					{
						$project: {
							dateStr: "$_id",
							completedTasksForDay: 1,
							_id: 0
						}
					}
				],
				// Facet 2: Total tasks count
				totalTasksCount: [
					{ $count: "total" }
				],
				// Facet 3: Total days count
				totalDaysCount: [
					...dataPipeline,
					{ $count: "total" }
				]
			}
		});
	} else {
		// For export (no pagination), add data pipeline and projection directly
		aggregationPipeline.push(
			...dataPipeline,
			{
				$project: {
					dateStr: "$_id",
					completedTasksForDay: 1,
					_id: 0
				}
			}
		);
	}

	// Execute aggregation
	const aggregationResult = await Task.aggregate(aggregationPipeline);

	// Extract results based on query type
	let result: any[];
	let totalTasks = 0
	let totalDays = 0

	if (pagination) {
		// Extract from facet result
		result = aggregationResult[0]?.paginatedData || [];
		totalTasks = aggregationResult[0]?.totalTasksCount[0]?.total || 0;
		totalDays = aggregationResult[0]?.totalDaysCount[0]?.total || 0;
	} else {
		// Direct result for export
		result = aggregationResult;
	}

	// Extract all tasks from all days
	const allTasks = result.flatMap((day: any) => day.completedTasksForDay);

	return { result, allTasks, totalTasks, totalDays };
}

// ============================================================================
// Nested Export Helper Functions
// ============================================================================

/**
 * Build complete nested structure for one day's completed tasks
 * This builds the FULL tree from root ancestors down to completed tasks
 */
function buildNestedStructureForDay(
	completedTasksForDay: any[],
	ancestorTasksById: Record<string, any>
): Record<string, any> {
	// Find the TRUE root tasks (tasks with no parent at all)
	// We need to trace back through ALL ancestors, not just completed ones
	const trueRootTaskIds = new Set<string>();

	completedTasksForDay.forEach(task => {
		// Get the full ancestor chain for this task
		const taskInfo = ancestorTasksById[task.id];
		if (taskInfo && taskInfo.ancestorIds && taskInfo.ancestorIds.length > 0) {
			// The last ancestor in the chain is the root
			const rootId = taskInfo.ancestorIds[taskInfo.ancestorIds.length - 1];
			trueRootTaskIds.add(rootId);
		} else if (!task.parentId) {
			// Task has no parent, so it IS the root
			trueRootTaskIds.add(task.id);
		}
	});

	// Build nested structure for each true root task
	// This will recursively build the tree, including non-completed ancestor nodes
	const nestedStructure: Record<string, any> = {};
	trueRootTaskIds.forEach(rootTaskId => {
		nestedStructure[rootTaskId] = buildNestedTaskNodeWithAncestors(
			rootTaskId,
			completedTasksForDay,
			ancestorTasksById
		);
	});

	return nestedStructure;
}

/**
 * Build nested node including non-completed ancestors
 * This version traverses the full tree structure, not just completed tasks
 */
function buildNestedTaskNodeWithAncestors(
	taskId: string,
	completedTasksForDay: any[],
	ancestorTasksById: Record<string, any>
): any {
	// For tasks with no parent that were completed, they should appear as their own child
	const taskInfo = ancestorTasksById[taskId];
	const hasNoParent = !taskInfo?.parentId;
	const completedTask = completedTasksForDay.find(t => t.id === taskId);

	// Find tasks that are DIRECT children of this task (parentId matches)
	const directChildTasks = completedTasksForDay.filter(task => task.parentId === taskId);

	// Find ALL child task IDs that should appear as nodes below this task
	// This includes:
	// 1. Non-completed intermediate nodes (tasks in ancestor chain but not completed)
	// 2. Completed tasks that have their own children (need to be parent containers)
	const childTaskIdsToRecurse = new Set<string>();

	// Build a map of which tasks have children (are parents)
	const taskIdsWithChildren = new Set<string>();
	completedTasksForDay.forEach(task => {
		if (task.parentId) {
			taskIdsWithChildren.add(task.parentId);
		}
	});

	// Find intermediate parent nodes (not completed themselves, but have completed descendants)
	// Example: Statly > Oct/Nov Update > Break up JSON > Rework exporters > useExportCompletedTasks > Prompt Claude ✅
	// When building "Statly" node and looping through "Prompt Claude" (completed), add "Oct/Nov Update" as intermediate node
	completedTasksForDay.forEach(task => {
		const childInfo = ancestorTasksById[task.id];
		if (childInfo && childInfo.ancestorIds) {
			// ancestorIds = [task, parent, grandparent, ..., root]
			const currentIndex = childInfo.ancestorIds.indexOf(taskId);

			// If currentIndex > 0, there are tasks between taskId and this completed task
			if (currentIndex !== -1 && currentIndex > 0) {
				// Get the direct child of taskId (the intermediate node)
				const directChildId = childInfo.ancestorIds[currentIndex - 1];

				// Only add if it's NOT the completed task itself (that's handled separately below)
				if (directChildId !== task.id) {
					childTaskIdsToRecurse.add(directChildId);
				}
			}
		}
	});

	// Add direct children that are ALSO parents (completed tasks with their own completed children)
	// Example: If "useExportCompletedTasks" was completed AND has completed children, make it an accordion
	directChildTasks.forEach(task => {
		if (taskIdsWithChildren.has(task.id)) {
			childTaskIdsToRecurse.add(task.id);
		}
	});

	// Special case: If this task has no parent and was completed, add itself as a child to recurse
	// BUT only if it has NO other children (otherwise it would create a redundant nested accordion)
	if (hasNoParent && completedTask && childTaskIdsToRecurse.size === 0) {
		childTaskIdsToRecurse.add(taskId);
	}

	// Build nested structure for non-completed children (intermediate nodes)
	let parentDirectChildrenCompletedTasks: Record<string, any> | undefined = undefined;

	if (childTaskIdsToRecurse.size > 0) {
		parentDirectChildrenCompletedTasks = {};
		childTaskIdsToRecurse.forEach(childId => {
			// Avoid infinite recursion: if we're adding the task as its own child, just add the completed task
			if (childId === taskId) {
				parentDirectChildrenCompletedTasks![childId] = {
					directCompletedSubtasks: completedTask ? [completedTask] : undefined,
					parentDirectChildrenCompletedTasks: undefined
				};
			} else {
				parentDirectChildrenCompletedTasks![childId] = buildNestedTaskNodeWithAncestors(
					childId,
					completedTasksForDay,
					ancestorTasksById
				);
			}
		});
	}

	// Build directCompletedSubtasksArray:
	// 1. Include all directChildTasks (tasks whose parentId matches this taskId)
	// 2. Also include the task itself if:
	//    - It was completed
	//    - AND it has no parent (is a root task)
	//    - AND it's not going to nest under itself (i.e., not in childTaskIdsToRecurse)
	//    - This handles the case where a root task was completed along with its children
	const directCompletedSubtasksArray = [...directChildTasks];
	if (completedTask && hasNoParent && !childTaskIdsToRecurse.has(taskId)) {
		directCompletedSubtasksArray.push(completedTask);
	}

	// Return undefined for both if this node has no completed tasks and no children
	if (directCompletedSubtasksArray.length === 0 && !parentDirectChildrenCompletedTasks) {
		return {
			directCompletedSubtasks: undefined,
			parentDirectChildrenCompletedTasks: undefined
		};
	}

	return {
		directCompletedSubtasks: directCompletedSubtasksArray.length > 0 ? directCompletedSubtasksArray : undefined,
		parentDirectChildrenCompletedTasks
	};
}

/**
 * Export days with nested structure (for exportMode='nested')
 * Handles all three groupBy modes: 'none', 'project', 'task'
 */
function exportDaysWithNestedStructure(
	result: any[],
	ancestorTasksById: Record<string, any>,
	params: ExportDaysWithCompletedTasksQueryParams
) {
	// If no grouping, return nested structure for each day
	if (params.groupBy === 'none') {
		const nestedDays: Record<string, any> = {};

		for (const day of result) {
			const { dateStr, completedTasksForDay } = day;
			const nestedStructure = buildNestedStructureForDay(completedTasksForDay, ancestorTasksById);
			nestedDays[dateStr] = {
				taskCount: completedTasksForDay.length, // Include task count at day level
				...nestedStructure // Spread root tasks
			};
		}

		return nestedDays;
	}

	// For project or task grouping
	const grouped: Record<string, Record<string, Record<string, any>>> = {};

	for (const day of result) {
		const { dateStr, completedTasksForDay } = day;

		if (params.groupBy === 'project') {
			// Group by project
			const tasksByProject: Record<string, any[]> = {};

			completedTasksForDay.forEach((task: any) => {
				const projectId = task.projectId || 'no-project-id';
				if (!tasksByProject[projectId]) {
					tasksByProject[projectId] = [];
				}
				tasksByProject[projectId].push(task);
			});

			// Build nested structure for each project
			Object.entries(tasksByProject).forEach(([projectId, tasks]) => {
				if (!grouped[projectId]) {
					grouped[projectId] = {};
				}
				grouped[projectId][dateStr] = {
					...buildNestedStructureForDay(tasks, ancestorTasksById),
					taskCount: tasks.length // Task count for this project on this day
				};
			});
		} else {
			// Group by task (including ancestors if taskIdIncludeSubtasks is true)
			const tasksByGroupId: Record<string, any[]> = {};

			completedTasksForDay.forEach((task: any) => {
				const groupIds = new Set<string>();

				// Add the task itself
				groupIds.add(task.id);

				// If task has a parent, include it
				if (task.parentId) {
					groupIds.add(task.parentId);
				}

				// Include ancestors if setting enabled
				if (params.taskIdIncludeSubtasks) {
					const taskInfo = ancestorTasksById[task.id];
					if (taskInfo?.ancestorIds && taskInfo.ancestorIds.length > 1) {
						// Skip first element (task itself) and add all ancestors
						taskInfo.ancestorIds.slice(1).forEach((ancestorId: string) => {
							groupIds.add(ancestorId);
						});
					}
				}

				// Add this task to all relevant group IDs
				groupIds.forEach(groupId => {
					if (!tasksByGroupId[groupId]) {
						tasksByGroupId[groupId] = [];
					}
					tasksByGroupId[groupId].push(task);
				});
			});

			// Filter out tasks with parents BEFORE building nested structures
			// This avoids unnecessary computation for tasks that will be excluded
			const taskIdsToProcess = Object.keys(tasksByGroupId);
			const filteredTaskIds = params.onlyExportTasksWithNoParent
				? taskIdsToProcess.filter(taskId => {
					const taskInfo = ancestorTasksById[taskId];
					return !taskInfo?.parentId;
				})
				: taskIdsToProcess;

			// Build nested structure only for filtered task groups
			filteredTaskIds.forEach(taskId => {
				const tasks = tasksByGroupId[taskId];
				if (!grouped[taskId]) {
					grouped[taskId] = {};
				}
				if (!grouped[taskId][dateStr]) {
					grouped[taskId][dateStr] = {
						...buildNestedStructureForDay(tasks, ancestorTasksById),
						taskCount: tasks.length // Task count for this task group on this day
					};
				}
			});
		}
	}

	// ============================================================================
	// Group Standalone Daily Habit Tasks (for groupBy='task' only)
	// ============================================================================
	// For nested exports, identify standalone tasks that appear multiple times across days
	// with the same name and create grouped task IDs like "grouped-Check Streaks"
	if (params.groupBy === 'task') {
		// Collect all root task IDs across all days in all groups
		const allRootTasksByGroup: Record<string, { taskId: string, dateStr: string, dayData: any }[]> = {};

		Object.entries(grouped).forEach(([groupId, daysData]) => {
			if (!allRootTasksByGroup[groupId]) {
				allRootTasksByGroup[groupId] = [];
			}

			Object.entries(daysData).forEach(([dateStr, dayData]) => {
				const { taskCount, ...rootTasks } = dayData;
				Object.keys(rootTasks).forEach(taskId => {
					allRootTasksByGroup[groupId].push({ taskId, dateStr, dayData });
				});
			});
		});

		// For each group, identify standalone tasks that should be grouped
		const groupedTaskMapping: Record<string, string> = {}; // Maps original taskId to grouped ID

		Object.entries(allRootTasksByGroup).forEach(([groupId, rootTasks]) => {
			// Group tasks by name
			const tasksByName: Record<string, { taskId: string, dateStr: string }[]> = {};

			rootTasks.forEach(({ taskId, dateStr }) => {
				const taskInfo = ancestorTasksById[taskId];
				const taskName = taskInfo?.title;

				if (taskName) {
					if (!tasksByName[taskName]) {
						tasksByName[taskName] = [];
					}
					tasksByName[taskName].push({ taskId, dateStr });
				}
			});

			// Identify standalone tasks that appear multiple times
			Object.entries(tasksByName).forEach(([taskName, instances]) => {
				// Only group if there are multiple instances with the same name
				if (instances.length > 1) {
					// Check if these are all standalone tasks (only nest under themselves)
					const allStandalone = instances.every(({ taskId, dateStr }) => {
						const dayData = grouped[groupId][dateStr];
						const taskNode = dayData[taskId];

						// A standalone task nests under itself: has one child which is itself
						const childIds = taskNode.parentDirectChildrenCompletedTasks
							? Object.keys(taskNode.parentDirectChildrenCompletedTasks)
							: [];
						return childIds.length === 1 && childIds[0] === taskId;
					});

					if (allStandalone) {
						const groupedId = `grouped-${taskName}`;
						instances.forEach(({ taskId }) => {
							groupedTaskMapping[taskId] = groupedId;
						});
					}
				}
			});
		});

		// Apply grouping by merging standalone tasks across days
		if (Object.keys(groupedTaskMapping).length > 0) {
			Object.entries(grouped).forEach(([groupId, daysData]) => {
				const newDaysData: Record<string, any> = {};

				// For each day, merge tasks that should be grouped
				Object.entries(daysData).forEach(([dateStr, dayData]) => {
					const { taskCount, ...rootTasks } = dayData;
					const newRootTasks: Record<string, any> = {};

					Object.entries(rootTasks).forEach(([taskId, taskNode]) => {
						const mappedId = groupedTaskMapping[taskId];

						if (mappedId) {
							// This task should be grouped - add to grouped ID
							if (!newRootTasks[mappedId]) {
								// First instance - create the grouped node
								newRootTasks[mappedId] = taskNode;
							} else {
								// Merge with existing grouped node
								const existingNode = newRootTasks[mappedId];
								const existingSubtasks = existingNode.parentDirectChildrenCompletedTasks?.[taskId]?.directCompletedSubtasks || [];
								const newSubtasks = taskNode.parentDirectChildrenCompletedTasks?.[taskId]?.directCompletedSubtasks || [];

								if (existingNode.parentDirectChildrenCompletedTasks && taskNode.parentDirectChildrenCompletedTasks) {
									// Merge subtasks
									existingNode.parentDirectChildrenCompletedTasks[taskId] = {
										directCompletedSubtasks: [...existingSubtasks, ...newSubtasks]
									};
								}
							}
						} else {
							// Not grouped - keep as is
							newRootTasks[taskId] = taskNode;
						}
					});

					newDaysData[dateStr] = {
						taskCount,
						...newRootTasks
					};
				});

				grouped[groupId] = newDaysData;
			});
		}
	}

	return grouped;
}

// ============================================================================
// Main Service Method
// ============================================================================

export async function getDaysWithCompletedTasks(params: DaysWithCompletedTasksQueryParams, userId: Types.ObjectId) {
	// Execute aggregation with pagination (now includes counts via $facet)
	const { result, allTasks, totalTasks, totalDays } = await executeCompletedTasksAggregation(params, userId, {
		page: params.page,
		maxDaysPerPage: params.maxDaysPerPage
	});

	// Build ancestor data for all tasks
	const { ancestorTasksById } = await buildAncestorData(allTasks, userId);

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

export async function exportDaysWithCompletedTasks(params: ExportDaysWithCompletedTasksQueryParams, userId: Types.ObjectId) {
	// Fetch all projects and create lookup by ID for current project names
	const projects = await Project.find({ userId }).lean();
	const projectsById: Record<string, any> = {};
	projects.forEach((project: any) => {
		projectsById[project.id] = project;
	});

	// Execute aggregation without pagination
	const { result, allTasks } = await executeCompletedTasksAggregation(params, userId);

	// Build ancestor data for all tasks
	const { ancestorTasksById } = await buildAncestorData(allTasks, userId);

	// If nested export mode, use nested structure
	if (params.exportMode === 'nested') {
		const nestedStructure = exportDaysWithNestedStructure(result, ancestorTasksById, params);
		// Include ancestorTasksById for frontend to use when serializing
		// Also include totalTasks count
		return {
			...nestedStructure,
			ancestorTasksById,
			totalTasks: allTasks.length
		};
	}

	// Otherwise, continue with flat export logic
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
