import { Response } from 'express';
import { CustomRequest } from '../interfaces/CustomRequest';
import { getStreakHistory as getStreakHistoryService, getTodayFocusData as getTodayFocusDataService } from '../services/streaksService';
import { parseBaseQueryParams } from '../utils/queryParams.utils';

/**
 * GET /api/streaks/today
 * Get today's focus hours only (fast endpoint)
 */
export async function getTodayFocus(req: CustomRequest, res: Response) {
	try {
		const userId = req.user!.userId;
		const params = parseBaseQueryParams(req);
		const result = await getTodayFocusDataService(params, userId);
		res.json(result);
	} catch (error: any) {
		console.error('Error in getTodayFocus:', error);
		res.status(500).json({ error: error.message });
	}
}

/**
 * GET /api/streaks/history
 * Calculate full streak history (current + longest streaks)
 */
export async function getStreakHistory(req: CustomRequest, res: Response) {
	try {
		const userId = req.user!.userId;
		const params = parseBaseQueryParams(req);
		const result = await getStreakHistoryService(params, userId);
		res.json(result);
	} catch (error: any) {
		console.error('Error in getStreakHistory:', error);
		res.status(500).json({ error: error.message });
	}
}
