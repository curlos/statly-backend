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
 * Helper function to build date range filter conditions
 * @param startDate - Start date string (optional)
 * @param endDate - End date string (optional)
 * @returns Date filter object or null if no dates provided
 */
function buildDateRangeFilter(startDate?: string, endDate?: string) {
	if (!startDate && !endDate) {
		return null;
	}

	const dateFilter: any = {};

	if (startDate) {
		const startBoundary = new Date(startDate);
		startBoundary.setHours(0, 0, 0, 0); // Beginning of day
		dateFilter.$gte = startBoundary;
	}

	if (endDate) {
		const endBoundary = new Date(endDate);
		endBoundary.setHours(23, 59, 59, 999); // End of day
		dateFilter.$lte = endBoundary;
	}

	return dateFilter;
}

// ============================================================================
// Tasks - Match Conditions
// ============================================================================

export function buildTaskMatchConditions(
	taskId: string | undefined,
	projectIds: string[],
	startDate: string | undefined,
	endDate: string | undefined,
	taskIdIncludeSubtasks: boolean,
	appSources: string[],
	timeField: 'completedTime' | 'createdTime' = 'completedTime',
	intervalStartDate?: string,
	intervalEndDate?: string
) {
	const matchFilter: any = {};

	// Only apply completedTime requirement and date filter if timeField is 'completedTime'. Otherwise, if timeField is 'createdTime', skip date filtering entirely.
	if (timeField === 'completedTime') {
		matchFilter.completedTime = { $exists: true, $ne: null };

		// Two-tier date filtering:
		// 1. First tier: Filter Sidebar dates (startDate, endDate) - broad filter
		// 2. Second tier: Interval Dropdown dates (intervalStartDate, intervalEndDate) - narrower filter
		// Both filters must be satisfied (AND logic)

		const dateConditions: any[] = [];

		// Add first tier date range filter (Filter Sidebar)
		const firstTierFilter = buildDateRangeFilter(startDate, endDate);
		if (firstTierFilter) {
			dateConditions.push({ completedTime: firstTierFilter });
		}

		// Add second tier date range filter (Interval Dropdown)
		const secondTierFilter = buildDateRangeFilter(intervalStartDate, intervalEndDate);
		if (secondTierFilter) {
			dateConditions.push({ completedTime: secondTierFilter });
		}

		// Apply date filters
		if (dateConditions.length === 1) {
			// Only one tier provided, apply directly
			matchFilter.completedTime = {
				...matchFilter.completedTime,
				...dateConditions[0].completedTime
			};
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
