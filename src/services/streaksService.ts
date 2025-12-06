import { Types } from 'mongoose';
import UserSettings from '../models/UserSettingsModel';
import { buildFocusFilterPipeline } from '../utils/focusFilterBuilders.utils';
import FocusRecord from '../models/FocusRecord';
import { BaseQueryParams } from '../utils/queryParams.utils';
import { fromZonedTime } from 'date-fns-tz';

// ============================================================================
// Streaks Service
// ============================================================================

// Streaks uses the same base query params as other endpoints (projects, dates, filters, etc.)
// goalSeconds comes from user settings, not query params
export type StreaksQueryParams = BaseQueryParams;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get today's date key in the user's timezone (YYYY-MM-DD format)
 */
function getTodayDateKey(timezone: string): string {
	const now = new Date();
	// Format in user's timezone: YYYY-MM-DD
	const formatted = now.toLocaleDateString('en-CA', {
		timeZone: timezone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	});
	return formatted; // en-CA locale gives YYYY-MM-DD format
}

/**
 * Helper: Get the date one day after the given date
 */
function getNextDay(dateString: string): string {
	const date = new Date(dateString + 'T00:00:00Z');
	date.setUTCDate(date.getUTCDate() + 1);
	return date.toISOString().split('T')[0];
}

/**
 * Calculate streaks from daily totals (no need to fill missing days!)
 * Tracks BOTH current streak (up to today) AND longest streak ever
 *
 * Logic:
 * - Iterate through days with focus records (already sorted)
 * - Check if goal is met AND date is consecutive to previous day
 * - If gap detected (date is not consecutive), break the streak
 * - Today doesn't break the streak (still have time to meet goal)
 *
 * Note: A 5-minute offset is applied to the goal (e.g., 5h55m counts for a 6h goal)
 */
function calculateStreaks(
	dailyTotals: Array<{ date: string; duration: number }>,
	goalSeconds: number,
	timezone: string
) {
	if (dailyTotals.length === 0) {
		return {
			currentStreak: { days: 0, from: null as string | null, to: null as string | null },
			longestStreak: { days: 0, from: null as string | null, to: null as string | null },
			allStreaks: []
		};
	}

	const todayDateKey = getTodayDateKey(timezone);
	const offsetGoalSeconds = goalSeconds - 300; // 5-minute offset

	let currentStreak = { days: 0, from: null as string | null, to: null as string | null };
	let longestStreak = { days: 0, from: null as string | null, to: null as string | null };
	let tempStreak = { days: 0, from: null as string | null, to: null as string | null };
	let allStreaks: Array<{ days: number; from: string | null; to: string | null }> = [];
	let lastDate: string | null = null;

	for (const { date, duration } of dailyTotals) {
		const goalMet = duration >= offsetGoalSeconds;

		// Check if this date is consecutive to the last date
		const isConsecutive = lastDate === null || date === getNextDay(lastDate);

		if (goalMet && isConsecutive) {
			// Continue or start streak
			tempStreak.days += 1;
			if (!tempStreak.from) tempStreak.from = date;
			tempStreak.to = date;
		} else if (!goalMet && date === todayDateKey) {
			// Today doesn't break the streak (still have time to meet goal)
			// Don't reset tempStreak, don't update lastDate
			continue;
		} else {
			// Streak broken (either goal not met or gap in dates)
			// Save the completed streak to allStreaks
			if (tempStreak.days > 0) {
				allStreaks.push({ ...tempStreak });
			}

			// Check if we should update longest before resetting
			if (tempStreak.days >= longestStreak.days) {
				longestStreak = { ...tempStreak };
			}

			// Reset temp streak
			tempStreak = { days: 0, from: null, to: null };

			// If current day meets goal, start new streak
			if (goalMet) {
				tempStreak = { days: 1, from: date, to: date };
			}
		}

		lastDate = date;
	}

	// Check if there's a gap between the last record and today
	if (tempStreak.days > 0 && lastDate) {
		const expectedNextDay = getNextDay(lastDate);
		if (expectedNextDay !== todayDateKey && lastDate !== todayDateKey) {
			// Gap exists - streak is broken, this is not the current streak
			// Save the completed streak to allStreaks
			if (tempStreak.days > 0) {
				allStreaks.push({ ...tempStreak });
			}

			if (tempStreak.days >= longestStreak.days) {
				longestStreak = { ...tempStreak };
			}
			tempStreak = { days: 0, from: null, to: null };
		}
	}

	// Final check: if tempStreak is still ongoing, it might be the longest
	if (tempStreak.days >= longestStreak.days) {
		longestStreak = { ...tempStreak };
	}

	// Current streak is the temp streak if it's still ongoing
	if (tempStreak.days > 0) {
		currentStreak = tempStreak;
		// Add the current ongoing streak to allStreaks
		allStreaks.push({ ...tempStreak });
	}

	// Filter to only include streaks with 1+ days (no need to sort here - frontend will handle it)
	const filteredStreaks = allStreaks.filter(streak => streak.days >= 1);

	return { currentStreak, longestStreak, allStreaks: filteredStreaks };
}

/**
 * Get daily focus durations by aggregating ALL focus records by day
 * Efficient: Single MongoDB aggregation groups all historical data
 */
async function getDailyFocusDurations(
	basePipeline: any[],
	timezone: string
) {
	const pipeline = [...basePipeline];

	// Group by day
	pipeline.push({
		$facet: {
			byDay: [
				{ $unwind: { path: "$tasks", preserveNullAndEmptyArrays: false } },
				{
					$group: {
						_id: {
							$dateToString: { format: "%Y-%m-%d", date: "$tasks.startTime", timezone: timezone }
						},
						duration: { $sum: "$tasks.duration" }
					}
				},
				{ $sort: { _id: 1 } }
			]
		}
	});

	const result = await FocusRecord.aggregate(pipeline);
	const facetResult = result[0];
	const results = facetResult.byDay || [];

	return results.map((r: any) => ({
		date: r._id,
		duration: r.duration
	}));
}

/**
 * Get today's focus duration only (fast, single-day query)
 */
async function getTodayFocusDuration(
	basePipeline: any[],
	timezone: string
): Promise<number> {
	const todayDateKey = getTodayDateKey(timezone);
	// Parse the YYYY-MM-DD string directly as a date in the user's timezone
	// fromZonedTime interprets the date string in the user's timezone and returns UTC
	const dayStart = fromZonedTime(`${todayDateKey} 00:00:00`, timezone);
	const dayEnd = new Date(dayStart);
	dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

	const pipeline = [...basePipeline];

	// Filter to today's date only
	pipeline.push(
		{ $unwind: { path: "$tasks", preserveNullAndEmptyArrays: false } },
		{
			$match: {
				'tasks.startTime': { $gte: dayStart, $lt: dayEnd }
			}
		},
		{
			$group: {
				_id: null,
				duration: { $sum: "$tasks.duration" }
			}
		}
	);

	const result = await FocusRecord.aggregate(pipeline);
	return result[0]?.duration || 0;
}

// ============================================================================
// Main Service Functions
// ============================================================================

/**
 * Get today's focus data only (fast, optimized for single day)
 * Endpoint: GET /streaks/today
 */
export async function getTodayFocusData(
	params: StreaksQueryParams,
	userId: Types.ObjectId
) {
	// Get user settings for goalSeconds
	const userSettings = await UserSettings.findOne({ userId });
	const goalSeconds = userSettings?.tickTickOne?.pages?.focusHoursGoal?.goalSeconds || 21600; // Default: 6 hours

	// Build complete filter pipeline using shared utility
	const { pipeline: basePipeline } = buildFocusFilterPipeline({
		...params,
		userId
	});

	// Fast: Only get today's duration
	const totalFocusDurationForDay = await getTodayFocusDuration(basePipeline, params.timezone);

	return {
		todayData: {
			goalSeconds,
			totalFocusDurationForDay,
			percentageOfFocusedGoalHours: (totalFocusDurationForDay / goalSeconds) * 100
		}
	};
}

/**
 * Get full streak history (current + longest streaks)
 * Endpoint: GET /streaks/history
 *
 * Note: Respects ALL filters including date ranges, projects, tasks, emotions, etc.
 * Streaks are calculated only from the filtered data.
 */
export async function getStreakHistory(
	params: StreaksQueryParams,
	userId: Types.ObjectId
) {
	// Get user settings for goalSeconds
	const userSettings = await UserSettings.findOne({ userId });
	const goalSeconds = userSettings?.tickTickOne?.pages?.focusHoursGoal?.goalSeconds || 21600; // Default: 6 hours

	// Build complete filter pipeline using shared utility (respects all filters)
	const { pipeline: basePipeline } = buildFocusFilterPipeline({
		...params,
		userId
	});

	// Get daily totals (filtered by user's applied filters)
	const dailyTotals = await getDailyFocusDurations(basePipeline, params.timezone);

	// Calculate both current and longest streaks (no need to fill missing days!)
	const { currentStreak, longestStreak, allStreaks } = calculateStreaks(dailyTotals, goalSeconds, params.timezone);

	// Convert dailyTotals to a map for easy lookup
	const dailyDurationsMap: Record<string, number> = {};
	for (const { date, duration } of dailyTotals) {
		dailyDurationsMap[date] = duration;
	}

	return {
		currentStreak,
		longestStreak,
		allStreaks,
		dailyDurationsMap
	};
}
