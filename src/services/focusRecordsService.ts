import FocusRecordTickTick from '../models/FocusRecord';
import { addAncestorAndCompletedTasks, addMidnightRecordDurationAdjustment } from '../utils/focus.utils';
import {
	buildFocusSearchFilter,
	buildFocusMatchAndFilterConditions,
	buildFocusBasePipeline,
	buildFocusTotalsCalculationPipeline,
	extractFocusTotalsFromResult,
	addTaskFilteringAndDurationRecalculation,
} from '../utils/focusFilterBuilders.utils';

// ============================================================================
// Sort Criteria Builder
// ============================================================================

function buildSortCriteria(sortBy: string): { [key: string]: 1 | -1 } {
	switch (sortBy) {
		case 'Oldest':
			return { startTime: 1 };
		case 'Focus Hours: Most-Least':
			return { duration: -1 };
		case 'Focus Hours: Least-Most':
			return { duration: 1 };
		case 'Newest':
		default:
			return { startTime: -1 };
	}
}

// ============================================================================
// Unified Query Executor
// ============================================================================

async function executeQuery(
	searchFilter: any,
	focusRecordMatchConditions: any,
	taskFilterConditions: any[],
	sortCriteria: { [key: string]: 1 | -1 },
	skip: number,
	limit: number,
	startDateBoundary: Date | null = null,
	endDateBoundary: Date | null = null
) {
	const hasTaskOrProjectFilters = taskFilterConditions.length > 0;

	// Build main query pipeline
	const queryPipeline = buildFocusBasePipeline(searchFilter, focusRecordMatchConditions);

	// Add stage to adjust durations for records that cross midnight beyond date boundaries
	if (startDateBoundary || endDateBoundary) {
		addMidnightRecordDurationAdjustment(queryPipeline, startDateBoundary, endDateBoundary);
	}

	// Add task filtering and duration recalculation (preserves original duration)
	addTaskFilteringAndDurationRecalculation(queryPipeline, taskFilterConditions, true);

	queryPipeline.push({ $sort: sortCriteria });
	queryPipeline.push({ $skip: skip });
	queryPipeline.push({ $limit: limit });

	const focusRecords = await FocusRecordTickTick.aggregate(queryPipeline);

	// Build count and duration pipeline (using extracted function)
	const basePipelineForTotals = buildFocusBasePipeline(searchFilter, focusRecordMatchConditions);

	// Add the same duration adjustment logic for the count/duration pipeline
	if (startDateBoundary || endDateBoundary) {
		addMidnightRecordDurationAdjustment(basePipelineForTotals, startDateBoundary, endDateBoundary);
	}

	// Use extracted function to build totals calculation pipeline
	const countAndDurationPipeline = buildFocusTotalsCalculationPipeline(basePipelineForTotals, taskFilterConditions);
	const countAndDurationResult = await FocusRecordTickTick.aggregate(countAndDurationPipeline);

	// Use extracted function to parse the result
	const { total, totalDuration, onlyTasksTotalDuration } = extractFocusTotalsFromResult(
		countAndDurationResult,
		hasTaskOrProjectFilters
	);

	return {
		focusRecords,
		total,
		totalDuration,
		onlyTasksTotalDuration
	};
}

// ============================================================================
// Main Service Method
// ============================================================================

export interface FocusRecordsQueryParams {
	page: number;
	limit: number;
	projectIds: string[]; // Combined projects and categories, already split
	taskId?: string;
	startDate?: string; // Filter Sidebar dates (first tier filter)
	endDate?: string; // Filter Sidebar dates (first tier filter)
	intervalStartDate?: string; // Interval Dropdown dates (second tier filter)
	intervalEndDate?: string; // Interval Dropdown dates (second tier filter)
	sortBy: string;
	taskIdIncludeFocusRecordsFromSubtasks: boolean;
	searchQuery?: string;
	focusAppSources: string[]; // Mapped focus app sources
	crossesMidnight?: boolean;
}

export async function getFocusRecords(params: FocusRecordsQueryParams) {
	const skip = params.page * params.limit;

	// Build filters
	const searchFilter = buildFocusSearchFilter(params.searchQuery);
	const sortCriteria = buildSortCriteria(params.sortBy);
	const { focusRecordMatchConditions, taskFilterConditions } = buildFocusMatchAndFilterConditions(
		params.taskId,
		params.projectIds,
		params.startDate,
		params.endDate,
		params.taskIdIncludeFocusRecordsFromSubtasks,
		params.focusAppSources,
		params.crossesMidnight,
		params.intervalStartDate,
		params.intervalEndDate
	);

	// Calculate the date boundaries for duration adjustment
	// Use interval dates if provided (second tier), otherwise use filter sidebar dates (first tier)
	const effectiveStartDate = params.intervalStartDate || params.startDate;
	const effectiveEndDate = params.intervalEndDate || params.endDate;

	const startDateBoundary = effectiveStartDate ? new Date(effectiveStartDate) : null;
	let endDateBoundary: Date | null = null;
	if (effectiveEndDate) {
		endDateBoundary = new Date(effectiveEndDate);
		endDateBoundary.setDate(endDateBoundary.getDate() + 1);
	}

	// Execute unified query (conditionally adds stages based on filters)
	const { focusRecords, total, totalDuration, onlyTasksTotalDuration } = await executeQuery(
		searchFilter,
		focusRecordMatchConditions,
		taskFilterConditions,
		sortCriteria,
		skip,
		params.limit,
		startDateBoundary,
		endDateBoundary
	);

	// Add ancestor tasks and completed tasks
	const { focusRecordsWithCompletedTasks, ancestorTasksById } = await addAncestorAndCompletedTasks(focusRecords);

	// Calculate pagination metadata
	const totalPages = Math.ceil(total / params.limit);
	const hasMore = skip + focusRecords.length < total;

	return {
		data: focusRecordsWithCompletedTasks,
		ancestorTasksById,
		total,
		totalPages,
		page: params.page,
		limit: params.limit,
		hasMore,
		totalDuration,
		onlyTasksTotalDuration,
	};
}
