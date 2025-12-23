import { Response } from 'express';
import { CustomRequest } from '../interfaces/CustomRequest';
import {
	getTodayFocusDataForAllRings,
	getStreakHistoryForAllRings,
	getCombinedStreakHistoryForAllRings
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
	} catch (error) {
		console.error('Error in getTodayFocus:', error);
		const message = error instanceof Error ? error.message : 'An error occurred';
		res.status(500).json({ error: message });
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
	} catch (error) {
		console.error('Error in getStreakHistory:', error);
		const message = error instanceof Error ? error.message : 'An error occurred';
		res.status(500).json({ error: message });
	}
}

/**
 * GET /api/streaks/combined
 * Get combined streak history for all active rings
 * A day only counts if ALL active rings meet their individual goals
 */
export async function getCombinedStreakHistory(req: CustomRequest, res: Response) {
	try {
		const userId = req.user!.userId;
		const params = parseBaseQueryParams(req);
		const result = await getCombinedStreakHistoryForAllRings(params, userId);
		res.json(result);
	} catch (error: unknown) {
		console.error('Error in getCombinedStreakHistory:', error);
		const message = error instanceof Error ? error.message : 'An unknown error occurred';
		res.status(500).json({ error: message });
	}
}
