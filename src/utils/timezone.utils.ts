import { fromZonedTime } from 'date-fns-tz';

/**
 * Converts a date string to a Date object representing midnight in the specified timezone.
 * This ensures date boundaries are created in the user's timezone, not the server's timezone.
 *
 * @param dateString - Date string like "October 10, 2025" or "Nov 24, 2025"
 * @param timezone - IANA timezone string like "America/New_York"
 * @returns Date object in UTC that represents midnight in the user's timezone
 *
 * @example
 * // User in EST selects Oct 10, 2025
 * parseDateInTimezone("October 10, 2025", "America/New_York")
 * // Returns: Date object for Oct 10, 2025 00:00:00 EST = Oct 10, 2025 05:00:00 UTC
 */
export function parseDateInTimezone(dateString: string, timezone: string = 'UTC'): Date {
	// Parse the date in UTC first to extract components reliably
	const date = new Date(dateString + ' 00:00:00 UTC');
	const dateString24h = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')} 00:00:00`;
	return fromZonedTime(dateString24h, timezone);
}

/**
 * Check if a focus record crosses midnight in the user's timezone
 * @param startDate - Start date (UTC)
 * @param endDate - End date (UTC)
 * @param timezone - User's IANA timezone (e.g., 'America/New_York')
 * @returns true if the record crosses midnight in the user's timezone
 */
export function crossesMidnightInTimezone(
	startDate: Date,
	endDate: Date,
	timezone: string = 'UTC'
): boolean {
	try {
		// Convert both dates to the user's timezone and get the date string
		const startDateInTz = startDate.toLocaleDateString('en-US', {
			timeZone: timezone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		});

		const endDateInTz = endDate.toLocaleDateString('en-US', {
			timeZone: timezone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		});

		// Compare the date strings - if different, it crosses midnight
		return startDateInTz !== endDateInTz;
	} catch (error) {
		// If timezone is invalid, fall back to UTC
		console.warn(`Invalid timezone "${timezone}", falling back to UTC`);
		return startDate.toDateString() !== endDate.toDateString();
	}
}

/**
 * Calculates effective date boundaries for filtering.
 * Uses interval dates as second tier (higher priority), otherwise falls back to sidebar dates (first tier).
 * Automatically adds 1 day to end boundary to make it inclusive.
 *
 * @param params - Object containing date parameters
 * @param params.intervalStartDate - Optional interval start date (second tier)
 * @param params.intervalEndDate - Optional interval end date (second tier)
 * @param params.startDate - Optional sidebar start date (first tier)
 * @param params.endDate - Optional sidebar end date (first tier)
 * @param params.timezone - IANA timezone string
 * @returns Object with startDateBoundary and endDateBoundary (both Date | null)
 */
export function calculateEffectiveDateBoundaries(params: {
	intervalStartDate?: string | null;
	intervalEndDate?: string | null;
	startDate?: string | null;
	endDate?: string | null;
	timezone?: string | null;
}): { startDateBoundary: Date | null; endDateBoundary: Date | null } {
	const effectiveStartDate = params.intervalStartDate || params.startDate;
	const effectiveEndDate = params.intervalEndDate || params.endDate;
	const tz = params.timezone || 'UTC';

	const startDateBoundary = effectiveStartDate ? parseDateInTimezone(effectiveStartDate, tz) : null;
	let endDateBoundary: Date | null = null;
	if (effectiveEndDate) {
		endDateBoundary = parseDateInTimezone(effectiveEndDate, tz);
		endDateBoundary.setUTCDate(endDateBoundary.getUTCDate() + 1);
	}

	return { startDateBoundary, endDateBoundary };
}
