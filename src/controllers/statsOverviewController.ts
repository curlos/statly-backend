import { Request, Response } from 'express';
import { getOverviewStats } from '../services/statsOverviewService';
import { getFocusRecordsStats } from '../services/statsFocusService';
import { parseBaseQueryParams } from '../utils/queryParams.utils';

/**
 * GET /stats/overview - Fetch overview statistics
 */
export async function getOverviewStatsHandler(req: Request, res: Response) {
	try {
		// Call service to get overview stats
		const result = await getOverviewStats();

		// Return success response
		res.status(200).json(result);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching overview stats.',
		});
	}
}

/**
 * GET /stats/focus - Fetch aggregated focus records stats
 */
export async function getStatsFocusHandler(req: Request, res: Response) {
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
