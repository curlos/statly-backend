import ProjectGroupTickTick from "../../models/projectGroupModel";
import { ProjectTickTick, ProjectTodoist, ProjectSession } from "../../models/projectModel";
import { fetchSessionFocusRecordsWithNoBreaks } from "../focus.utils";
import { getOrCreateSyncMetadata } from "../helpers.utils";
import { getAllTodoistProjects } from "../task.utils";
import { fetchAllTickTickProjects, fetchAllTickTickProjectGroups } from "../ticktick.utils";

export async function syncTickTickProjects(userId: string) {
	// Get or create sync metadata for projects
	const syncMetadata = await getOrCreateSyncMetadata(userId, 'tickTickProjects');

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
	const syncMetadata = await getOrCreateSyncMetadata(userId, 'tickTickProjectGroups');

	const tickTickProjectGroups = await fetchAllTickTickProjectGroups();

	const bulkOps = [];

	// Always update all project groups since there's no modifiedTime
	for (const projectGroup of tickTickProjectGroups) {
		bulkOps.push({
			updateOne: {
				filter: { id: projectGroup.id },
				update: { $set: { ...projectGroup, source: 'ProjectGroupTickTick' } },
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
	const syncMetadata = await getOrCreateSyncMetadata(userId, 'todoistProjects');

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

export async function syncSessionProjects(userId: string) {
	// Get or create sync metadata for session projects
	const syncMetadata = await getOrCreateSyncMetadata(userId, 'sessionProjects');

	// Fetch raw Session focus records (includes full category data)
	const rawSessionRecords = await fetchSessionFocusRecordsWithNoBreaks();

	// Extract unique categories/projects
	const categoriesMap = new Map();

	for (const record of rawSessionRecords) {
		const category = record['category'];

		if (category) {
			const categoryId = category['id'] || 'general-session';
			const categoryTitle = category['title'] || 'General';
			const hexColor = category['hex_color'] || '';

			// Skip if already processed
			if (!categoriesMap.has(categoryId)) {
				categoriesMap.set(categoryId, {
					id: categoryId === '' ? 'general-session' : categoryId,
					name: categoryTitle,
					color: hexColor,
				});
			}
		}
	}

	// Convert map to array and prepare bulk operations
	const uniqueCategories = Array.from(categoriesMap.values());
	const bulkOps = [];

	for (const category of uniqueCategories) {
		const normalizedProject = {
			id: category.id,
			source: 'ProjectSession',
			name: category.name,
			color: category.color,
		};

		bulkOps.push({
			updateOne: {
				filter: { id: category.id },
				update: { $set: normalizedProject },
				upsert: true,
			},
		});
	}

	// Execute all operations in a single bulkWrite
	const result = bulkOps.length > 0
		? await ProjectSession.bulkWrite(bulkOps)
		: { upsertedCount: 0, modifiedCount: 0, matchedCount: 0 };

	// Update sync metadata with current time
	syncMetadata.lastSyncTime = new Date();
	await syncMetadata.save();

	return {
		message: 'Session projects synced successfully',
		recordsProcessed: uniqueCategories.length,
		upsertedCount: result.upsertedCount,
		modifiedCount: result.modifiedCount,
		matchedCount: result.matchedCount,
		lastSyncTime: syncMetadata.lastSyncTime,
	};
}