import { Response } from 'express';
import { CustomRequest } from '../interfaces/CustomRequest';
import { getOverviewStats, getSourceCounts } from '../services/statsOverviewService';
import { getFocusRecordsStats } from '../services/statsFocusService';
import { getCompletedTasksStats } from '../services/statsTaskService';
import { parseBaseQueryParams } from '../utils/queryParams.utils';

/**
 * GET /stats/overview - Fetch overview statistics
 */
export async function getOverviewStatsHandler(req: CustomRequest, res: Response) {
	try {
		// Extract userId from JWT
		const userId = req.user!.userId;

		// Parse base query parameters (filters)
		const baseParams = parseBaseQueryParams(req);

		// Parse additional overview-specific params
		const skipTodayStats = req.query.skipTodayStats === 'true';
		const includeFirstData = req.query.includeFirstData === 'true';

		// Call service to get overview stats with filters
		const result = await getOverviewStats(
			{
				...baseParams,
				skipTodayStats,
				includeFirstData
			},
			userId
		);

		// Return success response
		res.status(200).json(result);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching overview stats.',
		});
	}
}

/**
 * GET /stats/focus - Fetch aggregated focus records stats
 */
export async function getStatsFocusHandler(req: CustomRequest, res: Response) {
	try {
		// Parse base query parameters (filters)
		const baseParams = parseBaseQueryParams(req);

		// Get group-by parameter
		const groupBy = req.query['group-by'] as string;
		if (!groupBy) {
			return res.status(400).json({ message: 'Missing required parameter: group-by' });
		}

		// Validate group-by parameter
		const validGroupByValues = ['day', 'week', 'month', 'project', 'task', 'emotion', 'hour', 'timeline', 'year', 'record'];
		if (!validGroupByValues.includes(groupBy)) {
			return res.status(400).json({
				message: `Invalid group-by parameter. Must be one of: ${validGroupByValues.join(', ')}`
			});
		}

		// Get nested parameter
		const nested = req.query.nested === 'true';

		// Extract userId from JWT
		const userId = req.user!.userId;

		// Call service to get aggregated stats
		const result = await getFocusRecordsStats(
			{
				...baseParams,
				groupBy,
				nested
			},
			userId
		);

		// Return success response
		res.status(200).json(result);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching focus records stats.',
		});
	}
}

/**
 * GET /stats/tasks - Fetch aggregated completed tasks stats
 */
export async function getStatsTasksHandler(req: CustomRequest, res: Response) {
	try {
		// Parse base query parameters (filters)
		const baseParams = parseBaseQueryParams(req);

		// Get group-by parameter
		const groupBy = req.query['group-by'] as string;
		if (!groupBy) {
			return res.status(400).json({ message: 'Missing required parameter: group-by' });
		}

		// Validate group-by parameter
		const validGroupByValues = ['day', 'week', 'month', 'year', 'project', 'task'];
		if (!validGroupByValues.includes(groupBy)) {
			return res.status(400).json({
				message: `Invalid group-by parameter. Must be one of: ${validGroupByValues.join(', ')}`
			});
		}

		// Get nested parameter
		const nested = req.query.nested === 'true';

		// Extract userId from JWT
		const userId = req.user!.userId;

		// Call service to get aggregated stats
		const result = await getCompletedTasksStats(
			{
				projectIds: baseParams.projectIds,
				taskId: baseParams.taskId,
				startDate: baseParams.startDate,
				endDate: baseParams.endDate,
				intervalStartDate: baseParams.intervalStartDate,
				intervalEndDate: baseParams.intervalEndDate,
				taskIdIncludeSubtasks: baseParams.taskIdIncludeFocusRecordsFromSubtasks,
				searchQuery: baseParams.searchQuery,
				toDoListAppSources: baseParams.toDoListAppSources,
				timezone: baseParams.timezone,
				yearAgnostic: baseParams.yearAgnostic,
				groupBy,
				nested
			},
			userId
		);

		// Return success response
		res.status(200).json(result);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching completed tasks stats.',
		});
	}
}

/**
 * GET /stats/source-counts - Fetch counts by source for focus records and tasks
 */
export async function getSourceCountsHandler(req: CustomRequest, res: Response) {
	try {
		const userId = req.user!.userId;
		const result = await getSourceCounts(userId);
		res.status(200).json(result);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching source counts.',
		});
	}
}
