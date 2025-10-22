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
