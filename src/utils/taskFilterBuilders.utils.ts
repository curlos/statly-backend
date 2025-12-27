import { parseDateInTimezone } from './timezone.utils';
import { Types } from 'mongoose';
import { MongooseFilter } from '../types/aggregation';

// ============================================================================
// Tasks - App Source Mapping
// ============================================================================

export const TASK_APP_SOURCE_MAPPING: Record<string, string> = {
	'TickTick': 'TaskTickTick',
	'Todoist': 'TaskTodoist'
};

// ============================================================================
// Tasks - Search Filter
// ============================================================================

export function buildTaskSearchFilter(searchQuery?: string) {
	if (!searchQuery || !searchQuery.trim()) {
		return null;
	}

	const trimmedQuery = searchQuery.trim();
	return {
		$or: [
			{ title: { $regex: trimmedQuery, $options: 'i' } },
			{ content: { $regex: trimmedQuery, $options: 'i' } },
		]
	};
}

// ============================================================================
// Tasks - Date Filter Helper
// ============================================================================

/**
 * Helper function to build month-day filter for year-agnostic filtering
 * Filters tasks based on month and day only, ignoring the year
 * @param startDate - Start date string (e.g., "January 15, 2024")
 * @param endDate - End date string (e.g., "March 20, 2024")
 * @param timezone - IANA timezone string
 * @returns MongoDB $expr filter or null if no dates provided
 */
function buildMonthDayFilter(
	startDate: string | undefined,
	endDate: string | undefined,
	timezone?: string
): MongooseFilter | null {
	if (!startDate && !endDate) {
		return null;
	}

	const tz = timezone || 'UTC';

	// Parse dates to extract month and day
	const parseMonthDay = (dateString: string) => {
		const date = new Date(dateString + ' 00:00:00 UTC');
		return {
			month: date.getUTCMonth() + 1,  // 1 through 12
			day: date.getUTCDate()           // 1 through 31
		};
	};

	// Parse start and end dates once (only if present)
	const start = startDate ? parseMonthDay(startDate) : null;
	const end = endDate ? parseMonthDay(endDate) : null;

	// Helper to build "on or after" month-day condition
	const buildOnOrAfterCondition = (month: number, day: number) => {
		return {
			$or: [
				{ $gt: [{ $month: { date: '$completedTime', timezone: tz } }, month] },
				{
					$and: [
						{ $eq: [{ $month: { date: '$completedTime', timezone: tz } }, month] },
						{ $gte: [{ $dayOfMonth: { date: '$completedTime', timezone: tz } }, day] }
					]
				}
			]
		};
	};

	// Helper to build "on or before" month-day condition
	const buildOnOrBeforeCondition = (month: number, day: number) => {
		return {
			$or: [
				{ $lt: [{ $month: { date: '$completedTime', timezone: tz } }, month] },
				{
					$and: [
						{ $eq: [{ $month: { date: '$completedTime', timezone: tz } }, month] },
						{ $lte: [{ $dayOfMonth: { date: '$completedTime', timezone: tz } }, day] }
					]
				}
			]
		};
	};

	if (start && end) {
		// Check if range crosses year boundary (e.g., Dec 25 to Jan 5)
		const crossesYear = start.month > end.month ||
			(start.month === end.month && start.day > end.day);

		if (crossesYear) {
			// Range crosses year boundary: Dec 25-31 OR Jan 1-5
			return {
				$expr: {
					$or: [
						buildOnOrAfterCondition(start.month, start.day),
						buildOnOrBeforeCondition(end.month, end.day)
					]
				}
			};
		} else {
			// Normal range within calendar year: month-day >= start AND month-day <= end
			return {
				$expr: {
					$and: [
						buildOnOrAfterCondition(start.month, start.day),
						buildOnOrBeforeCondition(end.month, end.day)
					]
				}
			};
		}
	} else if (start) {
		// Only start date specified: month-day >= start
		return {
			$expr: buildOnOrAfterCondition(start.month, start.day)
		};
	} else if (end) {
		// Only end date specified: month-day <= end
		return {
			$expr: buildOnOrBeforeCondition(end.month, end.day)
		};
	}

	return null;
}

/**
 * Helper function to build date range filter conditions
 * @param startDate - Start date string (optional)
 * @param endDate - End date string (optional)
 * @param timezone - IANA timezone string (optional)
 * @returns Date filter object or null if no dates provided
 */
function buildDateRangeFilter(startDate?: string, endDate?: string, timezone?: string) {
	if (!startDate && !endDate) {
		return null;
	}

	const tz = timezone || 'UTC';
	const dateFilter: MongooseFilter = {};

	if (startDate) {
		const startBoundary = parseDateInTimezone(startDate, tz);
		dateFilter.$gte = startBoundary;
	}

	if (endDate) {
		const endBoundary = parseDateInTimezone(endDate, tz);
		endBoundary.setUTCDate(endBoundary.getUTCDate() + 1);
		dateFilter.$lt = endBoundary;
	}

	return dateFilter;
}

// ============================================================================
// Tasks - Match Conditions
// ============================================================================

export function buildTaskMatchConditions(
	userId: Types.ObjectId,
	taskId: string | undefined,
	projectIds: string[],
	startDate: string | undefined,
	endDate: string | undefined,
	taskIdIncludeSubtasks: boolean,
	appSources: string[],
	timeField: 'completedTime' | 'createdTime' = 'completedTime',
	intervalStartDate?: string,
	intervalEndDate?: string,
	timezone?: string,
	yearAgnostic?: boolean
) {
	// Validate userId is provided - critical for data isolation
	if (!userId) {
		throw new Error('buildTaskMatchConditions requires userId parameter');
	}

	const matchFilter: MongooseFilter = {};

	// Add userId filter - critical for data isolation
	matchFilter.userId = userId;

	// Only apply completedTime requirement and date filter if timeField is 'completedTime'. Otherwise, if timeField is 'createdTime', skip date filtering entirely.
	if (timeField === 'completedTime') {
		matchFilter.completedTime = { $exists: true, $ne: null };

		// Two-tier date filtering:
		// 1. First tier: Filter Sidebar dates (startDate, endDate) - broad filter
		// 2. Second tier: Interval Dropdown dates (intervalStartDate, intervalEndDate) - narrower filter
		// Both filters must be satisfied (AND logic)

		const dateConditions: Array<Record<string, unknown>> = [];

		if (yearAgnostic) {
			// Year-agnostic filtering: use month-day matching
			const firstTierFilter = buildMonthDayFilter(startDate, endDate, timezone);
			if (firstTierFilter) {
				dateConditions.push(firstTierFilter);
			}

			const secondTierFilter = buildMonthDayFilter(intervalStartDate, intervalEndDate, timezone);
			if (secondTierFilter) {
				dateConditions.push(secondTierFilter);
			}
		} else {
			// Regular year-specific filtering
			const firstTierFilter = buildDateRangeFilter(startDate, endDate, timezone);
			if (firstTierFilter) {
				dateConditions.push({ completedTime: firstTierFilter });
			}

			const secondTierFilter = buildDateRangeFilter(intervalStartDate, intervalEndDate, timezone);
			if (secondTierFilter) {
				dateConditions.push({ completedTime: secondTierFilter });
			}
		}

		// Apply date filters
		if (dateConditions.length === 1) {
			if (yearAgnostic) {
				// $expr can't be merged with regular field filters, must use $and
				matchFilter.$and = [dateConditions[0]];
			} else {
				// Regular filter can be merged into completedTime
				matchFilter.completedTime = {
					...(matchFilter.completedTime as Record<string, unknown>),
					...(dateConditions[0].completedTime as Record<string, unknown>)
				};
			}
		} else if (dateConditions.length === 2) {
			// Both tiers provided, use $and to ensure both are satisfied
			matchFilter.$and = dateConditions;
		}
	}

	// Filter by multiple project IDs
	if (projectIds.length > 0) {
		matchFilter.projectId = { $in: projectIds };
	}

	// Filter by taskId
	if (taskId) {
		if (taskIdIncludeSubtasks) {
			// Include task itself + all descendants using ancestorSet
			matchFilter[`ancestorSet.${taskId}`] = true;
		} else {
			// Only include tasks where id matches taskId OR parentId matches taskId
			matchFilter.$or = [
				{ id: taskId },
				{ parentId: taskId }
			];
		}
	}

	// Filter by to-do list app (source)
	if (appSources.length > 0) {
		matchFilter.source = { $in: appSources };
	}

	return matchFilter;
}
