import { Request, Response } from 'express';
import { getFocusHoursMedals, getCompletedTasksMedals } from '../services/medalsService';
import { parseMedalsQueryParams } from '../utils/queryParams.utils';

/**
 * GET /documents/focus-records/medals - Fetch focus hours medals with filtering
 */
export async function getFocusMedalsHandler(req: Request, res: Response) {
	try {
		const queryParams = parseMedalsQueryParams(req, 'focus');

		if ('error' in queryParams) {
			return res.status(400).json({ message: queryParams.error });
		}

		const result = await getFocusHoursMedals(queryParams);
		res.status(200).json(result);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching focus medals.',
		});
	}
}

/**
 * GET /documents/tasks/medals - Fetch completed tasks medals with filtering
 */
export async function getTasksMedalsHandler(req: Request, res: Response) {
	try {
		const queryParams = parseMedalsQueryParams(req, 'tasks');

		if ('error' in queryParams) {
			return res.status(400).json({ message: queryParams.error });
		}

		const result = await getCompletedTasksMedals(queryParams);
		res.status(200).json(result);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching tasks medals.',
		});
	}
}
