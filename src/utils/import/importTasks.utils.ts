import { Types } from 'mongoose';
import { TaskTickTick, TaskTodoist } from "../../models/TaskModel";
import type { ImportCategoryResult } from "./importBackup.utils";

/**
 * Validates a task document against required fields
 */
export function validateTask(doc: any, requiredFields: string[], validSourcesSet: Set<string>): { valid: boolean; error?: string } {
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
export async function importTasks(tasks: any[], userId: Types.ObjectId): Promise<ImportCategoryResult> {
	const errors: string[] = [];

	// Declare validation constants once for all tasks
	const requiredFields = ['id', 'source', 'title'];
	const validSourcesSet = new Set(['TaskTickTick', 'TaskTodoist']);

	// Group tasks by source to use the correct discriminator model
	const tasksBySource: Record<string, any[]> = {
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
			// Remove _id to allow MongoDB to generate new unique IDs for each user
			const { _id, ...taskWithoutMongoDbId } = task;
			tasksBySource[source].push({ ...taskWithoutMongoDbId, userId });
		} else {
			errors.push(`Task ${task.id}: Unknown source ${source}`);
		}
	}

	// Map source names to their corresponding discriminator models
	const modelMap: Record<string, any> = {
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