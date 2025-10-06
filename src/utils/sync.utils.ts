import SyncMetadata from '../models/SyncMetadataModel';
import { TaskTickTick } from '../models/TaskModel';
import { ProjectTickTick, ProjectTodoist } from '../models/projectModel';
import { ProjectGroupTickTick } from '../models/projectGroupModel';
import { fetchAllTickTickTasks, fetchAllTickTickProjects, fetchAllTickTickProjectGroups } from './ticktick.utils';
import { getAllTodoistProjects } from './task.utils';

export async function syncTickTickTasks(userId: string) {
	// Get or create sync metadata
	let syncMetadata = await SyncMetadata.findOne({ syncType: 'tasks' });

	if (!syncMetadata) {
		syncMetadata = new SyncMetadata({
			userId,
			syncType: 'tasks',
			lastSyncTime: new Date(0), // Set to epoch so all tasks are synced initially
		});
	}

	const lastSyncTime = syncMetadata.lastSyncTime;
	const tickTickTasks = await fetchAllTickTickTasks();

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

	for (const task of tickTickTasks) {
		// Check if task needs updating based on modifiedTime
		const taskModifiedTime = task.modifiedTime ? new Date(task.modifiedTime) : null;
		const shouldUpdateTask = !taskModifiedTime || taskModifiedTime >= lastSyncTime;

		if (shouldUpdateTask) {
			// Build ancestor data for full task
			const ancestorIds = buildAncestorChain(task.id, task.parentId);
			const ancestorSet: Record<string, boolean> = {};
			ancestorIds.forEach((id: string) => {
				ancestorSet[id] = true;
			});

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
	};
}

export async function syncTickTickProjects(userId: string) {
	// Get or create sync metadata for projects
	let syncMetadata = await SyncMetadata.findOne({ syncType: 'projects' });

	if (!syncMetadata) {
		syncMetadata = new SyncMetadata({
			userId,
			syncType: 'projects',
			lastSyncTime: new Date(0), // Set to epoch so all projects are synced initially
		});
	}

	const lastSyncTime = syncMetadata.lastSyncTime;
	const tickTickProjects = await fetchAllTickTickProjects();

	const bulkOps = [];

	for (const project of tickTickProjects) {
		// Check if project needs updating based on modifiedTime
		const projectModifiedTime = project.modifiedTime ? new Date(project.modifiedTime) : null;
		const shouldUpdateProject = !projectModifiedTime || projectModifiedTime >= lastSyncTime;

		if (shouldUpdateProject) {
			// Add project upsert operation to bulk array
			bulkOps.push({
				updateOne: {
					filter: { id: project.id },
					update: { $set: project },
					upsert: true,
				},
			});
		}
	}

	// Execute all operations in a single bulkWrite
	const result = await ProjectTickTick.bulkWrite(bulkOps);

	// Update sync metadata with current time
	syncMetadata.lastSyncTime = new Date();
	await syncMetadata.save();

	return {
		message: 'Projects synced successfully',
		upsertedCount: result.upsertedCount,
		modifiedCount: result.modifiedCount,
		matchedCount: result.matchedCount,
		totalOperations: bulkOps.length,
		lastSyncTime: syncMetadata.lastSyncTime,
	};
}

export async function syncTickTickProjectGroups(userId: string) {
	// Get or create sync metadata for project groups
	let syncMetadata = await SyncMetadata.findOne({ syncType: 'project_groups' });

	if (!syncMetadata) {
		syncMetadata = new SyncMetadata({
			userId,
			syncType: 'project_groups',
			lastSyncTime: new Date(0),
		});
	}

	const tickTickProjectGroups = await fetchAllTickTickProjectGroups();

	const bulkOps = [];

	// Always update all project groups since there's no modifiedTime
	for (const projectGroup of tickTickProjectGroups) {
		bulkOps.push({
			updateOne: {
				filter: { id: projectGroup.id },
				update: { $set: projectGroup },
				upsert: true,
			},
		});
	}

	// Execute all operations in a single bulkWrite
	const result = await ProjectGroupTickTick.bulkWrite(bulkOps);

	// Update sync metadata with current time
	syncMetadata.lastSyncTime = new Date();
	await syncMetadata.save();

	return {
		message: 'Project groups synced successfully',
		upsertedCount: result.upsertedCount,
		modifiedCount: result.modifiedCount,
		matchedCount: result.matchedCount,
		totalOperations: bulkOps.length,
		lastSyncTime: syncMetadata.lastSyncTime,
	};
}

export async function syncTodoistProjects(userId: string) {
	// Get or create sync metadata for todoist projects
	let syncMetadata = await SyncMetadata.findOne({ syncType: 'todoist_projects' });

	if (!syncMetadata) {
		syncMetadata = new SyncMetadata({
			userId,
			syncType: 'todoist_projects',
			lastSyncTime: new Date(0), // Set to epoch so all projects are synced initially
		});
	}

	const todoistProjects = await getAllTodoistProjects();

	const bulkOps = [];

	for (const project of todoistProjects) {
		// Normalize Todoist project to match schema (convert snake_case to camelCase)
		const normalizedProject = {
			// Base fields
			id: project.id,
			name: project.name,
			color: project.color,
			parentId: project.parent_id,

			// Todoist-specific fields
			description: project.description || '',
			order: project.order,
			isCollapsed: project.is_collapsed,
			isShared: project.is_shared,
			isFavorite: project.is_favorite,
			isArchived: project.is_archived,
			canAssignTasks: project.can_assign_tasks,
			viewStyle: project.view_style,
			isInboxProject: project.is_inbox_project,
			workspaceId: project.workspace_id,
			folderId: project.folder_id,
			createdAt: project.created_at ? new Date(project.created_at) : null,
			updatedAt: project.updated_at ? new Date(project.updated_at) : null,
		};

		bulkOps.push({
			updateOne: {
				filter: { id: project.id },
				update: { $set: normalizedProject },
				upsert: true,
			},
		});
	}

	// Execute all operations in a single bulkWrite
	const result = await ProjectTodoist.bulkWrite(bulkOps);

	// Update sync metadata with current time
	syncMetadata.lastSyncTime = new Date();
	await syncMetadata.save();

	return {
		message: 'Todoist projects synced successfully',
		upsertedCount: result.upsertedCount,
		modifiedCount: result.modifiedCount,
		matchedCount: result.matchedCount,
		totalOperations: bulkOps.length,
		lastSyncTime: syncMetadata.lastSyncTime,
	};
}
