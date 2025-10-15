import { Request, Response } from 'express';
import { getFocusHoursMedals, getCompletedTasksMedals, MedalsQueryParams } from '../services/medalsService';

/**
 * Helper function to parse and validate medals query parameters
 */
function parseMedalsQueryParams(req: Request, type: 'focus' | 'tasks'): MedalsQueryParams | { error: string } {
	// Combine projects from both TickTick and Todoist
	const ticktickProjects = req.query['projects-ticktick'] as string || '';
	const todoistProjects = req.query['projects-todoist'] as string || '';
	const allProjects = [ticktickProjects, todoistProjects]
		.filter(p => p && p.trim())
		.join(',');

	const queryParams: MedalsQueryParams = {
		projects: allProjects,
		categories: req.query['categories'] as string,
		taskId: req.query['task-id'] as string,
		startDate: req.query['start-date'] as string,
		endDate: req.query['end-date'] as string,
		taskIdIncludeFocusRecordsFromSubtasks: req.query['task-id-include-focus-records-from-subtasks'] === 'true',
		searchQuery: req.query['search'] as string,
		focusApps: req.query['focus-apps'] as string,
		timezone: (req.query.timezone as string) || 'UTC',
		type,
		interval: (req.query['interval'] as 'daily' | 'weekly' | 'monthly' | 'yearly') || 'daily',
	};

	// Validate interval parameter
	if (!['daily', 'weekly', 'monthly', 'yearly'].includes(queryParams.interval)) {
		return { error: 'Invalid interval parameter. Must be "daily", "weekly", "monthly", or "yearly".' };
	}

	return queryParams;
}

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
