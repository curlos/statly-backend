import { randomUUID } from 'crypto';
import SyncMetadata from '../models/SyncMetadataModel';
import { TaskTickTick } from '../models/TaskModel';
import { ProjectTickTick, ProjectTodoist } from '../models/projectModel';
import { ProjectGroupTickTick } from '../models/projectGroupModel';
import { FocusRecordTickTick, FocusRecordBeFocused, FocusRecordForest, FocusRecordTide, FocusRecordSession } from '../models/FocusRecord';
import { fetchAllTickTickTasks, fetchAllTickTickProjects, fetchAllTickTickProjectGroups } from './ticktick.utils';
import { getAllTodoistProjects } from './task.utils';
import { fetchTickTickFocusRecords, fetchBeFocusedAppFocusRecords, fetchForestAppFocusRecords, fetchTideAppFocusRecords, fetchSessionFocusRecordsWithNoBreaks } from './focus.utils';
import { crossesMidnightInTimezone } from './timezone.utils';

export async function syncTickTickTasks(userId: string, options?: {
	archivedProjectIds?: string[];
	getTasksFromNonArchivedProjects?: boolean;
}) {
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
	const tickTickTasks = await fetchAllTickTickTasks({
		archivedProjectIds: options?.archivedProjectIds,
		getTasksFromNonArchivedProjects: options?.getTasksFromNonArchivedProjects
	});

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
					// If the task has no projectId, it must be an empty task or an older task like the "Full Stack Open" focus tasks from 2020.
					projectId: taskData?.projectId || 'inbox116577688',
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

export async function syncBeFocusedFocusRecords(timezone: string = 'UTC') {
	// Fetch raw BeFocused data
	const rawBeFocusedRecords = await fetchBeFocusedAppFocusRecords();

	// Normalize each record to match TickTick format
	const normalizedRecords = rawBeFocusedRecords.map((record: any) => {
		const startDate = new Date(record['Start date']);
		const durationInMinutes = Number(record['Duration']);
		const durationInSeconds = durationInMinutes * 60; // Convert minutes to seconds
		const endDate = new Date(startDate.getTime() + durationInMinutes * 60 * 1000);
		const assignedTask = record['Assigned task'] || 'Untitled';

		// Create custom taskId: "TaskName - BeFocused"
		const taskId = `${assignedTask} - BeFocused`;

		// Check if record crosses midnight in user's timezone
		const crossesMidnight = crossesMidnightInTimezone(startDate, endDate, timezone);
		const focusAppSource = 'FocusRecordBeFocused'

		return {
			id: randomUUID(),
			source: focusAppSource,
			startTime: startDate, // Date object for MongoDB
			endTime: endDate, // Date object for MongoDB
			duration: durationInSeconds, // Duration in seconds like TickTick
			crossesMidnight,
			tasks: [
				{
					taskId,
					title: assignedTask,
					startTime: startDate, // Date object for MongoDB
					endTime: endDate, // Date object for MongoDB
					duration: durationInSeconds, // Each task has the full duration since there's only one task,
					projectId: focusAppSource,
					projectName: focusAppSource
				}
			]
		};
	});

	// Bulk upsert to database
	const bulkOps = normalizedRecords.map((record: any) => ({
		updateOne: {
			filter: { id: record.id },
			update: { $set: record },
			upsert: true
		}
	}));

	const result = await FocusRecordBeFocused.bulkWrite(bulkOps);

	return {
		message: 'BeFocused focus records synced successfully',
		recordsProcessed: normalizedRecords.length,
		upsertedCount: result.upsertedCount,
		modifiedCount: result.modifiedCount,
	};
}

export async function syncForestFocusRecords(timezone: string = 'UTC') {
	// Fetch raw Forest data
	const rawForestRecords = await fetchForestAppFocusRecords(true);

	// Normalize each record to match TickTick format
	const normalizedRecords = rawForestRecords.map((record: any) => {
		const startDate = new Date(record['Start Time']);
		const endDate = new Date(record['End Time']);
		const durationInSeconds = Math.floor((endDate.getTime() - startDate.getTime()) / 1000);
		const tag = record['Tag'] || '';
		const note = record['Note'] || '';
		const treeType = record['Tree Type'] || '';
		const isSuccess = record['Is Success'] === 'True';

		// Create custom taskId: "Tag - Forest"
		const taskId = `${tag} - Forest`;

		// Check if record crosses midnight in user's timezone
		const crossesMidnight = crossesMidnightInTimezone(startDate, endDate, timezone);

		const focusAppSource = 'FocusRecordForest'

		return {
			id: randomUUID(),
			source: focusAppSource,
			startTime: startDate, // Date object for MongoDB
			endTime: endDate, // Date object for MongoDB
			duration: durationInSeconds, // Duration in seconds like TickTick
			crossesMidnight,
			note,
			treeType,
			isSuccess,
			tasks: [
				{
					taskId,
					title: tag,
					startTime: startDate, // Date object for MongoDB
					endTime: endDate, // Date object for MongoDB
					duration: durationInSeconds, // Each task has the full duration since there's only one task
					projectId: focusAppSource,
					projectName: focusAppSource
				}
			]
		};
	});

	// Bulk upsert to database
	const bulkOps = normalizedRecords.map((record: any) => ({
		updateOne: {
			filter: { id: record.id },
			update: { $set: record },
			upsert: true
		}
	}));

	const result = await FocusRecordForest.bulkWrite(bulkOps);

	return {
		message: 'Forest focus records synced successfully',
		recordsProcessed: normalizedRecords.length,
		upsertedCount: result.upsertedCount,
		modifiedCount: result.modifiedCount,
	};
}

export async function syncTideFocusRecords(timezone: string = 'UTC') {
	// Fetch raw Tide data
	const rawTideRecords = await fetchTideAppFocusRecords();

	// Helper function to parse duration string (e.g., "1h50m", "35m", "3m")
	const parseDuration = (durationStr: string): number => {
		let totalSeconds = 0;
		const hourMatch = durationStr.match(/(\d+)h/);
		const minuteMatch = durationStr.match(/(\d+)m/);

		if (hourMatch) {
			totalSeconds += parseInt(hourMatch[1]) * 3600;
		}
		if (minuteMatch) {
			totalSeconds += parseInt(minuteMatch[1]) * 60;
		}

		return totalSeconds;
	};

	// Normalize each record to match TickTick format
	const normalizedRecords = rawTideRecords.map((record: any) => {
		const startDate = new Date(record['startTime']);
		const durationInSeconds = parseDuration(record['duration']);
		const endDate = new Date(startDate.getTime() + durationInSeconds * 1000);
		const name = record['name'] || 'Untitled';

		// Create custom taskId: "Name - Tide"
		const taskId = `${name} - Tide`;

		// Check if record crosses midnight in user's timezone
		const crossesMidnight = crossesMidnightInTimezone(startDate, endDate, timezone);

		const focusAppSource = 'FocusRecordTide'

		return {
			id: `${startDate.getTime()}-tide`, // Custom ID based on start time
			source: focusAppSource,
			startTime: startDate, // Date object for MongoDB
			endTime: endDate, // Date object for MongoDB
			duration: durationInSeconds, // Duration in seconds like TickTick
			crossesMidnight,
			tasks: [
				{
					taskId,
					title: name,
					startTime: startDate, // Date object for MongoDB
					endTime: endDate, // Date object for MongoDB
					duration: durationInSeconds, // Each task has the full duration since there's only one task
					projectId: focusAppSource,
					projectName: focusAppSource
				}
			]
		};
	});

	// Bulk upsert to database
	const bulkOps = normalizedRecords.map((record: any) => ({
		updateOne: {
			filter: { id: record.id },
			update: { $set: record },
			upsert: true
		}
	}));

	const result = await FocusRecordTide.bulkWrite(bulkOps);

	return {
		message: 'Tide focus records synced successfully',
		recordsProcessed: normalizedRecords.length,
		upsertedCount: result.upsertedCount,
		modifiedCount: result.modifiedCount,
	};
}

export async function syncSessionFocusRecords(timezone: string = 'UTC') {
	// Fetch raw Session data
	const rawSessionRecords = await fetchSessionFocusRecordsWithNoBreaks();

	// Normalize each record to match TickTick format
	const normalizedRecords = rawSessionRecords.map((record: any) => {
		const startDate = new Date(record['start_date']);
		const endDate = new Date(record['end_date']);
		const totalDurationInSeconds = record['duration_second'];
		const pauseDurationInSeconds = record['pause_second'] || 0;
		const actualDurationInSeconds = totalDurationInSeconds - pauseDurationInSeconds;

		const categoryTitle = record['category']?.['title'] || 'General';
		const categoryId = record['category']?.['id'] || 'general-session';
		const title = record['title'] || categoryTitle;
		const note = record['notes'] || '';

		// Normalize "General" category
		const projectId = categoryId === '' ? 'general-session' : categoryId;
		const projectName = categoryTitle;

		// Parse meta array to get pause periods
		const metaPauses = (record['meta'] || [])
			.filter((m: any) => m.type === 'PAUSE')
			.map((m: any) => ({
				start: new Date(m['start_date']),
				end: new Date(m['end_date'])
			}))
			.sort((a: any, b: any) => a.start.getTime() - b.start.getTime());

		// Build tasks array by splitting based on pauses
		const tasks = [];
		let currentStart = startDate;

		for (const pause of metaPauses) {
			// Task before this pause
			const taskEnd = pause.start;
			const taskDuration = Math.floor((taskEnd.getTime() - currentStart.getTime()) / 1000);

			if (taskDuration > 0) {
				tasks.push({
					taskId: `${title} - Session`,
					title,
					startTime: currentStart,
					endTime: taskEnd,
					duration: taskDuration,
					projectId,
					projectName,
				});
			}

			// Move start to after pause
			currentStart = pause.end;
		}

		// Final task (after last pause or entire session if no pauses)
		const finalTaskDuration = Math.floor((endDate.getTime() - currentStart.getTime()) / 1000);
		if (finalTaskDuration > 0) {
			tasks.push({
				taskId: `${title} - Session`,
				title,
				startTime: currentStart,
				endTime: endDate,
				duration: finalTaskDuration,
				projectId,
				projectName,
			});
		}

		// Check if record crosses midnight in user's timezone
		const crossesMidnight = crossesMidnightInTimezone(startDate, endDate, timezone);

		return {
			id: randomUUID(),
			source: 'FocusRecordSession',
			startTime: startDate,
			endTime: endDate,
			duration: actualDurationInSeconds, // Total duration minus pauses
			crossesMidnight,
			note,
			pauseDuration: pauseDurationInSeconds,
			tasks
		};
	});

	// Bulk upsert to database
	const bulkOps = normalizedRecords.map((record: any) => ({
		updateOne: {
			filter: { id: record.id },
			update: { $set: record },
			upsert: true
		}
	}));

	const result = await FocusRecordSession.bulkWrite(bulkOps);

	return {
		message: 'Session focus records synced successfully',
		recordsProcessed: normalizedRecords.length,
		upsertedCount: result.upsertedCount,
		modifiedCount: result.modifiedCount,
	};
}
