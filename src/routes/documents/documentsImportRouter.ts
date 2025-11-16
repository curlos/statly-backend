import express from 'express';
import multer from 'multer';
import { CustomRequest } from '../../interfaces/CustomRequest';
import { verifyToken } from '../../middleware/verifyToken';
import {
	detectDocumentType,
	ImportResult,
} from '../../utils/import/importBackup.utils';
import { importFocusRecords } from '../../utils/import/importFocusRecords.utils';
import { importProjectGroups } from '../../utils/import/importProjectGroups.utils';
import { importProjects } from '../../utils/import/importProjects.utils';
import { importTasks } from '../../utils/import/importTasks.utils';

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 4 * 1024 * 1024 }, // 4MB limit (accounts for multipart overhead within Vercel's 4.5MB limit)
});

/**
 * POST /documents/import/backup
 * Imports backup data from JSON file uploaded as binary data
 * Accepts: multipart/form-data with file field
 */
router.post('/backup', verifyToken, upload.array('fileToImport'), async (req: CustomRequest, res) => {
	try {
		if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
			return res.status(400).json({
				message: 'No files provided. Please upload JSON files.',
			});
		}

		// Parse JSON from all file buffers and combine documents
		let documents: any[] = [];
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
		const focusRecords: any[] = [];
		const tasks: any[] = [];
		const projects: any[] = [];
		const projectGroups: any[] = [];

		documents.forEach((doc, index) => {
			try {
				// Detect type using O(1) lookup
				const type = detectDocumentType(doc);

				// Categorize by type
				switch (type) {
					case 'focusRecord':
						focusRecords.push(doc);
						break;
					case 'task':
						tasks.push(doc);
						break;
					case 'project':
						projects.push(doc);
						break;
					case 'projectGroup':
						projectGroups.push(doc);
						break;
					default:
						parseErrors.push(`Document at index ${index}: Unknown source type: ${doc.source || 'missing'}`);
				}
			} catch (error) {
				parseErrors.push(`Document at index ${index}: ${error instanceof Error ? error.message : 'Unknown error'}`);
			}
		});

		// Import each category in parallel
		const [focusRecordsResult, tasksResult, projectsResult, projectGroupsResult] = await Promise.all([
			importFocusRecords(focusRecords),
			importTasks(tasks),
			importProjects(projects),
			importProjectGroups(projectGroups),
		]);

		// Combine results
		const result: ImportResult = {
			focusRecords: focusRecordsResult,
			tasks: tasksResult,
			projects: projectsResult,
			projectGroups: projectGroupsResult,
		};

		// Calculate totals
		const totalCreated =
			focusRecordsResult.created +
			tasksResult.created +
			projectsResult.created +
			projectGroupsResult.created;

		const totalModified =
			focusRecordsResult.modified +
			tasksResult.modified +
			projectsResult.modified +
			projectGroupsResult.modified;

		const totalMatched =
			focusRecordsResult.matched +
			tasksResult.matched +
			projectsResult.matched +
			projectGroupsResult.matched;

		const totalFailed =
			focusRecordsResult.failed + tasksResult.failed + projectsResult.failed + projectGroupsResult.failed;

		// Combine all errors
		const allErrors = [
			...parseErrors,
			...focusRecordsResult.errors,
			...tasksResult.errors,
			...projectsResult.errors,
			...projectGroupsResult.errors,
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
