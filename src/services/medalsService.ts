import { FocusRecord } from '../models/FocusRecord';
import { Task } from '../models/TaskModel';
import {
	DEFAULT_DAILY_FOCUS_HOURS_MEDALS,
	DEFAULT_WEEKLY_FOCUS_HOURS_MEDALS,
	DEFAULT_MONTHLY_FOCUS_HOURS_MEDALS,
	DEFAULT_YEARLY_FOCUS_HOURS_MEDALS,
	DEFAULT_DAILY_COMPLETED_TASKS_MEDALS,
	DEFAULT_WEEKLY_COMPLETED_TASKS_MEDALS,
	DEFAULT_MONTHLY_COMPLETED_TASKS_MEDALS,
	DEFAULT_YEARLY_COMPLETED_TASKS_MEDALS,
} from '../utils/constants/medals.utils';
import {
	buildFocusSearchFilter,
	buildFocusMatchAndFilterConditions,
	buildFocusBasePipeline,
	addFocusTaskDurationCalculation,
} from '../utils/focusFilterBuilders.utils';
import { getDateGroupingExpression } from '../utils/filterBuilders.utils';
import { buildTaskSearchFilter, buildTaskMatchConditions } from '../utils/taskFilterBuilders.utils';
import { MedalsQueryParams } from '../utils/queryParams.utils';

// ============================================================================
// Date Formatting Helpers
// ============================================================================

// Helper function to remove leading zero from day in date string
// Converts "October 03, 2024" to "October 3, 2024"
function formatDateWithoutLeadingZero(dateStr: string): string {
	// Match pattern: "Month 0X, Year" and replace with "Month X, Year"
	return dateStr.replace(/(\w+)\s0(\d),\s(\d{4})/, '$1 $2, $3');
}

// For weekly intervals, we need to format the period key to match frontend format
// Format: "Sep 29, 2025 - Oct 5, 2025"
function formatWeeklyPeriodKey(mondayDateStr: string): string {
	const monday = new Date(mondayDateStr);
	const sunday = new Date(monday);
	sunday.setDate(monday.getDate() + 6);

	const formatDate = (date: Date) => {
		return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	};

	return `${formatDate(monday)} - ${formatDate(sunday)}`;
}

// ============================================================================
// Medal Calculation Functions
// ============================================================================

const GRACE_PERIOD_SECONDS = 300; // 5 minutes

function getMedalsByInterval(interval: string, type: 'focus' | 'tasks') {
	if (type === 'focus') {
		switch (interval) {
			case 'daily': return DEFAULT_DAILY_FOCUS_HOURS_MEDALS;
			case 'weekly': return DEFAULT_WEEKLY_FOCUS_HOURS_MEDALS;
			case 'monthly': return DEFAULT_MONTHLY_FOCUS_HOURS_MEDALS;
			case 'yearly': return DEFAULT_YEARLY_FOCUS_HOURS_MEDALS;
			default: return DEFAULT_DAILY_FOCUS_HOURS_MEDALS;
		}
	} else {
		switch (interval) {
			case 'daily': return DEFAULT_DAILY_COMPLETED_TASKS_MEDALS;
			case 'weekly': return DEFAULT_WEEKLY_COMPLETED_TASKS_MEDALS;
			case 'monthly': return DEFAULT_MONTHLY_COMPLETED_TASKS_MEDALS;
			case 'yearly': return DEFAULT_YEARLY_COMPLETED_TASKS_MEDALS;
			default: return DEFAULT_DAILY_COMPLETED_TASKS_MEDALS;
		}
	}
}

function calculateMedalsFromPeriodTotals(
	periodTotals: { [key: string]: number },
	medals: any[],
	interval: string,
	type: 'focus' | 'tasks'
) {
	const medalResults: any = {};

	// Initialize all medals with empty arrays
	medals.forEach(medal => {
		medalResults[medal.name] = {
			intervalsEarned: []
		};
	});

	// Check each period against medal thresholds
	Object.entries(periodTotals).forEach(([periodKey, total]) => {
		// Format period key based on interval type
		let formattedPeriodKey = periodKey;
		if (interval === 'weekly') {
			formattedPeriodKey = formatWeeklyPeriodKey(periodKey);
		} else if (interval === 'daily') {
			// Remove leading zeros from day (e.g., "October 03, 2024" -> "October 3, 2024")
			formattedPeriodKey = formatDateWithoutLeadingZero(periodKey);
		}

		medals.forEach(medal => {
			const threshold = type === 'focus' ? medal.requiredDuration : medal.requiredCompletedTasks;
			const adjustedTotal = type === 'focus' ? total + GRACE_PERIOD_SECONDS : total;

			if (adjustedTotal >= threshold) {
				medalResults[medal.name].intervalsEarned.push(formattedPeriodKey);
			}
		});
	});

	// Sort intervalsEarned arrays from newest to oldest
	Object.values(medalResults).forEach((medalData: any) => {
		medalData.intervalsEarned.sort((a: string, b: string) => {
			const dateA = new Date(a);
			const dateB = new Date(b);
			return dateB.getTime() - dateA.getTime(); // Newest first
		});
	});

	return medalResults;
}

// ============================================================================
// Main Service Methods
// ============================================================================

export async function getFocusHoursMedals(params: MedalsQueryParams) {
	// Build filters
	const searchFilter = buildFocusSearchFilter(params.searchQuery);
	const { focusRecordMatchConditions, taskFilterConditions } = buildFocusMatchAndFilterConditions(
		params.taskId,
		params.projectIds,
		params.startDate,
		params.endDate,
		params.taskIdIncludeFocusRecordsFromSubtasks,
		params.focusAppSources
	);

	// Build aggregation pipeline
	const pipeline = buildFocusBasePipeline(searchFilter, focusRecordMatchConditions);

	// Add task duration calculation (shared logic)
	addFocusTaskDurationCalculation(pipeline, taskFilterConditions);

	// Group by period and sum task durations
	pipeline.push({
		$group: {
			_id: getDateGroupingExpression(params.interval, params.timezone),
			totalDuration: { $sum: "$tasksDuration" }
		}
	});

	// Execute aggregation
	// Example results: [
	//   { _id: 'October 15, 2025', totalDuration: 32400 },
	//   { _id: 'October 16, 2025', totalDuration: 18000 }
	// ]
	const results = await FocusRecord.aggregate(pipeline);

	// Convert results to period totals object
	const periodTotals: { [key: string]: number } = {};
	results.forEach(result => {
		periodTotals[result._id] = result.totalDuration;
	});

	// Calculate medals
	const medals = getMedalsByInterval(params.interval, 'focus');
	return calculateMedalsFromPeriodTotals(periodTotals, medals, params.interval, 'focus');
}

export async function getCompletedTasksMedals(params: MedalsQueryParams) {
	// Build filters using shared builder
	const searchFilter = buildTaskSearchFilter(params.searchQuery);
	const matchFilter = buildTaskMatchConditions(
		params.taskId,
		params.projectIds,
		params.startDate,
		params.endDate,
		params.taskIdIncludeFocusRecordsFromSubtasks,
		params.toDoListAppSources
	);

	// Build aggregation pipeline
	const pipeline: any[] = [];

	if (searchFilter) {
		pipeline.push({ $match: searchFilter });
	}

	pipeline.push({ $match: matchFilter });

	// Group by period and count tasks
	pipeline.push({
		$group: {
			_id: getDateGroupingExpression(params.interval, params.timezone, '$completedTime'),
			taskCount: { $sum: 1 }
		}
	});

	// Execute aggregation
	const results = await Task.aggregate(pipeline);

	// Convert results to period totals object
	const periodTotals: { [key: string]: number } = {};
	results.forEach(result => {
		periodTotals[result._id] = result.taskCount;
	});

	// Calculate medals
	const medals = getMedalsByInterval(params.interval, 'tasks');
	return calculateMedalsFromPeriodTotals(periodTotals, medals, params.interval, 'tasks');
}
