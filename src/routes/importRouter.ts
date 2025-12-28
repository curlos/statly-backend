import express from 'express';
import multer from 'multer';
import { CustomRequest } from '../interfaces/CustomRequest';
import { verifyToken } from '../middleware/verifyToken';
import { detectDocumentType, ImportResult } from '../utils/import/importBackup.utils';
import { importFocusRecords } from '../utils/import/importFocusRecords.utils';
import { importProjectGroups } from '../utils/import/importProjectGroups.utils';
import { importProjects } from '../utils/import/importProjects.utils';
import { importTasks } from '../utils/import/importTasks.utils';
import { importUserSettings } from '../utils/import/importUserSettings.utils';
import { importCustomImages } from '../utils/import/importCustomImages.utils';
import { importCustomImageFolders } from '../utils/import/importCustomImageFolders.utils';
import { IFocusRecord } from '../models/FocusRecord';
import { ITask } from '../models/TaskModel';
import { IProject } from '../models/ProjectModel';
import { IProjectGroup } from '../models/ProjectGroupModel';
import { IUserSettings } from '../models/UserSettingsModel';
import { ICustomImage } from '../models/CustomImageModel';
import { ICustomImageFolder } from '../models/CustomImageFolderModel';

type ImportableDocument = IFocusRecord | ITask | IProject | IProjectGroup | IUserSettings | ICustomImage | ICustomImageFolder;

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 4 * 1024 * 1024 }, // 4MB limit (accounts for multipart overhead within Vercel's 4.5MB limit)
});

/**
 * POST /import/backup
 * Imports backup data from JSON file uploaded as binary data
 * Accepts: multipart/form-data with file field
 */
router.post('/backup', verifyToken, upload.array('fileToImport'), async (req: CustomRequest, res) => {
	try {
		const userId = req.user!.userId;

		if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
			return res.status(400).json({
				message: 'No files provided. Please upload JSON files.',
			});
		}

		// Parse JSON from all file buffers and combine documents
		const documents: ImportableDocument[] = [];
		const parseErrors: string[] = [];

		for (const file of req.files) {
			try {
				const fileContent = file.buffer.toString('utf-8');
				const parsedData = JSON.parse(fileContent);

				// Only accept chunked backup format with response array
				if (parsedData.response && Array.isArray(parsedData.response)) {
					// Chunked backup format: { fileName, apiEndpointName, chunkInfo, response: [...] }
					if (parsedData.response.length === 0) {
						parseErrors.push(`File ${file.originalname}: Contains empty response array (no documents to import)`);
					} else {
						documents.push(...parsedData.response);
					}
				} else {
					// Invalid format - skip this file
					parseErrors.push(`File ${file.originalname}: Invalid format. Expected chunked backup format with 'response' array.`);
				}
			} catch (error) {
				parseErrors.push(`File ${file.originalname}: ${error instanceof Error ? error.message : 'Parse error'}`);
			}
		}

		if (documents.length === 0) {
			return res.status(400).json({
				message: 'No documents found in files. Please upload valid backup files with documents.',
			});
		}

		// Categorize documents by type
		const focusRecords: IFocusRecord[] = [];
		const tasks: ITask[] = [];
		const projects: IProject[] = [];
		const projectGroups: IProjectGroup[] = [];
		const userSettings: IUserSettings[] = [];
		const customImages: ICustomImage[] = [];
		const customImageFolders: ICustomImageFolder[] = [];

		documents.forEach((doc, index) => {
			try {
				// Detect type using O(1) lookup
				const type = detectDocumentType(doc);

				// Categorize by type with type narrowing
				switch (type) {
					case 'focusRecord':
						focusRecords.push(doc as IFocusRecord);
						break;
					case 'task':
						tasks.push(doc as ITask);
						break;
					case 'project':
						projects.push(doc as IProject);
						break;
					case 'projectGroup':
						projectGroups.push(doc as IProjectGroup);
						break;
					case 'userSettings':
						userSettings.push(doc as IUserSettings);
						break;
					case 'customImage':
						customImages.push(doc as ICustomImage);
						break;
					case 'customImageFolder':
						customImageFolders.push(doc as ICustomImageFolder);
						break;
					default:
						parseErrors.push(`Document at index ${index}: Unknown source type: ${(doc as { source?: string }).source || 'missing'}`);
				}
			} catch (error) {
				parseErrors.push(`Document at index ${index}: ${error instanceof Error ? error.message : 'Unknown error'}`);
			}
		});

		// Import each category in parallel
		const [focusRecordsResult, tasksResult, projectsResult, projectGroupsResult, userSettingsResult, customImagesResult, customImageFoldersResult] = await Promise.all([
			importFocusRecords(focusRecords, userId),
			importTasks(tasks, userId),
			importProjects(projects, userId),
			importProjectGroups(projectGroups, userId),
			importUserSettings(userSettings, userId),
			importCustomImages(customImages, userId),
			importCustomImageFolders(customImageFolders, userId),
		]);

		// Combine results
		const result: ImportResult = {
			focusRecords: focusRecordsResult,
			tasks: tasksResult,
			projects: projectsResult,
			projectGroups: projectGroupsResult,
			userSettings: userSettingsResult,
			customImages: customImagesResult,
			customImageFolders: customImageFoldersResult,
		};

		// Calculate totals
		const totalCreated =
			focusRecordsResult.created +
			tasksResult.created +
			projectsResult.created +
			projectGroupsResult.created +
			userSettingsResult.created +
			customImagesResult.created +
			customImageFoldersResult.created;

		const totalModified =
			focusRecordsResult.modified +
			tasksResult.modified +
			projectsResult.modified +
			projectGroupsResult.modified +
			userSettingsResult.modified +
			customImagesResult.modified +
			customImageFoldersResult.modified;

		const totalMatched =
			focusRecordsResult.matched +
			tasksResult.matched +
			projectsResult.matched +
			projectGroupsResult.matched +
			userSettingsResult.matched +
			customImagesResult.matched +
			customImageFoldersResult.matched;

		const totalFailed =
			focusRecordsResult.failed + tasksResult.failed + projectsResult.failed + projectGroupsResult.failed +
			userSettingsResult.failed + customImagesResult.failed + customImageFoldersResult.failed;

		// Combine all errors
		const allErrors = [
			...parseErrors,
			...focusRecordsResult.errors,
			...tasksResult.errors,
			...projectsResult.errors,
			...projectGroupsResult.errors,
			...userSettingsResult.errors,
			...customImagesResult.errors,
			...customImageFoldersResult.errors,
		];

		res.status(200).json({
			summary: {
				totalCreated,
				totalModified,
				totalMatched,
				totalFailed,
			},
			details: result,
			errors: allErrors.length > 0 ? allErrors : undefined,
		});
	} catch (error) {
		res.status(500).json({
			error: error instanceof Error ? error.message : 'An error occurred importing backup data.',
		});
	}
});

export default router;
