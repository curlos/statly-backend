import { FocusRecord } from '../models/FocusRecord';
import { Task } from '../models/TaskModel';
import {
	DEFAULT_TOTAL_FOCUS_HOURS_CHALLENGES,
	DEFAULT_TOTAL_COMPLETED_TASKS_CHALLENGES,
} from '../utils/constants/challenges.utils';
import {
	APP_SOURCE_MAPPING,
	buildSearchFilter,
	buildMatchAndFilterConditions,
	buildBasePipeline,
	addTaskDurationCalculation,
	getDateGroupingExpression,
} from '../utils/filterBuilders.utils';

// ============================================================================
// Helper Functions
// ============================================================================

// Helper function to remove leading zero from day in date string
// Converts "October 03, 2024" to "October 3, 2024"
function formatDateWithoutLeadingZero(dateStr: string): string {
	return dateStr.replace(/(\w+)\s0(\d),\s(\d{4})/, '$1 $2, $3');
}

// ============================================================================
// Challenge Calculation Functions
// ============================================================================

function calculateChallengesFromDailyTotals(
	dailyTotals: Array<{ date: string; total: number }>,
	challenges: any[]
) {
	// Sort dailyTotals chronologically (oldest first)
	const sortedDailyTotals = [...dailyTotals].sort((a, b) => {
		return new Date(a.date).getTime() - new Date(b.date).getTime();
	});

	// Clone challenges array with null completion dates
	const challengeResults = challenges.map(challenge => ({
		...challenge,
		completedDate: null
	}));

	// Accumulate totals day by day and mark completion dates
	let cumulativeTotal = 0;
	for (const { date, total } of sortedDailyTotals) {
		cumulativeTotal += total;

		// Debug logging for dates around July 13, 2025
		if (date.includes('July') && date.includes('2025')) {
			const hoursFromSeconds = (cumulativeTotal / 3600).toFixed(2);
			console.log(`[DEBUG] Date: ${date}, Day Total: ${(total / 3600).toFixed(2)}h, Cumulative: ${hoursFromSeconds}h (${cumulativeTotal}s)`);
		}

		// Check each challenge threshold
		for (const challenge of challengeResults) {
			const threshold = challenge.requiredDuration || challenge.requiredCompletedTasks;

			// Mark completion date if threshold reached and not yet completed
			if (!challenge.completedDate && cumulativeTotal >= threshold) {
				// Format the date string
				const dateObj = new Date(date);
				const formattedDate = dateObj.toLocaleDateString('en-US', {
					month: 'long',
					day: 'numeric',
					year: 'numeric'
				});
				challenge.completedDate = formatDateWithoutLeadingZero(formattedDate);

				// Debug log when 6500 hour challenge is completed
				if (threshold === 23400000) {
					const hoursFromSeconds = (cumulativeTotal / 3600).toFixed(2);
					console.log(`[DEBUG] 6500 Hour Challenge Completed! Date: ${date}, Cumulative: ${hoursFromSeconds}h (${cumulativeTotal}s), Threshold: ${(threshold / 3600).toFixed(2)}h (${threshold}s)`);
				}
			}
		}
	}

	return challengeResults;
}

// ============================================================================
// Main Service Methods
// ============================================================================

export interface ChallengesQueryParams {
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

export async function getFocusHoursChallenges(params: ChallengesQueryParams) {
	// Combine projects and categories into a single array
	const projectIds: string[] = [
		...(params.projects ? params.projects.split(',') : []),
		...(params.categories ? params.categories.split(',') : [])
	];

	// Map frontend app names to database source discriminators
	const appNames: string[] = params.focusApps ? params.focusApps.split(',') : [];
	const appSources: string[] = appNames.map(appName => APP_SOURCE_MAPPING[appName]).filter(Boolean);

	// Build filters
	const searchFilter = buildSearchFilter(params.searchQuery);
	const { focusRecordMatchConditions, taskFilterConditions } = buildMatchAndFilterConditions(
		params.taskId,
		projectIds,
		params.startDate,
		params.endDate,
		params.taskIdIncludeFocusRecordsFromSubtasks,
		appSources
	);

	// Build aggregation pipeline
	const pipeline = buildBasePipeline(searchFilter, focusRecordMatchConditions);

	// Add task duration calculation (shared logic)
	addTaskDurationCalculation(pipeline, taskFilterConditions);

	// Group by day and sum task durations
	pipeline.push({
		$group: {
			_id: getDateGroupingExpression('daily', params.timezone),
			totalDuration: { $sum: "$tasksDuration" }
		}
	});

	// Execute aggregation
	const results = await FocusRecord.aggregate(pipeline);

	// Convert results to daily totals array
	const dailyTotals = results.map(result => ({
		date: result._id,
		total: result.totalDuration
	}));

	// Calculate challenges
	return calculateChallengesFromDailyTotals(
		dailyTotals,
		DEFAULT_TOTAL_FOCUS_HOURS_CHALLENGES
	);
}

export async function getCompletedTasksChallenges(params: ChallengesQueryParams) {
	// Build match filter for completed tasks
	const matchFilter: any = {
		completedTime: { $exists: true, $ne: null }
	};

	// Filter by to-do list apps (TaskTickTick or TaskTodoist)
	if (params.toDoListApps) {
		const appSources = params.toDoListApps.split(',').map(app => `Task${app.trim()}`);
		matchFilter.source = { $in: appSources };
	}

	// Add date range filter
	if (params.startDate && params.endDate) {
		const startDateObj = new Date(params.startDate);
		const endDateObj = new Date(params.endDate);

		startDateObj.setHours(0, 0, 0, 0);
		endDateObj.setHours(23, 59, 59, 999);

		matchFilter.completedTime = {
			...matchFilter.completedTime,
			$gte: startDateObj,
			$lte: endDateObj
		};
	}

	// Filter by multiple project IDs
	if (params.projects || params.categories) {
		const allProjectIds = [];
		if (params.projects) {
			allProjectIds.push(...params.projects.split(','));
		}
		if (params.categories) {
			allProjectIds.push(...params.categories.split(','));
		}
		matchFilter.projectId = { $in: allProjectIds };
	}

	// Filter by taskId
	if (params.taskId) {
		if (params.taskIdIncludeFocusRecordsFromSubtasks) {
			matchFilter[`ancestorSet.${params.taskId}`] = true;
		} else {
			matchFilter.$or = [
				{ id: params.taskId },
				{ parentId: params.taskId }
			];
		}
	}

	// Build search filter
	const searchFilter = params.searchQuery && params.searchQuery.trim() ? {
		$or: [
			{ title: { $regex: params.searchQuery.trim(), $options: 'i' } },
			{ content: { $regex: params.searchQuery.trim(), $options: 'i' } },
		]
	} : null;

	// Build aggregation pipeline
	const pipeline: any[] = [];

	if (searchFilter) {
		pipeline.push({ $match: searchFilter });
	}

	pipeline.push({ $match: matchFilter });

	// Group by day and count tasks
	pipeline.push({
		$group: {
			_id: {
				$dateToString: {
					format: "%B %d, %Y",
					date: "$completedTime",
					timezone: params.timezone
				}
			},
			taskCount: { $sum: 1 }
		}
	});

	// Execute aggregation
	const results = await Task.aggregate(pipeline);

	// Convert results to daily totals array
	const dailyTotals = results.map(result => ({
		date: result._id,
		total: result.taskCount
	}));

	// Calculate challenges
	return calculateChallengesFromDailyTotals(
		dailyTotals,
		DEFAULT_TOTAL_COMPLETED_TASKS_CHALLENGES
	);
}
