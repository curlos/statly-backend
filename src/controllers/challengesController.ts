import { Request, Response } from 'express';
import { getFocusHoursChallenges, getCompletedTasksChallenges } from '../services/challengesService';
import { parseChallengesQueryParams } from '../utils/queryParams.utils';

export async function getFocusChallengesHandler(req: Request, res: Response) {
	try {
		const queryParams = parseChallengesQueryParams(req);
		const challenges = await getFocusHoursChallenges(queryParams);

		res.status(200).json(challenges);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching focus challenges.',
		});
	}
}

export async function getTasksChallengesHandler(req: Request, res: Response) {
	try {
		const queryParams = parseChallengesQueryParams(req);
		const challenges = await getCompletedTasksChallenges(queryParams);

		res.status(200).json(challenges);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching task challenges.',
		});
	}
}
