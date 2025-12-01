import { Response } from 'express';
import { CustomRequest } from '../interfaces/CustomRequest';
import { getFocusRecords, exportFocusRecords } from '../services/focusRecordsService';
import { parseFocusRecordsQueryParams, parseExportFocusRecordsQueryParams } from '../utils/queryParams.utils';

/**
 * GET / - Fetch focus records with filtering, sorting, and pagination
 */
export async function getFocusRecordsHandler(req: CustomRequest, res: Response) {
	try {
		// Parse query parameters
		const queryParams = parseFocusRecordsQueryParams(req);

		// Extract userId from JWT
		const userId = req.user!.userId;

		// Call service to get focus records
		const result = await getFocusRecords(queryParams, userId);

		// Return success response
		res.status(200).json(result);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching focus records.',
		});
	}
}

/**
 * GET /export - Export focus records with optional grouping
 */
export async function exportFocusRecordsHandler(req: CustomRequest, res: Response) {
	try {
		// Parse query parameters
		const queryParams = await parseExportFocusRecordsQueryParams(req);

		// Extract userId from JWT
		const userId = req.user!.userId;

		// Call service to export focus records
		const result = await exportFocusRecords(queryParams, userId);

		// Return success response
		res.status(200).json(result);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred exporting focus records.',
		});
	}
}
