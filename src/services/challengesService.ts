import { FocusRecord } from '../models/FocusRecord';
import { Task } from '../models/TaskModel';
import {
	DEFAULT_TOTAL_FOCUS_HOURS_CHALLENGES,
	DEFAULT_TOTAL_COMPLETED_TASKS_CHALLENGES,
} from '../utils/constants/challenges.utils';
import {
	buildFocusSearchFilter,
	buildFocusMatchAndFilterConditions,
	buildFocusBasePipeline,
	addFocusTaskDurationCalculation,
} from '../utils/focusFilterBuilders.utils';
import { getDateGroupingExpression } from '../utils/filterBuilders.utils';
import { buildTaskSearchFilter, buildTaskMatchConditions } from '../utils/taskFilterBuilders.utils';
import { ChallengesQueryParams } from '../utils/queryParams.utils';
import { addMidnightRecordDurationAdjustment } from '../utils/focus.utils';

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

	// Clone and sort challenges by threshold (smallest first)
	const sortedChallenges = challenges.map(challenge => ({
		...challenge,
		completedDate: null,
		threshold: challenge.requiredDuration || challenge.requiredCompletedTasks
	})).sort((a, b) => a.threshold - b.threshold);

	// Track which challenge we're currently trying to complete
	let currentChallengeIndex = 0;
	let cumulativeTotal = 0;

	// Process each day
	for (const { date, total } of sortedDailyTotals) {
		cumulativeTotal += total;

		// Check challenges starting from the current uncompleted one
		while (currentChallengeIndex < sortedChallenges.length) {
			const challenge = sortedChallenges[currentChallengeIndex];

			if (cumulativeTotal >= challenge.threshold) {
				// Mark this challenge as complete
				const dateObj = new Date(date);
				const formattedDate = dateObj.toLocaleDateString('en-US', {
					month: 'long',
					day: 'numeric',
					year: 'numeric'
				});
				challenge.completedDate = formatDateWithoutLeadingZero(formattedDate);

				// Move to next challenge
				currentChallengeIndex++;
			} else {
				// Haven't reached this threshold yet, stop checking higher ones
				break;
			}
		}

		// If all challenges are complete, no need to process more days
		if (currentChallengeIndex >= sortedChallenges.length) {
			break;
		}
	}

	// Remove the temporary threshold field and return in original order
	return challenges.map(challenge => {
		const completedChallenge = sortedChallenges.find(sc => sc.name === challenge.name);
		return {
			...challenge,
			completedDate: completedChallenge?.completedDate || null
		};
	});
}

// ============================================================================
// Main Service Methods
// ============================================================================

export async function getFocusHoursChallenges(params: ChallengesQueryParams) {
	// Build filters
	const searchFilter = buildFocusSearchFilter(params.searchQuery);
	const { focusRecordMatchConditions, taskFilterConditions } = buildFocusMatchAndFilterConditions(
		params.taskId,
		params.projectIds,
		params.startDate,
		params.endDate,
		params.taskIdIncludeFocusRecordsFromSubtasks,
		params.focusAppSources,
		params.crossesMidnight
	);

	// Calculate date boundaries for duration adjustment
	const startDateBoundary = params.startDate ? new Date(params.startDate) : null;
	let endDateBoundary: Date | null = null;
	if (params.endDate) {
		endDateBoundary = new Date(params.endDate);
		endDateBoundary.setDate(endDateBoundary.getDate() + 1);
	}

	// Build aggregation pipeline
	const pipeline = buildFocusBasePipeline(searchFilter, focusRecordMatchConditions);

	// Add duration adjustment for midnight-crossing records
	if (startDateBoundary || endDateBoundary) {
		addMidnightRecordDurationAdjustment(pipeline, startDateBoundary, endDateBoundary);
	}

	// Add task duration calculation (shared logic)
	addFocusTaskDurationCalculation(pipeline, taskFilterConditions);

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
