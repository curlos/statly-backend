import { Request, Response } from 'express';
import { getFocusRecords, exportFocusRecords } from '../services/focusRecordsService';
import { parseFocusRecordsQueryParams, parseExportFocusRecordsQueryParams } from '../utils/queryParams.utils';

/**
 * GET / - Fetch focus records with filtering, sorting, and pagination
 */
export async function getFocusRecordsHandler(req: Request, res: Response) {
	try {
		// Parse query parameters
		const queryParams = parseFocusRecordsQueryParams(req);

		// Call service to get focus records
		const result = await getFocusRecords(queryParams);

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
export async function exportFocusRecordsHandler(req: Request, res: Response) {
	try {
		// Parse query parameters
		const queryParams = await parseExportFocusRecordsQueryParams(req);

		// Call service to export focus records
		const result = await exportFocusRecords(queryParams);

		// Return success response
		res.status(200).json(result);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred exporting focus records.',
		});
	}
}
