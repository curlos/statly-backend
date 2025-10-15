// ============================================================================
// App Source Mapping
// ============================================================================

export const APP_SOURCE_MAPPING: Record<string, string> = {
	'session-app': 'FocusRecordSession',
	'be-focused-app': 'FocusRecordBeFocused',
	'forest-app': 'FocusRecordForest',
	'tide-ios-app': 'FocusRecordTide',
	'TickTick': 'FocusRecordTickTick'
};

// ============================================================================
// Filter Builders
// ============================================================================

export function buildSearchFilter(searchQuery?: string) {
	if (!searchQuery || !searchQuery.trim()) {
		return null;
	}

	const trimmedQuery = searchQuery.trim();
	return {
		$or: [
			{ note: { $regex: trimmedQuery, $options: 'i' } },
			{ tasks: { $elemMatch: { title: { $regex: trimmedQuery, $options: 'i' } } } },
			{ tasks: { $elemMatch: { projectName: { $regex: trimmedQuery, $options: 'i' } } } }
		]
	};
}

export function buildMatchAndFilterConditions(
	taskId: string | undefined,
	projectIds: string[],
	startDate: string | undefined,
	endDate: string | undefined,
	taskIdIncludeFocusRecordsFromSubtasks: boolean,
	appSources: string[]
) {
	const focusRecordMatchConditions: any = {};
	const taskFilterConditions: any[] = [];

	// Add date range to match conditions
	if (startDate || endDate) {
		focusRecordMatchConditions.startTime = {};
		if (startDate) {
			focusRecordMatchConditions.startTime.$gte = new Date(startDate);
		}
		if (endDate) {
			const endDateTime = new Date(endDate);
			endDateTime.setDate(endDateTime.getDate() + 1);
			focusRecordMatchConditions.startTime.$lt = endDateTime;
		}
	}

	// Add app source filter
	if (appSources.length > 0) {
		focusRecordMatchConditions.source = { $in: appSources };
	}

	// Add project filter
	if (projectIds.length > 0) {
		focusRecordMatchConditions["tasks.projectId"] = { $in: projectIds };
		taskFilterConditions.push({ $in: ["$$task.projectId", projectIds] });
	}

	// Add task filter
	if (taskId) {
		if (taskIdIncludeFocusRecordsFromSubtasks) {
			focusRecordMatchConditions.$or = [
				{ "tasks.taskId": taskId },
				{ "tasks.ancestorIds": taskId }
			];
			taskFilterConditions.push({
				$or: [
					{ $eq: ["$$task.taskId", taskId] },
					{ $in: [taskId, "$$task.ancestorIds"] }
				]
			});
		} else {
			focusRecordMatchConditions["tasks.taskId"] = taskId;
			taskFilterConditions.push({ $eq: ["$$task.taskId", taskId] });
		}
	}

	return { focusRecordMatchConditions, taskFilterConditions };
}

export function buildBasePipeline(searchFilter: any, focusRecordMatchConditions: any) {
	const pipeline: any[] = [];

	if (searchFilter) {
		pipeline.push({ $match: searchFilter });
	}

	if (Object.keys(focusRecordMatchConditions).length > 0) {
		pipeline.push({ $match: focusRecordMatchConditions });
	}

	return pipeline;
}
