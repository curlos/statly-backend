import { Types } from 'mongoose';
import { FocusRecordTickTick } from "../../models/FocusRecord";
import { TaskTickTick, TaskTodoist } from "../../models/TaskModel";
import { getOrCreateSyncMetadata } from "../helpers.utils";
import { fetchAllTickTickTasks } from "../ticktick.utils";
import { getAllTodoistTasks } from "../task.utils";

export async function syncTickTickTasks(userId: Types.ObjectId, options?: {
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

	// Fetch only the task IDs that are being synced (much faster than fetching all tasks)
	const taskIdsToCheck = tickTickTasks.map((t: any) => t.id);
	const existingTaskIds = await TaskTickTick.distinct('id', {
		userId,
		id: { $in: taskIdsToCheck }
	});
	const existingTaskIdsSet = new Set(existingTaskIds);

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
	const modifiedTasksMap: Record<string, { projectId: string, ancestorIds: string[], title: string }> = {};

	for (const task of tickTickTasks) {
		// Check if task needs updating based on modifiedTime
		const taskModifiedTime = task.modifiedTime ? new Date(task.modifiedTime) : null;

		// Update task if:
		// 1. Task doesn't exist in DB yet, OR
		// 2. No modifiedTime exists, OR
		// 3. Task was modified after last sync, OR
		// 4. Task was modified within the last week
		const shouldUpdateTask =
			!existingTaskIdsSet.has(task.id) ||
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
				ancestorIds: ancestorIds,
				title: task.title
			};

			// Normalize the FULL task
			const normalizedFullTask = {
				...task,
				userId,
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
					filter: { id: task.id, userId },
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
						userId,
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
							filter: { id: item.id, userId },
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
		// Only fetch fields we need (id and tasks) for better performance
		const focusRecordsToUpdate = await FocusRecordTickTick.find({
			userId,
			'tasks.taskId': { $in: modifiedTaskIds }
		})
		.select('id tasks')
		.lean() as any[];

		const focusRecordBulkOps = [];

		for (const focusRecord of focusRecordsToUpdate) {
			const updateFields: Record<string, any> = {};

			// Check each task in the focus record and batch updates
			focusRecord.tasks?.forEach((task: any, index: number) => {
				if (!modifiedTasksMap[task.taskId]) return;

				const modifiedTask = modifiedTasksMap[task.taskId];

				// Compare projectId, ancestorIds, and title
				const projectIdChanged = task.projectId !== modifiedTask.projectId;
				const ancestorIdsChanged = JSON.stringify(task.ancestorIds || []) !== JSON.stringify(modifiedTask.ancestorIds);
				const titleChanged = task.title !== modifiedTask.title;

				if (projectIdChanged || ancestorIdsChanged || titleChanged) {
					// Update by array index (faster than arrayFilters)
					updateFields[`tasks.${index}.projectId`] = modifiedTask.projectId;
					updateFields[`tasks.${index}.ancestorIds`] = modifiedTask.ancestorIds;
					updateFields[`tasks.${index}.title`] = modifiedTask.title;
				}
			});

			// Create ONE bulk operation per focus record (not per task!)
			if (Object.keys(updateFields).length > 0) {
				focusRecordBulkOps.push({
					updateOne: {
						filter: { id: focusRecord.id, userId },
						update: { $set: updateFields }
					}
				});
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

export async function syncTodoistTasks(userId: Types.ObjectId) {
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
			userId,
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
				filter: { id: taskId, userId },
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