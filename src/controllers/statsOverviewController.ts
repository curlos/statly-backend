import { Request, Response } from 'express';
import { getOverviewStats } from '../services/statsOverviewService';

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
