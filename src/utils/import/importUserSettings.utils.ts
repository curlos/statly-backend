import { Types } from 'mongoose';
import UserSettings from '../../models/UserSettingsModel';
import type { ImportCategoryResult } from './importBackup.utils';
import { ImportableUserSettingsDocument } from '../../types/import';

/**
 * Validates a user settings document against required fields
 */
export function validateUserSettings(
	doc: ImportableUserSettingsDocument,
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
 * Imports user settings with validation
 * Only one user settings document per user - uses merge strategy
 */
export async function importUserSettings(
	userSettingsList: ImportableUserSettingsDocument[],
	userId: Types.ObjectId
): Promise<ImportCategoryResult> {
	const errors: string[] = [];

	// Validation constants
	const requiredFields = ['source'];
	const validSourcesSet = new Set(['UserSettings']);

	// Handle empty input
	if (userSettingsList.length === 0) {
		return {
			created: 0,
			modified: 0,
			matched: 0,
			failed: 0,
			errors: [],
		};
	}

	// Warn if multiple settings in backup
	if (userSettingsList.length > 1) {
		errors.push(
			`Warning: Found ${userSettingsList.length} user settings documents in backup. Only the first one will be imported.`
		);
	}

	// Use only the first settings document
	const userSettings = userSettingsList[0];

	// Validate
	const validation = validateUserSettings(userSettings, requiredFields, validSourcesSet);

	if (!validation.valid) {
		errors.push(`UserSettings: ${validation.error}`);
		return {
			created: 0,
			modified: 0,
			matched: 0,
			failed: 1,
			errors,
		};
	}

	try {
		// Remove _id and old userId, then add the current user's userId
		const { _id, userId: _oldUserId, ...settingsWithoutIds } = userSettings;

		// Use findOneAndUpdate with upsert for merge behavior
		// This will update existing settings or create new ones
		const result = await UserSettings.findOneAndUpdate(
			{ userId },
			{ $set: { ...settingsWithoutIds, userId } },
			{ upsert: true, new: true, runValidators: true }
		);

		// Determine if this was a create or update
		// If result exists and has _id, check if it was just created
		const wasCreated = result && result.isNew === true;

		return {
			created: wasCreated ? 1 : 0,
			modified: wasCreated ? 0 : 1,
			matched: 0,
			failed: 0,
			errors,
		};
	} catch (error) {
		errors.push(`Import error: ${error instanceof Error ? error.message : 'Unknown error'}`);
		return {
			created: 0,
			modified: 0,
			matched: 0,
			failed: 1,
			errors,
		};
	}
}
