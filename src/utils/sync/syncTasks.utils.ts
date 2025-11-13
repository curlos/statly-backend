import { FocusRecordTickTick } from "../../models/FocusRecord";
import { TaskTickTick, TaskTodoist } from "../../models/TaskModel";
import { getOrCreateSyncMetadata } from "../helpers.utils";
import { fetchAllTickTickTasks } from "../ticktick.utils";
import { getAllTodoistTasks } from "../task.utils";

export async function syncTickTickTasks(userId: string, options?: {
	archivedProjectIds?: string[];
	getTasksFromNonArchivedProjects?: boolean;
}) {
	// Get or create sync metadata
	const syncMetadata = await getOrCreateSyncMetadata(userId, 'tickTickTasks');

	const lastSyncTime = syncMetadata.lastSyncTime;
	const tickTickTasks = await fetchAllTickTickTasks({
		archivedProjectIds: options?.archivedProjectIds,
		getTasksFromNonArchivedProjects: options?.getTasksFromNonArchivedProjects
	});

	// Calculate threshold for recently completed tasks (1 week ago)
	const oneWeekAgo = new Date();
	oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

	// Step 1: Build tasksById map for quick parent lookups
	const tasksById: Record<string, any> = {};
	tickTickTasks.forEach((task: any) => {
		tasksById[task.id] = task;
	});

	// Step 2: Build ancestor data with caching
	const ancestorCache: Record<string, string[]> = {};

	const buildAncestorChain = (taskId: string, parentId: string | undefined): string[] => {
		// Include the task itself in its ancestor chain
		if (!parentId) {
			return [taskId];
		}

		// Check cache first (reuse for siblings with same parent)
		if (ancestorCache[parentId]) {
			return [taskId, ...ancestorCache[parentId]];
		}

		// Walk up the parent chain
		const chain = [taskId];
		let currentParentId: string | undefined = parentId;

		while (currentParentId && tasksById[currentParentId]) {
			chain.push(currentParentId);
			currentParentId = tasksById[currentParentId].parentId;
		}

		// Cache the chain for this parent (excluding the task itself)
		ancestorCache[parentId] = chain.slice(1);

		return chain;
	};

	const bulkOps = [];
	// Track modified tasks for focus record updates
	const modifiedTasksMap: Record<string, { projectId: string, ancestorIds: string[] }> = {};

	for (const task of tickTickTasks) {
		// Check if task needs updating based on modifiedTime
		const taskModifiedTime = task.modifiedTime ? new Date(task.modifiedTime) : null;

		// Update task if:
		// 1. No modifiedTime exists, OR
		// 2. Task was modified after last sync, OR
		// 3. Task was modified within the last week
		const shouldUpdateTask =
			!taskModifiedTime ||
			taskModifiedTime >= lastSyncTime ||
			taskModifiedTime >= oneWeekAgo;

		if (shouldUpdateTask) {
			// Build ancestor data for full task
			const ancestorIds = buildAncestorChain(task.id, task.parentId);
			const ancestorSet: Record<string, boolean> = {};
			ancestorIds.forEach((id: string) => {
				ancestorSet[id] = true;
			});

			// Track this task for focus record updates
			modifiedTasksMap[task.id] = {
				projectId: task.projectId,
				ancestorIds: ancestorIds
			};

			// Normalize the FULL task
			const normalizedFullTask = {
				...task,
				taskType: 'full',
				title: task.title,
				description: task.desc || task.description || '',
				projectId: task.projectId,
				parentId: task.parentId,
				completedTime: task.completedTime,
				sortOrder: task.sortOrder,
				timeZone: task.timeZone,
				ancestorIds,
				ancestorSet,
			};

			// Add full task upsert operation to bulk array
			bulkOps.push({
				updateOne: {
					filter: { id: task.id },
					update: { $set: normalizedFullTask },
					upsert: true,
				},
			});

			// Process items array (if it exists and has items)
			// Items are always updated if their parent task is updated
			if (task.items && task.items.length > 0) {
				for (const item of task.items) {
					// Build ancestor data for item (parent is the full task)
					const itemAncestorIds = buildAncestorChain(item.id, task.id);
					const itemAncestorSet: Record<string, boolean> = {};
					itemAncestorIds.forEach((id: string) => {
						itemAncestorSet[id] = true;
					});

					// Normalize item task
					const normalizedItemTask = {
						...item,
						taskType: 'item',
						title: item.title,
						description: '',
						projectId: task.projectId, // Inherit from parent
						parentId: task.id, // Parent is the full task
						completedTime: item.completedTime,
						sortOrder: item.sortOrder,
						timeZone: item.timeZone,
						startDate: item.startDate,
						ancestorIds: itemAncestorIds,
						ancestorSet: itemAncestorSet,
					};

					// Add item task upsert operation to bulk array
					bulkOps.push({
						updateOne: {
							filter: { id: item.id },
							update: { $set: normalizedItemTask },
							upsert: true,
						},
					});
				}
			}
		}
	}

	// Execute all operations in a single bulkWrite
	const result = await TaskTickTick.bulkWrite(bulkOps);

	// Update focus records with modified task data
	let focusRecordResult = null;
	if (Object.keys(modifiedTasksMap).length > 0) {
		const modifiedTaskIds = Object.keys(modifiedTasksMap);

		// Find all focus records that contain any of the modified tasks
		const focusRecordsToUpdate = await FocusRecordTickTick.find({
			'tasks.taskId': { $in: modifiedTaskIds }
		}).lean() as any[];

		const focusRecordBulkOps = [];

		for (const focusRecord of focusRecordsToUpdate) {
			// Check which tasks in this focus record need updating
			const tasksNeedingUpdate = focusRecord.tasks?.filter((task: any) => {
				if (!modifiedTasksMap[task.taskId]) return false;

				const modifiedTask = modifiedTasksMap[task.taskId];

				// Compare projectId and ancestorIds
				const projectIdChanged = task.projectId !== modifiedTask.projectId;
				const ancestorIdsChanged = JSON.stringify(task.ancestorIds || []) !== JSON.stringify(modifiedTask.ancestorIds);

				return projectIdChanged || ancestorIdsChanged;
			}) || [];

			// If any tasks need updating, create a bulk operation
			if (tasksNeedingUpdate.length > 0) {
				for (const taskToUpdate of tasksNeedingUpdate) {
					const modifiedTask = modifiedTasksMap[taskToUpdate.taskId];

					// Use arrayFilters to update specific task in the array
					focusRecordBulkOps.push({
						updateOne: {
							filter: {
								id: focusRecord.id,
								'tasks.taskId': taskToUpdate.taskId
							},
							update: {
								$set: {
									'tasks.$[elem].projectId': modifiedTask.projectId,
									'tasks.$[elem].ancestorIds': modifiedTask.ancestorIds
								}
							},
							arrayFilters: [{ 'elem.taskId': taskToUpdate.taskId }]
						}
					});
				}
			}
		}

		// Execute focus record updates if there are any
		if (focusRecordBulkOps.length > 0) {
			focusRecordResult = await FocusRecordTickTick.bulkWrite(focusRecordBulkOps);
		}
	}

	// Update sync metadata with current time and tasks updated count
	syncMetadata.lastSyncTime = new Date();
	syncMetadata.tasksUpdated = bulkOps.length;
	await syncMetadata.save();

	return {
		message: 'Transfer complete',
		upsertedCount: result.upsertedCount,
		modifiedCount: result.modifiedCount,
		matchedCount: result.matchedCount,
		totalOperations: bulkOps.length,
		lastSyncTime: syncMetadata.lastSyncTime,
		focusRecordsUpdated: focusRecordResult ? {
			modifiedCount: focusRecordResult.modifiedCount,
			matchedCount: focusRecordResult.matchedCount
		} : null
	};
}

export async function syncTodoistTasks(userId: string) {
	// Get or create sync metadata for todoist tasks
	const syncMetadata = await getOrCreateSyncMetadata(userId, 'todoistTasks');

	const allTasks = await getAllTodoistTasks();

	// Step 1: Build tasksById map for quick parent lookups
	const tasksById: Record<string, any> = {};
	allTasks.forEach((task: any) => {
		const taskId = task.v2_id || task.id
		tasksById[taskId] = task;
	});

	// Step 2: Build ancestor data with caching
	const ancestorCache: Record<string, string[]> = {};

	const buildAncestorChain = (taskId: string, parentId: string | undefined): string[] => {
		// Include the task itself in its ancestor chain
		if (!parentId) {
			return [taskId];
		}

		// Check cache first (reuse for siblings with same parent)
		if (ancestorCache[parentId]) {
			return [taskId, ...ancestorCache[parentId]];
		}

		// Walk up the parent chain
		const chain = [taskId];
		let currentParentId: string | undefined = parentId;

		while (currentParentId && tasksById[currentParentId]) {
			chain.push(currentParentId);
			currentParentId = tasksById[currentParentId].v2_parent_id || tasksById[currentParentId].parent_id;
		}

		// Cache the chain for this parent (excluding the task itself)
		ancestorCache[parentId] = chain.slice(1);

		return chain;
	};

	const bulkOps = [];

	for (const task of allTasks) {
		// Build ancestor data
		const taskId = task.v2_id || task.id
		const parentId = task.v2_parent_id || task.parent_id;
		const ancestorIds = buildAncestorChain(taskId, parentId);
		const ancestorSet: Record<string, boolean> = {};
		ancestorIds.forEach((id: string) => {
			ancestorSet[id] = true;
		});

		// Normalize the Todoist task to match our schema
		const normalizedTask = {
			...task,
			id: taskId,
			title: task.content || task.title || '',
			description: task.description || '',
			projectId: task.v2_project_id || task.project_id,
			parentId: parentId,
			completedTime: task.completed_at ? new Date(task.completed_at) : null,
			ancestorIds,
			ancestorSet,
		};

		// Add upsert operation to bulk array
		bulkOps.push({
			updateOne: {
				filter: { id: taskId },
				update: { $set: normalizedTask },
				upsert: true,
			},
		});
	}

	// Execute all operations in a single bulkWrite
	const result = await TaskTodoist.bulkWrite(bulkOps);

	// Update sync metadata with current time
	syncMetadata.lastSyncTime = new Date();
	await syncMetadata.save();

	return {
		message: 'Todoist tasks synced successfully',
		upsertedCount: result.upsertedCount,
		modifiedCount: result.modifiedCount,
		matchedCount: result.matchedCount,
		totalOperations: bulkOps.length,
		lastSyncTime: syncMetadata.lastSyncTime,
	};
}