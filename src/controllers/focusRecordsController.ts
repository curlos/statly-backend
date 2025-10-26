import { Request, Response } from 'express';
import { getFocusRecords } from '../services/focusRecordsService';
import { getFocusRecordsStats } from '../services/statsFocusService';
import { parseFocusRecordsQueryParams } from '../utils/queryParams.utils';
import { parseBaseQueryParams } from '../utils/queryParams.utils';

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
 * GET /stats - Fetch aggregated focus records stats
 */
export async function getFocusRecordsStatsHandler(req: Request, res: Response) {
	try {
		// Parse base query parameters (filters)
		const baseParams = parseBaseQueryParams(req);

		// Get group-by parameter
		const groupBy = req.query['group-by'] as string;
		if (!groupBy) {
			return res.status(400).json({ message: 'Missing required parameter: group-by' });
		}

		// Validate group-by parameter
		const validGroupByValues = ['day', 'week', 'month', 'project', 'task', 'hour', 'timeline'];
		if (!validGroupByValues.includes(groupBy)) {
			return res.status(400).json({
				message: `Invalid group-by parameter. Must be one of: ${validGroupByValues.join(', ')}`
			});
		}

		// Get nested parameter
		const nested = req.query.nested === 'true';

		// Call service to get aggregated stats
		const result = await getFocusRecordsStats({
			...baseParams,
			groupBy,
			nested
		});

		// Return success response
		res.status(200).json(result);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching focus records stats.',
		});
	}
}
