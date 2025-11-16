import ProjectGroupTickTick from "../../models/projectGroupModel";
import type { ImportCategoryResult } from "./importBackup.utils";

/**
 * Validates a project group document against required fields
 */
export function validateProjectGroup(doc: any, requiredFields: string[]): { valid: boolean; error?: string } {
	for (const field of requiredFields) {
		if (!(field in doc)) {
			return { valid: false, error: `Missing required field: ${field}` };
		}
	}

	return { valid: true };
}

/**
 * Imports project groups with validation
 */
export async function importProjectGroups(projectGroups: any[]): Promise<ImportCategoryResult> {
	const errors: string[] = [];

	// Declare validation constants once for all project groups
	const requiredFields = ['id', 'name'];

	const bulkOps: any[] = [];

	for (const group of projectGroups) {
		const validation = validateProjectGroup(group, requiredFields);

		if (!validation.valid) {
			errors.push(`Project group ${group.id || 'unknown'}: ${validation.error}`);
			continue;
		}

		bulkOps.push({
			updateOne: {
				filter: { id: group.id },
				update: { $set: group },
				upsert: true,
			},
		});
	}

	let created = 0;
	let modified = 0;
	let matched = 0;

	if (bulkOps.length > 0) {
		try {
			const result = await ProjectGroupTickTick.bulkWrite(bulkOps);
			created = result.upsertedCount;
			modified = result.modifiedCount;
			matched = result.matchedCount - result.modifiedCount;
		} catch (error) {
			errors.push(`Bulk insert error for project groups: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}

	return {
		created,
		modified,
		matched,
		failed: errors.length,
		errors,
	};
}