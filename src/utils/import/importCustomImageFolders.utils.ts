import { Types } from 'mongoose';
import CustomImageFolder from '../../models/CustomImageFolderModel';
import type { ImportCategoryResult } from './importBackup.utils';
import { ImportableCustomImageFolderDocument } from '../../types/import';

/**
 * Validates a custom image folder document against required fields
 */
export function validateCustomImageFolder(
	doc: ImportableCustomImageFolderDocument,
	requiredFields: string[],
	validSourcesSet: Set<string>
): { valid: boolean; error?: string } {
	for (const field of requiredFields) {
		if (!(field in doc)) {
			return { valid: false, error: `Missing required field: ${field}` };
		}
	}

	if (!doc.source || !validSourcesSet.has(doc.source)) {
		return { valid: false, error: `Invalid source: ${doc.source || 'missing'}` };
	}

	return { valid: true };
}

/**
 * Imports custom image folders with validation
 * Uses composite key (name + userId) to prevent duplicates
 */
export async function importCustomImageFolders(
	customImageFolders: ImportableCustomImageFolderDocument[],
	userId: Types.ObjectId
): Promise<ImportCategoryResult> {
	const errors: string[] = [];

	// Validation constants
	const requiredFields = ['name', 'source'];
	const validSourcesSet = new Set(['CustomImageFolder']);

	// Handle empty input
	if (customImageFolders.length === 0) {
		return {
			created: 0,
			modified: 0,
			matched: 0,
			failed: 0,
			errors: [],
		};
	}

	// Validate and prepare documents
	const validCustomImageFolders: ImportableCustomImageFolderDocument[] = [];

	for (const folder of customImageFolders) {
		const validation = validateCustomImageFolder(folder, requiredFields, validSourcesSet);

		if (!validation.valid) {
			errors.push(`CustomImageFolder ${folder.name || 'unknown'}: ${validation.error}`);
			continue;
		}

		// Remove _id and old userId, then add the current user's userId
		const { _id, userId: _oldUserId, ...folderWithoutIds } = folder;
		validCustomImageFolders.push({ ...folderWithoutIds, userId });
	}

	// If no valid folders, return early
	if (validCustomImageFolders.length === 0) {
		return {
			created: 0,
			modified: 0,
			matched: 0,
			failed: errors.length,
			errors,
		};
	}

	// Create bulk operations using composite key (name + userId)
	const bulkOps = validCustomImageFolders.map((folder) => ({
		updateOne: {
			filter: { name: folder.name, userId },
			update: { $set: folder },
			upsert: true,
		},
	}));

	try {
		const result = await CustomImageFolder.bulkWrite(bulkOps);

		return {
			created: result.upsertedCount,
			modified: result.modifiedCount,
			matched: result.matchedCount - result.modifiedCount,
			failed: errors.length,
			errors,
		};
	} catch (error) {
		errors.push(`Bulk insert error: ${error instanceof Error ? error.message : 'Unknown error'}`);
		return {
			created: 0,
			modified: 0,
			matched: 0,
			failed: errors.length,
			errors,
		};
	}
}
