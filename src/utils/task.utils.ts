import { Types } from 'mongoose';
import { Task, ITask } from '../models/TaskModel';
import { getJsonData } from './mongoose.utils';
import { TodoistSyncTasksById, TodoistApiV1Task, TodoistSyncTask } from '../types/todoist';

// Helper function to build ancestor data for tasks (optimized with pre-computed ancestorIds)
export async function buildAncestorData(tasks: ITask[], userId: Types.ObjectId) {
	// Step 1: Collect ALL unique ancestor IDs from tasks (using pre-computed ancestorIds)
	const allAncestorIds = new Set<string>();

	tasks.forEach(task => {
		if (task.ancestorIds && task.ancestorIds.length > 0) {
			// Optimization: If we've seen an ancestor in the chain, we've seen all above it
			for (const ancestorId of task.ancestorIds) {
				if (allAncestorIds.has(ancestorId)) {
					break; // Skip the rest - we've already added this ancestor chain
				}
				allAncestorIds.add(ancestorId);
			}
		}
	});

	// Step 2: Fetch ALL ancestor tasks in ONE batch query (only needed fields)
	const ancestorTasks = await Task.find({
		userId,
		id: { $in: Array.from(allAncestorIds) }
	})
		.select('id title parentId ancestorIds projectId')
		.lean();

	// Step 3: Build ancestorTasksById map
	const ancestorTasksById: Record<string, { id: string; title: string; parentId: string | null; ancestorIds: Array<string>; projectId: string | null; }> = {};
	ancestorTasks.forEach(task => {
		ancestorTasksById[task.id] = {
			id: task.id,
			title: task.title,
			parentId: task.parentId ?? null,
			ancestorIds: task.ancestorIds,
			projectId: task.projectId ?? null
		};
	});

	return { ancestorTasksById };
}

// Helper function to get tasks that only appear in API v1 (not in sync)
export const getTodoistTasksThatOnlyAppearInAPIV1 = (todoistAllSyncTasksById: TodoistSyncTasksById, allNewAPIV1Tasks: TodoistApiV1Task[]) => {
	const syncTasksByV2Id: Record<string, TodoistSyncTask> = {};

	for (const key in todoistAllSyncTasksById) {
		const entry = todoistAllSyncTasksById[key];
		const v2Id = (entry.item as Record<string, unknown> | undefined)?.v2_id as string | undefined;

		if (v2Id) {
			syncTasksByV2Id[v2Id] = entry;
		}
	}

	const apiV1TasksThatAreNotInSync = allNewAPIV1Tasks.filter((task) => {
		return !syncTasksByV2Id[task.id]
	})

	return apiV1TasksThatAreNotInSync
}

// Get all Todoist tasks (combining sync and API v1 data)
export async function getAllTodoistTasks(useNewSyncDataTodoistData: boolean = true) {
	// Personal
	const todoistPersonalCompletedTasksById = useNewSyncDataTodoistData
		? await getJsonData('sync-2025-todoist-personal-completed-tasks-by-id')
		: await getJsonData('todoist-personal-completed-tasks-by-id');
	const todoistPersonalActiveTasksById = useNewSyncDataTodoistData
		? await getJsonData('sync-2025-todoist-personal-active-tasks-by-id')
		: await getJsonData('todoist-personal-active-tasks-by-id');

	// Q Link
	const todoistQLinkCompletedTasksById = useNewSyncDataTodoistData
		? await getJsonData('sync-2025-todoist-qlink-completed-tasks-by-id')
		: await getJsonData('todoist-qlink-completed-tasks-by-id');
	const todoistQLinkActiveTasksById = useNewSyncDataTodoistData
		? await getJsonData('sync-2025-todoist-qlink-active-tasks-by-id')
		: await getJsonData('todoist-qlink-active-tasks-by-id');

	const todoistAllSyncTasksById = {
		...todoistPersonalCompletedTasksById,
		...todoistPersonalActiveTasksById,
		...todoistQLinkCompletedTasksById,
		...todoistQLinkActiveTasksById,
	};

	const api_v1_todoist_all_personal_completed_tasks_by_id = await getJsonData('api_v1_todoist_all_personal_completed_tasks_by_id')
	const api_v1_todoist_all_personal_active_tasks_by_id = await getJsonData('api_v1_todoist_all_personal_active_tasks_by_id')
	const api_v1_todoist_all_work_completed_tasks_by_id = await getJsonData('api_v1_todoist_all_work_completed_tasks_by_id')
	const api_v1_todoist_all_work_active_tasks_by_id = await getJsonData('api_v1_todoist_all_work_active_tasks_by_id')

	const todoistAllApiV1TasksById = {
		...api_v1_todoist_all_personal_completed_tasks_by_id,
		...api_v1_todoist_all_personal_active_tasks_by_id,
		...api_v1_todoist_all_work_completed_tasks_by_id,
		...api_v1_todoist_all_work_active_tasks_by_id
	}

	const allSyncTasksWithOnlyItem = (Object.values(todoistAllSyncTasksById) as TodoistSyncTask[]).map((syncTask) => syncTask.item as Record<string, unknown>)
	const allSyncTasksThatDoNotAppearInAPIV1 = allSyncTasksWithOnlyItem.filter((task: Record<string, unknown>) => {
		const task_v2_id = task["v2_id"] as string | undefined;

		return !task_v2_id || !todoistAllApiV1TasksById[task_v2_id];
	});
	const allNewAPIV1Tasks = Object.values(todoistAllApiV1TasksById) as Record<string, unknown>[];
	const allTasks: Record<string, unknown>[] = [
		...allSyncTasksThatDoNotAppearInAPIV1,
		...allNewAPIV1Tasks
	]

	return allTasks;
}

export async function getAllTodoistProjects() {
	// Personal
	const todoistPersonalActiveProjects = await getJsonData('api_v1_todoist_all_personal_active_projects');
	const todoistPersonalArchivedProjects = await getJsonData('api_v1_todoist_all_personal_archived_projects');

	// Work
	const todoistWorkActiveProjects = await getJsonData('api_v1_todoist_all_work_active_projects');
	const todoistWorkArchivedProjects = await getJsonData('api_v1_todoist_all_work_archived_projects');

	const allProjects = [
		...todoistPersonalActiveProjects,
		...todoistPersonalArchivedProjects,
		...todoistWorkActiveProjects,
		...todoistWorkArchivedProjects
	];

	return allProjects;
}
