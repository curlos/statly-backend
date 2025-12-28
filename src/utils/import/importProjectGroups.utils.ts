import { Types } from 'mongoose';
import ProjectGroupTickTick from "../../models/ProjectGroupModel";
import type { ImportCategoryResult } from "./importBackup.utils";
import { ImportableProjectGroupDocument } from '../../types/import';

/**
 * Validates a project group document against required fields
 */
export function validateProjectGroup(doc: ImportableProjectGroupDocument, requiredFields: string[]): { valid: boolean; error?: string } {
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
export async function importProjectGroups(projectGroups: ImportableProjectGroupDocument[], userId: Types.ObjectId): Promise<ImportCategoryResult> {
	const errors: string[] = [];

	// Declare validation constants once for all project groups
	const requiredFields = ['id', 'name'];

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const bulkOps: Array<any> = [];

	for (const group of projectGroups) {
		const validation = validateProjectGroup(group, requiredFields);

		if (!validation.valid) {
			errors.push(`Project group ${group.id || 'unknown'}: ${validation.error}`);
			continue;
		}

		// Remove _id and old userId, then add the current user's userId
		const { _id, userId: _oldUserId, ...groupWithoutIds } = group;

		bulkOps.push({
			updateOne: {
				filter: { id: groupWithoutIds.id, userId },
				update: { $set: { ...groupWithoutIds, userId } },
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