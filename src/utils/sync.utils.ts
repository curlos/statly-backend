import SyncMetadata from '../models/SyncMetadataModel';
import { TaskTickTick } from '../models/TaskModel';
import { ProjectTickTick, ProjectTodoist } from '../models/projectModel';
import { ProjectGroupTickTick } from '../models/projectGroupModel';
import { FocusRecordTickTick } from '../models/FocusRecord';
import { fetchAllTickTickTasks, fetchAllTickTickProjects, fetchAllTickTickProjectGroups } from './ticktick.utils';
import { getAllTodoistProjects } from './task.utils';
import { fetchTickTickFocusRecords } from './focus.utils';
import { crossesMidnightInTimezone } from './timezone.utils';

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

	// Calculate threshold for recently completed tasks (3 days ago)
	const threeDaysAgo = new Date();
	threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

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
		// 3. Task was modified within the last 3 days
		const shouldUpdateTask =
			!taskModifiedTime ||
			taskModifiedTime >= lastSyncTime ||
			taskModifiedTime >= threeDaysAgo;

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

export async function syncTickTickFocusRecords(userId: string, timezone: string = 'UTC') {
	// Get or create sync metadata for focus records
	let syncMetadata = await SyncMetadata.findOne({ syncType: 'focus-records-ticktick' });

	if (!syncMetadata) {
		syncMetadata = new SyncMetadata({
			userId,
			syncType: 'focus-records-ticktick',
			lastSyncTime: new Date(0), // Set to epoch so all focus records are synced initially
		});
	}

	const lastSyncTime = syncMetadata.lastSyncTime;
	const focusRecords = await fetchTickTickFocusRecords();

	// Calculate the cutoff date (30 days before last sync)
	const thirtyDaysBeforeLastSync = new Date(lastSyncTime);
	thirtyDaysBeforeLastSync.setDate(thirtyDaysBeforeLastSync.getDate() - 30);

	// Collect all unique task IDs from focus records
	const allTaskIds = new Set<string>();
	for (const record of focusRecords) {
		const recordEndTime = new Date(record.endTime);
		if (recordEndTime >= thirtyDaysBeforeLastSync && record.tasks) {
			record.tasks.forEach((task: any) => {
				if (task.taskId) {
					allTaskIds.add(task.taskId);
				}
			});
		}
	}

	// Fetch full task documents to get projectId and ancestorIds
	const tasksById: Record<string, any> = {};
	if (allTaskIds.size > 0) {
		const fullTasks = await TaskTickTick.find({
			id: { $in: Array.from(allTaskIds) }
		}).select('id projectId ancestorIds').lean();

		fullTasks.forEach((task: any) => {
			tasksById[task.id] = {
				projectId: task.projectId,
				ancestorIds: task.ancestorIds || []
			};
		});
	}

	const bulkOps = [];

	for (const record of focusRecords) {
		const recordEndTime = new Date(record.endTime);

		// Only sync if endTime is within 30 days of last sync
		if (recordEndTime >= thirtyDaysBeforeLastSync) {
			// Calculate duration and denormalize projectId/ancestorIds for each task
			const tasksWithDuration = (record.tasks || []).map((task: any) => {
				const startTime = new Date(task.startTime);
				const endTime = new Date(task.endTime);
				const duration = (endTime.getTime() - startTime.getTime()) / 1000; // Duration in seconds

				const taskData = tasksById[task.taskId];
				return {
					...task,
					duration,
					projectId: taskData?.projectId || null,
					ancestorIds: taskData?.ancestorIds || []
				};
			});

			// Calculate the focus record's total duration (subtract pauseDuration, in seconds)
			const startTime = new Date(record.startTime);
			const endTime = new Date(record.endTime);
			const totalDurationSeconds = (endTime.getTime() - startTime.getTime()) / 1000; // Convert to seconds
			const pauseDuration = record.pauseDuration || 0; // pauseDuration is already in seconds
			const realFocusDuration = totalDurationSeconds - pauseDuration; // Subtract pause duration

			// Check if record crosses midnight in user's timezone
			const crossesMidnight = crossesMidnightInTimezone(startTime, endTime, timezone);

			// Normalize the focus record to match our schema
			const normalizedRecord = {
				...record,
				duration: realFocusDuration,
				tasks: tasksWithDuration,
				crossesMidnight,
			};

			// Add upsert operation to bulk array
			bulkOps.push({
				updateOne: {
					filter: { id: record.id },
					update: { $set: normalizedRecord },
					upsert: true,
				},
			});
		}
	}

	// Execute all operations in a single bulkWrite
	const result = bulkOps.length > 0 ? await FocusRecordTickTick.bulkWrite(bulkOps) : {
		upsertedCount: 0,
		modifiedCount: 0,
		matchedCount: 0,
	};

	// Update sync metadata with current time
	syncMetadata.lastSyncTime = new Date();
	await syncMetadata.save();

	return {
		message: 'TickTick focus records synced successfully',
		upsertedCount: result.upsertedCount,
		modifiedCount: result.modifiedCount,
		matchedCount: result.matchedCount,
		totalOperations: bulkOps.length,
		lastSyncTime: syncMetadata.lastSyncTime,
	};
}
