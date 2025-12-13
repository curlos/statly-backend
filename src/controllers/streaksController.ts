import { Response } from 'express';
import { CustomRequest } from '../interfaces/CustomRequest';
import {
	getTodayFocusDataForAllRings,
	getStreakHistoryForAllRings
} from '../services/streaksService';
import { parseBaseQueryParams } from '../utils/queryParams.utils';

/**
 * GET /api/streaks/today
 * Get today's focus hours for all active rings
 */
export async function getTodayFocus(req: CustomRequest, res: Response) {
	try {
		const userId = req.user!.userId;
		const params = parseBaseQueryParams(req);
		const result = await getTodayFocusDataForAllRings(params, userId);
		res.json(result);
	} catch (error: any) {
		console.error('Error in getTodayFocus:', error);
		res.status(500).json({ error: error.message });
	}
}

/**
 * GET /api/streaks/history
 * Get streak history for all active rings
 */
export async function getStreakHistory(req: CustomRequest, res: Response) {
	try {
		const userId = req.user!.userId;
		const params = parseBaseQueryParams(req);
		const result = await getStreakHistoryForAllRings(params, userId);
		res.json(result);
	} catch (error: any) {
		console.error('Error in getStreakHistory:', error);
		res.status(500).json({ error: error.message });
	}
}
