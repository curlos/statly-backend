import { Request } from 'express';
import { APP_SOURCE_MAPPING } from './focusFilterBuilders.utils';
import { TASK_APP_SOURCE_MAPPING } from './taskFilterBuilders.utils';

// ============================================================================
// Shared Query Params Types
// ============================================================================

export interface BaseQueryParams {
	projectIds: string[]; // Combined projects and categories, already split
	taskId?: string;
	startDate?: string; // Filter Sidebar dates (first tier filter)
	endDate?: string; // Filter Sidebar dates (first tier filter)
	intervalStartDate?: string; // Interval Dropdown dates (second tier filter)
	intervalEndDate?: string; // Interval Dropdown dates (second tier filter)
	taskIdIncludeFocusRecordsFromSubtasks: boolean;
	searchQuery?: string;
	focusAppSources: string[]; // Mapped focus app sources
	toDoListAppSources: string[]; // Mapped to-do list app sources
	timezone: string;
	crossesMidnight?: boolean; // Filter for focus records that cross midnight
}

export interface MedalsQueryParams extends BaseQueryParams {
	type: 'focus' | 'tasks';
	interval: 'daily' | 'weekly' | 'monthly' | 'yearly';
}

export interface ChallengesQueryParams extends BaseQueryParams {
	// No additional fields - challenges don't have interval or type params
}

export interface DaysWithCompletedTasksQueryParams extends BaseQueryParams {
	page: number;
	maxDaysPerPage: number;
	sortBy: string;
	taskIdIncludeSubtasks: boolean;
}

// ============================================================================
// Query Parser Functions
// ============================================================================

/**
 * Helper function to parse base query parameters shared by both medals and challenges
 */
export function parseBaseQueryParams(req: Request): BaseQueryParams {
	// Combine projects from both TickTick and Todoist, plus categories
	const ticktickProjects = req.query['projects-ticktick'] as string || '';
	const todoistProjects = req.query['projects-todoist'] as string || '';
	const categories = req.query['categories'] as string || '';

	// Combine all project IDs (projects-ticktick, projects-todoist, and categories) and split into array
	const allProjectIdsString = [ticktickProjects, todoistProjects, categories]
		.filter(p => p && p.trim())
		.join(',');

	const projectIds = allProjectIdsString ? allProjectIdsString.split(',') : [];

	// Map frontend app names to database source discriminators
	const focusAppNames: string[] = req.query['focus-apps'] ? (req.query['focus-apps'] as string).split(',') : [];
	const focusAppSources: string[] = focusAppNames.map(appName => APP_SOURCE_MAPPING[appName]).filter(Boolean);

	const toDoListAppNames: string[] = req.query['to-do-list-apps'] ? (req.query['to-do-list-apps'] as string).split(',') : [];
	const toDoListAppSources: string[] = toDoListAppNames.map(appName => TASK_APP_SOURCE_MAPPING[appName]).filter(Boolean);

	// Parse crossesMidnight query param
	const crossesMidnightParam = req.query['crosses-midnight'] as string;
	const crossesMidnight = crossesMidnightParam === 'true' ? true : crossesMidnightParam === 'false' ? false : undefined;

	return {
		projectIds,
		taskId: req.query['task-id'] as string,
		startDate: req.query['start-date'] as string,
		endDate: req.query['end-date'] as string,
		intervalStartDate: req.query['interval-start-date'] as string,
		intervalEndDate: req.query['interval-end-date'] as string,
		taskIdIncludeFocusRecordsFromSubtasks: req.query['task-id-include-focus-records-from-subtasks'] === 'true',
		searchQuery: req.query['search'] as string,
		focusAppSources,
		toDoListAppSources,
		timezone: (req.query.timezone as string) || 'UTC',
		crossesMidnight,
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

/**
 * Parse query parameters for days-with-completed-tasks endpoint
 */
export function parseDaysWithCompletedTasksQueryParams(req: Request): DaysWithCompletedTasksQueryParams {
	const baseParams = parseBaseQueryParams(req);

	return {
		...baseParams,
		page: parseInt(req.query.page as string) || 0,
		maxDaysPerPage: parseInt(req.query['max-days-per-page'] as string) || 7,
		sortBy: (req.query['sort-by'] as string) || 'Newest',
		taskIdIncludeSubtasks: req.query['task-id-include-completed-tasks-from-subtasks'] === 'true',
	};
}

/**
 * Parse query parameters for focus records endpoint
 */
export function parseFocusRecordsQueryParams(req: Request) {
	const baseParams = parseBaseQueryParams(req);

	return {
		...baseParams,
		page: parseInt(req.query.page as string) || 0,
		limit: parseInt(req.query.limit as string) || 25,
		sortBy: (req.query['sort-by'] as string) || 'Newest',
	};
}
