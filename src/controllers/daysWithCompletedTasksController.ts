import { Request, Response } from 'express';
import { getDaysWithCompletedTasks } from '../services/daysWithCompletedTasksService';
import { parseDaysWithCompletedTasksQueryParams } from '../utils/queryParams.utils';

/**
 * GET /days-with-completed-tasks - Returns completed tasks grouped by date with pagination
 */
export async function getDaysWithCompletedTasksHandler(req: Request, res: Response) {
	try {
		// Parse query parameters
		const queryParams = parseDaysWithCompletedTasksQueryParams(req);

		// Call service to get days with completed tasks
		const result = await getDaysWithCompletedTasks(queryParams);

		// Return success response
		res.status(200).json(result);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching days with completed tasks.',
		});
	}
}
