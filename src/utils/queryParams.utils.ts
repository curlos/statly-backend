import { Request } from 'express';

// ============================================================================
// Shared Query Params Types
// ============================================================================

export interface BaseQueryParams {
	projects?: string;
	categories?: string;
	taskId?: string;
	startDate?: string;
	endDate?: string;
	taskIdIncludeFocusRecordsFromSubtasks: boolean;
	searchQuery?: string;
	focusApps?: string;
	toDoListApps?: string;
	timezone: string;
}

export interface MedalsQueryParams extends BaseQueryParams {
	type: 'focus' | 'tasks';
	interval: 'daily' | 'weekly' | 'monthly' | 'yearly';
}

export interface ChallengesQueryParams extends BaseQueryParams {
	// No additional fields - challenges don't have interval or type params
}

// ============================================================================
// Query Parser Functions
// ============================================================================

/**
 * Helper function to parse base query parameters shared by both medals and challenges
 */
function parseBaseQueryParams(req: Request): BaseQueryParams {
	// Combine projects from both TickTick and Todoist
	const ticktickProjects = req.query['projects-ticktick'] as string || '';
	const todoistProjects = req.query['projects-todoist'] as string || '';
	const allProjects = [ticktickProjects, todoistProjects]
		.filter(p => p && p.trim())
		.join(',');

	return {
		projects: allProjects,
		categories: req.query['categories'] as string,
		taskId: req.query['task-id'] as string,
		startDate: req.query['start-date'] as string,
		endDate: req.query['end-date'] as string,
		taskIdIncludeFocusRecordsFromSubtasks: req.query['task-id-include-focus-records-from-subtasks'] === 'true',
		searchQuery: req.query['search'] as string,
		focusApps: req.query['focus-apps'] as string,
		toDoListApps: req.query['to-do-list-apps'] as string,
		timezone: (req.query.timezone as string) || 'UTC',
	};
}

/**
 * Parse query parameters for medals endpoints
 */
export function parseMedalsQueryParams(req: Request, type: 'focus' | 'tasks'): MedalsQueryParams | { error: string } {
	const baseParams = parseBaseQueryParams(req);

	const queryParams: MedalsQueryParams = {
		...baseParams,
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
 * Parse query parameters for challenges endpoints
 */
export function parseChallengesQueryParams(req: Request): ChallengesQueryParams {
	return parseBaseQueryParams(req);
}
