import { Types, PipelineStage } from 'mongoose';
import UserSettings from '../models/UserSettingsModel';
import { buildFocusFilterPipeline } from '../utils/focusFilterBuilders.utils';
import FocusRecord from '../models/FocusRecord';
import { BaseQueryParams } from '../utils/queryParams.utils';
import { fromZonedTime } from 'date-fns-tz';

// Service-specific types
interface InactivePeriod {
	startDate: string;
	endDate: string | null;
}

interface UserSettingsRing {
	id: string;
	name: string;
	isActive: boolean;
	goalSeconds?: number;
	selectedDaysOfWeek?: Record<string, boolean>;
	restDays?: Record<string, boolean>;
	customDailyFocusGoal?: Record<string, number>;
	inactivePeriods?: InactivePeriod[];
	projects?: Record<string, boolean>;
	[key: string]: unknown;
}

interface UserSettingsData {
	pages?: {
		focusHoursGoal?: {
			rings?: UserSettingsRing[];
		};
	};
}

interface DailyDurationResult {
	_id: string;
	duration: number;
}

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
 * Get all active rings from user settings
 */
function getActiveRings(userSettings: UserSettingsData): UserSettingsRing[] {
	const rings = userSettings?.pages?.focusHoursGoal?.rings;

	if (!rings || !Array.isArray(rings)) {
		return [];
	}

	return rings.filter((ring: UserSettingsRing) => ring.isActive === true);
}

/**
 * Check if a date falls within any inactive period
 */
function isDateInInactivePeriod(dateString: string, inactivePeriods: InactivePeriod[]): boolean {
	if (!inactivePeriods || inactivePeriods.length === 0) {
		return false;
	}

	for (const period of inactivePeriods) {
		const { startDate, endDate } = period;

		// If endDate is null, period is still active (currently inactive)
		// Check if date is >= startDate
		if (endDate === null) {
			if (dateString >= startDate) {
				return true;
			}
		} else {
			// Check if date is within the closed period [startDate, endDate]
			if (dateString >= startDate && dateString <= endDate) {
				return true;
			}
		}
	}

	return false;
}

/**
 * Extract project IDs from ring settings where the value is true
 * Returns array of project IDs
 */
function getProjectIdsFromRing(ring: UserSettingsRing): string[] {
	const projects = ring?.projects;

	if (!projects || typeof projects !== 'object') {
		return [];
	}

	// Filter projects where value is true and get their IDs
	return Object.entries(projects)
		.filter(([_, value]) => value === true)
		.map(([projectId, _]) => projectId);
}

/**
 * Merge project IDs from user settings with existing params
 * Uses Set to avoid duplicates, then converts back to array
 */
function mergeProjectIds(paramsProjectIds: string[] | undefined, settingsProjectIds: string[]): string[] | undefined {
	const existingIds = paramsProjectIds || [];
	const combinedSet = new Set([...existingIds, ...settingsProjectIds]);
	const mergedArray = Array.from(combinedSet);

	return mergedArray.length > 0 ? mergedArray : undefined;
}

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
 * Helper: Get the day of week for a date in user's timezone
 * Returns lowercase day name (e.g., 'monday', 'tuesday', etc.)
 */
function getDayOfWeek(dateString: string, timezone: string): string {
	// Parse the YYYY-MM-DD string in the user's timezone
	const date = new Date(dateString + 'T12:00:00Z'); // Use noon to avoid timezone edge cases
	const dayName = date.toLocaleDateString('en-US', {
		weekday: 'long',
		timeZone: timezone
	});
	return dayName.toLowerCase();
}

/**
 * Helper: Check if two dates are consecutive, accounting for freebie days, rest days, and inactive periods
 * Two dates are consecutive if all days between them (exclusive) are optional days (freebie/rest/inactive)
 */
function isConsecutiveWithFreebies(
	currentDate: string,
	lastDate: string | null,
	timezone: string,
	selectedDaysOfWeek?: Record<string, boolean>,
	restDays?: Record<string, boolean>,
	inactivePeriods?: Array<{ startDate: string; endDate: string | null }>
): boolean {
	// If no last date, this is the first date
	if (lastDate === null) {
		return true;
	}

	// Check each day between lastDate and currentDate
	let checkDate = lastDate;

	while (checkDate < currentDate) {
		checkDate = getNextDay(checkDate);

		// If we've reached the current date, they're consecutive (with possible optional days in between)
		if (checkDate === currentDate) {
			return true;
		}

		// Check if this intermediate day is an optional day (freebie/rest/inactive)
		const dayOfWeek = getDayOfWeek(checkDate, timezone);
		const isFreebieDay = !(selectedDaysOfWeek?.[dayOfWeek] ?? true);
		const isRestDay = restDays?.[checkDate] ?? false;
		const isInactivePeriodDay = isDateInInactivePeriod(checkDate, inactivePeriods || []);

		// If we hit a non-optional day (required work day) between lastDate and currentDate, they're NOT consecutive
		if (!isFreebieDay && !isRestDay && !isInactivePeriodDay) {
			return false;
		}
	}

	// If we exit the loop without reaching currentDate, they're not consecutive
	return false;
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
	timezone: string,
	selectedDaysOfWeek?: Record<string, boolean>,
	restDays?: Record<string, boolean>,
	customDailyFocusGoal?: Record<string, number>,
	inactivePeriods?: Array<{ startDate: string; endDate: string | null }>
) {
	if (dailyTotals.length === 0) {
		return {
			currentStreak: { days: 0, from: null as string | null, to: null as string | null },
			longestStreak: { days: 0, from: null as string | null, to: null as string | null },
			allStreaks: []
		};
	}

	const todayDateKey = getTodayDateKey(timezone);

	let currentStreak = { days: 0, from: null as string | null, to: null as string | null };
	let longestStreak = { days: 0, from: null as string | null, to: null as string | null };
	let tempStreak = { days: 0, from: null as string | null, to: null as string | null };
	const allStreaks: Array<{ days: number; from: string | null; to: string | null }> = [];
	let lastDate: string | null = null;

	for (const { date, duration } of dailyTotals) {
		const dayOfWeek = getDayOfWeek(date, timezone);
		const isFreebieDay = !(selectedDaysOfWeek?.[dayOfWeek] ?? true); // Default: all days can break streak
		const isRestDay = restDays?.[date] ?? false; // Check if this date is a rest day
		const isInactivePeriodDay = isDateInInactivePeriod(date, inactivePeriods || []); // Check if date falls in inactive period

		// Use custom daily goal if set for this date, otherwise use default goal
		const dailyGoalSeconds = customDailyFocusGoal?.[date] ?? goalSeconds;
		const offsetDailyGoal = dailyGoalSeconds - 300; // 5-minute offset

		const goalMet = duration >= offsetDailyGoal;

		// Check if this date is consecutive to the last date, accounting for freebie/rest/inactive days
		const isConsecutive = isConsecutiveWithFreebies(date, lastDate, timezone, selectedDaysOfWeek, restDays, inactivePeriods);

		if (goalMet && isConsecutive) {
			// Goal met (regardless of whether day is selected) → continue streak
			tempStreak.days += 1;
			if (!tempStreak.from) tempStreak.from = date;
			tempStreak.to = date;
			lastDate = date;
		} else if ((isFreebieDay || isRestDay || isInactivePeriodDay) && isConsecutive) {
			// Freebie day OR rest day OR inactive period day where goal not met → don't break streak
			// Don't increment streak, but update lastDate to maintain consecutive tracking
			lastDate = date;
		} else if (!goalMet && date === todayDateKey) {
			// Today doesn't break the streak (still have time to meet goal)
			// Don't reset tempStreak, don't update lastDate
			continue;
		} else {
			// Streak broken (goal not met on a SELECTED day, OR gap in dates)
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

			lastDate = date;
		}
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
	basePipeline: PipelineStage[],
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

	return results.map((r: DailyDurationResult) => ({
		date: r._id,
		duration: r.duration
	}));
}

/**
 * Get today's focus duration only (fast, single-day query)
 */
async function getTodayFocusDuration(
	basePipeline: PipelineStage[],
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

// ============================================================================
// Ring-Specific Functions
// ============================================================================

/**
 * Get today's focus data for a specific ring
 * Used internally by getTodayFocusDataForAllRings
 */
export async function getTodayFocusDataForRing(
	params: StreaksQueryParams,
	userId: Types.ObjectId,
	ring: UserSettingsRing
) {
	// Get project IDs from ring settings
	const projectIdsFromRing = getProjectIdsFromRing(ring);

	// Merge project IDs from ring settings with params
	const mergedProjectIds = mergeProjectIds(params.projectIds, projectIdsFromRing);

	// Build complete filter pipeline using shared utility
	const { pipeline: basePipeline } = buildFocusFilterPipeline({
		...params,
		projectIds: mergedProjectIds,
		userId
	});

	// Fast: Only get today's duration
	const totalFocusDurationForDay = await getTodayFocusDuration(basePipeline, params.timezone);

	return {
		todayData: {
			totalFocusDurationForDay,
			ringId: ring.id,
			ringName: ring.name
		}
	};
}

/**
 * Get streak history for a specific ring
 * Used internally by getStreakHistoryForAllRings
 */
export async function getStreakHistoryForRing(
	params: StreaksQueryParams,
	userId: Types.ObjectId,
	ring: UserSettingsRing
) {
	// Extract ring-specific settings
	const goalSeconds = ring.goalSeconds || 3600; // Default: 1 hour
	const selectedDaysOfWeek = ring.selectedDaysOfWeek;
	const restDays = ring.restDays || {};
	const customDailyFocusGoal = ring.customDailyFocusGoal || {};
	const inactivePeriods = ring.inactivePeriods || [];
	const projectIdsFromRing = getProjectIdsFromRing(ring);

	// Merge project IDs from ring settings with params
	const mergedProjectIds = mergeProjectIds(params.projectIds, projectIdsFromRing);

	// Build complete filter pipeline using shared utility (respects all filters)
	const { pipeline: basePipeline } = buildFocusFilterPipeline({
		...params,
		projectIds: mergedProjectIds,
		userId
	});

	// Get daily totals (filtered by user's applied filters)
	const dailyTotals = await getDailyFocusDurations(basePipeline, params.timezone);

	// Calculate both current and longest streaks
	const { currentStreak, longestStreak, allStreaks } = calculateStreaks(
		dailyTotals,
		goalSeconds,
		params.timezone,
		selectedDaysOfWeek,
		restDays,
		customDailyFocusGoal,
		inactivePeriods
	);

	// Convert dailyTotals to a map for easy lookup
	const dailyDurationsMap: Record<string, number> = {};
	for (const { date, duration } of dailyTotals) {
		dailyDurationsMap[date] = duration;
	}

	return {
		currentStreak,
		longestStreak,
		allStreaks,
		dailyDurationsMap,
		ringId: ring.id,
		ringName: ring.name
	};
}

/**
 * Get today's focus data for all active rings
 * Endpoint: GET /streaks/today
 */
export async function getTodayFocusDataForAllRings(
	params: StreaksQueryParams,
	userId: Types.ObjectId
) {
	const userSettings = await UserSettings.findOne({ userId });
	const activeRings = getActiveRings((userSettings || {}) as UserSettingsData);

	if (activeRings.length === 0) {
		return { rings: [] };
	}

	// Fetch data for all active rings in parallel
	const ringDataPromises = activeRings.map(ring =>
		getTodayFocusDataForRing(params, userId, ring)
	);

	const ringDataArray = await Promise.all(ringDataPromises);

	return {
		rings: ringDataArray
	};
}

/**
 * Get streak history for all active rings
 * Endpoint: GET /streaks/history
 */
export async function getStreakHistoryForAllRings(
	params: StreaksQueryParams,
	userId: Types.ObjectId
) {
	const userSettings = await UserSettings.findOne({ userId });
	const activeRings = getActiveRings((userSettings || {}) as UserSettingsData);

	if (activeRings.length === 0) {
		return { rings: [] };
	}

	// Fetch data for all active rings in parallel
	const ringDataPromises = activeRings.map(ring =>
		getStreakHistoryForRing(params, userId, ring)
	);

	const ringDataArray = await Promise.all(ringDataPromises);

	return {
		rings: ringDataArray
	};
}

/**
 * Calculate streaks for combined goal tracking (no offset applied)
 * This is used for combined streaks where the offset was already applied per individual ring
 */
function calculateCombinedStreaks(
	combinedGoalMetMap: Record<string, boolean>,
	combinedFreebieMap: Record<string, boolean>,
	timezone: string
) {
	const allDates = Object.keys(combinedGoalMetMap).sort();

	if (allDates.length === 0) {
		return {
			currentStreak: { days: 0, from: null as string | null, to: null as string | null },
			longestStreak: { days: 0, from: null as string | null, to: null as string | null },
			allStreaks: []
		};
	}

	const todayDateKey = getTodayDateKey(timezone);

	let currentStreak = { days: 0, from: null as string | null, to: null as string | null };
	let longestStreak = { days: 0, from: null as string | null, to: null as string | null };
	let tempStreak = { days: 0, from: null as string | null, to: null as string | null };
	const allStreaks: Array<{ days: number; from: string | null; to: string | null }> = [];
	let lastDate: string | null = null;

	for (const date of allDates) {
		const goalMet = combinedGoalMetMap[date];
		const isFreebieDay = combinedFreebieMap[date] || false;

		// Check if this date is consecutive to the last date
		const isConsecutive = lastDate === null || date === getNextDay(lastDate);

		if (goalMet && isConsecutive) {
			// Goal met and consecutive → continue streak
			tempStreak.days += 1;
			if (!tempStreak.from) tempStreak.from = date;
			tempStreak.to = date;
			lastDate = date;
		} else if (isFreebieDay && isConsecutive) {
			// Freebie day (all failures were freebie rings) → don't increment, don't break
			lastDate = date;
		} else if (!goalMet && date === todayDateKey) {
			// Today doesn't break the streak (still have time to meet goal)
			continue;
		} else {
			// Streak broken (goal not met OR gap in dates)
			if (tempStreak.days > 0) {
				allStreaks.push({ ...tempStreak });
			}

			if (tempStreak.days >= longestStreak.days) {
				longestStreak = { ...tempStreak };
			}

			// Reset temp streak
			tempStreak = { days: 0, from: null, to: null };

			// If current day meets goal, start new streak
			if (goalMet) {
				tempStreak = { days: 1, from: date, to: date };
			}

			lastDate = date;
		}
	}

	// Check if there's a gap between the last record and today
	if (tempStreak.days > 0 && lastDate) {
		const expectedNextDay = getNextDay(lastDate);

		if (expectedNextDay !== todayDateKey && lastDate !== todayDateKey) {
			// Gap exists - save completed streak
			if (tempStreak.days > 0) {
				allStreaks.push({ ...tempStreak });
			}

			if (tempStreak.days >= longestStreak.days) {
				longestStreak = { ...tempStreak };
			}
			tempStreak = { days: 0, from: null, to: null };
		}
	}

	// Final check: if tempStreak is still ongoing, it's the current streak
	currentStreak = tempStreak;

	// Update longest if current is longer
	if (currentStreak.days >= longestStreak.days) {
		longestStreak = { ...currentStreak };
	}

	// Add current streak to allStreaks if it exists
	if (currentStreak.days > 0) {
		allStreaks.push({ ...currentStreak });
	}

	return {
		currentStreak,
		longestStreak,
		allStreaks
	};
}

/**
 * Get combined streak history for all active rings
 * A day only counts if ALL active rings meet their individual goals
 * Endpoint: GET /streaks/combined
 */
export async function getCombinedStreakHistoryForAllRings(
	params: StreaksQueryParams,
	userId: Types.ObjectId
) {
	const userSettings = await UserSettings.findOne({ userId });
	const emptyValue = {
			combinedStreaks: {
				currentStreak: { days: 0, from: null, to: null },
				longestStreak: { days: 0, from: null, to: null },
				allStreaks: []
			},
			combinedGoalMetMap: {},
			rings: []
		}

	if (!userSettings) {
		return emptyValue;
	}

	const activeRings = getActiveRings(userSettings as UserSettingsData);

	if (activeRings.length === 0) {
		return emptyValue;
	}

	// Fetch streak history for all active rings in parallel
	const ringDataPromises = activeRings.map(ring =>
		getStreakHistoryForRing(params, userId, ring)
	);

	const ringDataArray = await Promise.all(ringDataPromises);

	// Get all unique dates across all rings
	const allDatesSet = new Set<string>();
	for (const ringData of ringDataArray) {
		Object.keys(ringData.dailyDurationsMap).forEach(date => allDatesSet.add(date));
	}
	const allDates = Array.from(allDatesSet).sort();

	// Create combined goal met map - true only if ALL active rings met their goals
	const combinedGoalMetMap: Record<string, boolean> = {};
	// Track which dates are "freebie days" (all failures were from freebie rings)
	const combinedFreebieMap: Record<string, boolean> = {};

	for (const date of allDates) {
		let allRingsMet = true; // Track if ALL rings met their goals
		let hasNonFreebieFailure = false; // Track if any NON-freebie ring failed

		for (let i = 0; i < activeRings.length; i++) {
			const ring = activeRings[i];
			const ringData = ringDataArray[i];
			const duration = ringData.dailyDurationsMap[date] || 0;

			// Get ring-specific settings
			const goalSeconds = ring.goalSeconds || 3600;
			const selectedDaysOfWeek = ring.selectedDaysOfWeek;
			const restDays = ring.restDays || {};
			const customDailyFocusGoal = ring.customDailyFocusGoal || {};
			const inactivePeriods = ring.inactivePeriods || [];

			// Check if this date is a freebie day, rest day, or inactive period for this ring
			const dayOfWeek = getDayOfWeek(date, params.timezone);
			const isFreebieDay = !(selectedDaysOfWeek?.[dayOfWeek] ?? true);
			const isRestDay = restDays[date] ?? false;
			const isInactivePeriodDay = isDateInInactivePeriod(date, inactivePeriods);
			const isSpecialDay = isFreebieDay || isRestDay || isInactivePeriodDay;

			// Use custom goal for this date if set, otherwise use default goal
			const dailyGoalSeconds = customDailyFocusGoal[date] ?? goalSeconds;
			const offsetGoal = dailyGoalSeconds - 300; // 5-minute offset
			const goalMet = duration >= offsetGoal;

			// Check if goal was met
			if (!goalMet) {
				allRingsMet = false; // At least one ring didn't meet goal

				if (!isSpecialDay) {
					// Non-freebie ring didn't meet goal → BREAK streak immediately
					hasNonFreebieFailure = true;
					break;
				}
				// else: Freebie day didn't meet goal → continue checking other rings
			}
		}

		// Set combined goal met status:
		combinedGoalMetMap[date] = allRingsMet;
		// Mark as freebie day if at least one ring failed but all failures were freebie rings
		combinedFreebieMap[date] = !allRingsMet && !hasNonFreebieFailure;
	}

	// Calculate combined streaks using the new function that doesn't apply offset
	// (offset was already applied when checking each individual ring's goal)
	const { currentStreak, longestStreak, allStreaks } = calculateCombinedStreaks(
		combinedGoalMetMap,
		combinedFreebieMap,
		params.timezone
	);

	// Prepare ring data for response
	const rings = ringDataArray.map((ringData, index) => {
		const ring = activeRings[index];
		return {
			ringId: ring.id,
			ringName: ring.name,
			ringColor: ring.color,
			useThemeColor: ring.useThemeColor,
			goalSeconds: ring.goalSeconds || 3600,
			dailyDurationsMap: ringData.dailyDurationsMap,
			customDailyFocusGoal: ring.customDailyFocusGoal || {},
			restDays: ring.restDays || {},
			selectedDaysOfWeek: ring.selectedDaysOfWeek
		};
	});

	return {
		combinedStreaks: {
			currentStreak,
			longestStreak,
			allStreaks
		},
		combinedGoalMetMap,
		rings
	};
}
