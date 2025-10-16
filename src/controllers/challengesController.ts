import { Request, Response } from 'express';
import { getFocusHoursChallenges, getCompletedTasksChallenges } from '../services/challengesService';

export async function getFocusChallengesHandler(req: Request, res: Response) {
	try {
		const projects = req.query.projects as string;
		const categories = req.query.categories as string;
		const taskId = req.query['task-id'] as string;
		const startDate = req.query['start-date'] as string;
		const endDate = req.query['end-date'] as string;
		const taskIdIncludeFocusRecordsFromSubtasks = req.query['task-id-include-focus-records-from-subtasks'] === 'true';
		const searchQuery = req.query['search'] as string;
		const focusApps = req.query['focus-apps'] as string;
		const toDoListApps = req.query['to-do-list-apps'] as string;
		const timezone = (req.query.timezone as string) || 'UTC';

		const challenges = await getFocusHoursChallenges({
			projects,
			categories,
			taskId,
			startDate,
			endDate,
			taskIdIncludeFocusRecordsFromSubtasks,
			searchQuery,
			focusApps,
			toDoListApps,
			timezone,
		});

		res.status(200).json(challenges);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching focus challenges.',
		});
	}
}

export async function getTasksChallengesHandler(req: Request, res: Response) {
	try {
		const projects = req.query.projects as string;
		const categories = req.query.categories as string;
		const taskId = req.query['task-id'] as string;
		const startDate = req.query['start-date'] as string;
		const endDate = req.query['end-date'] as string;
		const taskIdIncludeFocusRecordsFromSubtasks = req.query['task-id-include-focus-records-from-subtasks'] === 'true';
		const searchQuery = req.query['search'] as string;
		const toDoListApps = req.query['to-do-list-apps'] as string;
		const timezone = (req.query.timezone as string) || 'UTC';

		const challenges = await getCompletedTasksChallenges({
			projects,
			categories,
			taskId,
			startDate,
			endDate,
			taskIdIncludeFocusRecordsFromSubtasks,
			searchQuery,
			toDoListApps,
			timezone,
		});

		res.status(200).json(challenges);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching task challenges.',
		});
	}
}
