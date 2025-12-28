import { Types, Model } from 'mongoose';
import { TaskTickTick, TaskTodoist } from "../../models/TaskModel";
import type { ImportCategoryResult } from "./importBackup.utils";
import { ImportableTaskDocument } from '../../types/import';

/**
 * Validates a task document against required fields
 */
export function validateTask(doc: ImportableTaskDocument, requiredFields: string[], validSourcesSet: Set<string>): { valid: boolean; error?: string } {
	for (const field of requiredFields) {
		if (!(field in doc)) {
			return { valid: false, error: `Missing required field: ${field}` };
		}
	}

	if (!validSourcesSet.has(doc.source)) {
		return { valid: false, error: `Invalid source: ${doc.source}` };
	}

	// Validate ancestorIds is an array if presentsure
	if (doc.ancestorIds && !Array.isArray(doc.ancestorIds)) {
		return { valid: false, error: 'ancestorIds must be an array' };
	}

	return { valid: true };
}

/**
 * Imports tasks with validation
 */
export async function importTasks(tasks: ImportableTaskDocument[], userId: Types.ObjectId): Promise<ImportCategoryResult> {
	const errors: string[] = [];

	// Declare validation constants once for all tasks
	const requiredFields = ['id', 'source', 'title'];
	const validSourcesSet = new Set(['TaskTickTick', 'TaskTodoist']);

	// Group tasks by source to use the correct discriminator model
	const tasksBySource: Record<string, ImportableTaskDocument[]> = {
		TaskTickTick: [],
		TaskTodoist: [],
	};

	// Validate and categorize tasks
	for (const task of tasks) {
		const validation = validateTask(task, requiredFields, validSourcesSet);

		if (!validation.valid) {
			errors.push(`Task ${task.id || 'unknown'}: ${validation.error}`);
			continue;
		}

		const source = task.source;
		if (tasksBySource[source]) {
			// Remove _id and old userId, then add the current user's userId
			const { _id, userId: _oldUserId, ...taskWithoutIds } = task;
			tasksBySource[source].push({ ...taskWithoutIds, userId });
		} else {
			errors.push(`Task ${task.id}: Unknown source ${source}`);
		}
	}

	// Map source names to their corresponding discriminator models
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const modelMap: Record<string, Model<any>> = {
		TaskTickTick,
		TaskTodoist,
	};

	let totalCreated = 0;
	let totalModified = 0;
	let totalMatched = 0;

	// Import each source separately using the correct discriminator model
	for (const [source, sourceTasks] of Object.entries(tasksBySource)) {
		if (sourceTasks.length === 0) continue;

		const bulkOps = sourceTasks.map(task => ({
			updateOne: {
				filter: { id: task.id, userId },
				update: { $set: task },
				upsert: true,
			},
		}));

		try {
			const model = modelMap[source];
			const result = await model.bulkWrite(bulkOps);
			totalCreated += result.upsertedCount;
			totalModified += result.modifiedCount;
			totalMatched += result.matchedCount - result.modifiedCount;
		} catch (error) {
			errors.push(`Bulk insert error for ${source}: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}

	return {
		created: totalCreated,
		modified: totalModified,
		matched: totalMatched,
		failed: errors.length,
		errors,
	};
}