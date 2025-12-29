import { Types } from 'mongoose';
import ProjectGroupTickTick from "../../models/ProjectGroupModel";
import { ProjectTickTick, ProjectTodoist, ProjectSession } from "../../models/ProjectModel";
import { fetchSessionFocusRecordsWithNoBreaks } from "../focus.utils";
import { getOrCreateSyncMetadata, getTickTickCookie } from "../helpers.utils";
import { getAllTodoistProjects } from "../task.utils";
import { fetchAllTickTickProjects, fetchAllTickTickProjectGroups } from "../ticktick.utils";
import UserSettings from "../../models/UserSettingsModel";
import { executeBatchedBulkWrite } from "../bulkWrite.utils";

export async function syncTickTickProjects(userId: Types.ObjectId) {
	// Get or create sync metadata for projects
	const syncMetadata = await getOrCreateSyncMetadata(userId, 'tickTickProjects');

	// Get user's TickTick cookie
	const cookie = await getTickTickCookie(userId);

	const lastSyncTime = syncMetadata.lastSyncTime;
	const { projects: tickTickProjects, inboxId } = await fetchAllTickTickProjects(cookie);

	const bulkOps = [];

	for (const project of tickTickProjects) {
		// Check if project needs updating based on modifiedTime
		const projectModifiedTime = project.modifiedTime ? new Date(project.modifiedTime) : null;
		const shouldUpdateProject = !projectModifiedTime || projectModifiedTime >= lastSyncTime;

		if (shouldUpdateProject) {
			// Remove _id to prevent duplicate key errors on upsert
			const { _id, ...projectWithoutMongoDbId } = project;
			// Add project upsert operation to bulk array
			bulkOps.push({
				updateOne: {
					filter: { id: project.id, userId },
					update: { $set: { ...projectWithoutMongoDbId, userId } },
					upsert: true,
				},
			});
		}
	}

	const result = await executeBatchedBulkWrite(bulkOps, ProjectTickTick);

	// Update inboxId in user settings if it has changed
	if (inboxId) {
		await UserSettings.findOneAndUpdate(
			{ userId },
			{ tickTickInboxProjectId: inboxId },
			{ new: true }
		);
	}

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

export async function syncTickTickProjectGroups(userId: Types.ObjectId) {
	// Get or create sync metadata for project groups
	const syncMetadata = await getOrCreateSyncMetadata(userId, 'tickTickProjectGroups');

	// Get user's TickTick cookie
	const cookie = await getTickTickCookie(userId);

	const tickTickProjectGroups = await fetchAllTickTickProjectGroups(cookie);

	const bulkOps = [];

	// Always update all project groups since there's no modifiedTime
	for (const projectGroup of tickTickProjectGroups) {
		// Remove _id to prevent duplicate key errors on upsert
		const { _id, ...projectGroupWithoutMongoDbId } = projectGroup;
		bulkOps.push({
			updateOne: {
				filter: { id: projectGroup.id, userId },
				update: { $set: { ...projectGroupWithoutMongoDbId, userId, source: 'ProjectGroupTickTick' } },
				upsert: true,
			},
		});
	}

	const result = await executeBatchedBulkWrite(bulkOps, ProjectGroupTickTick);

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

export async function syncTodoistProjects(userId: Types.ObjectId) {
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
			userId,

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
				filter: { id: project.id, userId },
				update: { $set: normalizedProject },
				upsert: true,
			},
		});
	}

	const result = await executeBatchedBulkWrite(bulkOps, ProjectTodoist);

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

export async function syncSessionProjects(userId: Types.ObjectId) {
	// Get or create sync metadata for session projects
	const syncMetadata = await getOrCreateSyncMetadata(userId, 'sessionProjects');

	// Fetch raw Session focus records (includes full category data)
	const rawSessionRecords = await fetchSessionFocusRecordsWithNoBreaks();

	// Extract unique categories/projects
	const categoriesMap = new Map();

	for (const record of rawSessionRecords) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const category = record['category'] as any;

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
			userId,
		};

		bulkOps.push({
			updateOne: {
				filter: { id: category.id, userId },
				update: { $set: normalizedProject },
				upsert: true,
			},
		});
	}

	const result = await executeBatchedBulkWrite(bulkOps, ProjectSession);

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