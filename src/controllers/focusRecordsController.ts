import { Request, Response } from 'express';
import { getFocusRecords, FocusRecordsQueryParams } from '../services/focusRecordsService';

/**
 * GET / - Fetch focus records with filtering, sorting, and pagination
 */
export async function getFocusRecordsHandler(req: Request, res: Response) {
	try {
		// Parse and validate query parameters
		const queryParams: FocusRecordsQueryParams = {
			page: parseInt(req.query.page as string) || 0,
			limit: parseInt(req.query.limit as string) || 25,
			projects: req.query['projects-ticktick'] as string,
			taskId: req.query['task-id'] as string,
			startDate: req.query['start-date'] as string,
			endDate: req.query['end-date'] as string,
			sortBy: req.query['sort-by'] as string || 'Newest',
			taskIdIncludeFocusRecordsFromSubtasks: req.query['task-id-include-focus-records-from-subtasks'] === 'true',
			searchQuery: req.query['search'] as string,
			focusApps: req.query['focus-apps'] as string,
		};

		// Call service to get focus records
		const result = await getFocusRecords(queryParams);

		// Return success response
		res.status(200).json(result);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching focus records.',
		});
	}
}
