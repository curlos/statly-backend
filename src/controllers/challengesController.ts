import { Response } from 'express';
import { CustomRequest } from '../interfaces/CustomRequest';
import { getFocusHoursChallenges, getCompletedTasksChallenges } from '../services/challengesService';
import { parseChallengesQueryParams } from '../utils/queryParams.utils';

export async function getFocusChallengesHandler(req: CustomRequest, res: Response) {
	try {
		const queryParams = parseChallengesQueryParams(req);
		const userId = req.user!.userId;
		const challenges = await getFocusHoursChallenges(queryParams, userId);

		res.status(200).json(challenges);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching focus challenges.',
		});
	}
}

export async function getTasksChallengesHandler(req: CustomRequest, res: Response) {
	try {
		const queryParams = parseChallengesQueryParams(req);
		const userId = req.user!.userId;
		const challenges = await getCompletedTasksChallenges(queryParams, userId);

		res.status(200).json(challenges);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching task challenges.',
		});
	}
}
