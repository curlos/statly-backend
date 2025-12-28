import { Types } from 'mongoose';
import CustomImage from '../../models/CustomImageModel';
import type { ImportCategoryResult } from './importBackup.utils';
import { ImportableCustomImageDocument } from '../../types/import';

/**
 * Validates a custom image document against required fields
 */
export function validateCustomImage(
	doc: ImportableCustomImageDocument,
	requiredFields: string[],
	validSourcesSet: Set<string>
): { valid: boolean; error?: string } {
	for (const field of requiredFields) {
		if (!(field in doc)) {
			return { valid: false, error: `Missing required field: ${field}` };
		}
	}

	if (!validSourcesSet.has(doc.source)) {
		return { valid: false, error: `Invalid source: ${doc.source}` };
	}

	return { valid: true };
}

/**
 * Imports custom images with validation
 * Uses composite key (imageUrl + userId + folder) to prevent duplicates
 */
export async function importCustomImages(
	customImages: ImportableCustomImageDocument[],
	userId: Types.ObjectId
): Promise<ImportCategoryResult> {
	const errors: string[] = [];

	// Validation constants
	const requiredFields = ['imageUrl', 'cloudinaryPublicId', 'folder', 'source'];
	const validSourcesSet = new Set(['CustomImage']);

	// Handle empty input
	if (customImages.length === 0) {
		return {
			created: 0,
			modified: 0,
			matched: 0,
			failed: 0,
			errors: [],
		};
	}

	// Validate and prepare documents
	const validCustomImages: ImportableCustomImageDocument[] = [];

	for (const customImage of customImages) {
		const validation = validateCustomImage(customImage, requiredFields, validSourcesSet);

		if (!validation.valid) {
			errors.push(`CustomImage ${customImage.imageUrl || 'unknown'}: ${validation.error}`);
			continue;
		}

		// Remove _id and old userId, then add the current user's userId
		const { _id, userId: _oldUserId, ...imageWithoutIds } = customImage;
		validCustomImages.push({ ...imageWithoutIds, userId });
	}

	// If no valid images, return early
	if (validCustomImages.length === 0) {
		return {
			created: 0,
			modified: 0,
			matched: 0,
			failed: errors.length,
			errors,
		};
	}

	// Create bulk operations using composite key (imageUrl + userId + folder)
	const bulkOps = validCustomImages.map((image) => ({
		updateOne: {
			filter: { imageUrl: image.imageUrl, userId, folder: image.folder },
			update: { $set: image },
			upsert: true,
		},
	}));

	try {
		const result = await CustomImage.bulkWrite(bulkOps);

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
