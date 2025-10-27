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
// Tasks - Match Conditions
// ============================================================================

export function buildTaskMatchConditions(
	taskId: string | undefined,
	projectIds: string[],
	startDate: string | undefined,
	endDate: string | undefined,
	taskIdIncludeSubtasks: boolean,
	appSources: string[],
	timeField: 'completedTime' | 'createdTime' = 'completedTime'
) {
	const matchFilter: any = {};

	// Only apply completedTime requirement and date filter if timeField is 'completedTime'. Otherwise, if timeField is 'createdTime', skip date filtering entirely.
	if (timeField === 'completedTime') {
		matchFilter.completedTime = { $exists: true, $ne: null };

		// Add date range filter for completedTime
		if (startDate && endDate) {
			const startDateObj = new Date(startDate);
			const endDateObj = new Date(endDate);

			// Set start to beginning of day and end to end of day
			startDateObj.setHours(0, 0, 0, 0);
			endDateObj.setHours(23, 59, 59, 999);

			matchFilter.completedTime = {
				...matchFilter.completedTime,
				$gte: startDateObj,
				$lte: endDateObj
			};
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
