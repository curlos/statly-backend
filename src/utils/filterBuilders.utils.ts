// ============================================================================
// Shared Utilities - Date Grouping
// ============================================================================

/**
 * Builds date grouping expression for MongoDB aggregation.
 * Used to group by day, week, month, or year.
 * Can be used for both focus records and tasks.
 */
export function getDateGroupingExpression(
	interval: string,
	timezone: string,
	dateField: string = '$startTime'
) {
	switch (interval) {
		case 'daily':
			return {
				$dateToString: {
					format: "%B %d, %Y",
					date: dateField,
					timezone: timezone
				}
			};
		case 'weekly':
			// Get the Monday of the week (ISO week)
			return {
				$dateToString: {
					format: "%B %d, %Y",
					date: {
						$dateSubtract: {
							startDate: dateField,
							unit: "day",
							amount: {
								$subtract: [
									{ $isoDayOfWeek: { date: dateField, timezone: timezone } },
									1
								]
							}
						}
					},
					timezone: timezone
				}
			};
		case 'monthly':
			return {
				$dateToString: {
					format: "%B %Y",
					date: dateField,
					timezone: timezone
				}
			};
		case 'yearly':
			return {
				$dateToString: {
					format: "%Y",
					date: dateField,
					timezone: timezone
				}
			};
		default:
			return {
				$dateToString: {
					format: "%B %d, %Y",
					date: dateField,
					timezone: timezone
				}
			};
	}
}
