// ============================================================================
// Focus Records - App Source Mapping
// ============================================================================

export const APP_SOURCE_MAPPING: Record<string, string> = {
	'session-app': 'FocusRecordSession',
	'be-focused-app': 'FocusRecordBeFocused',
	'forest-app': 'FocusRecordForest',
	'tide-ios-app': 'FocusRecordTide',
	'TickTick': 'FocusRecordTickTick'
};

// ============================================================================
// Focus Records - Search Filter
// ============================================================================

export function buildFocusSearchFilter(searchQuery?: string) {
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

// ============================================================================
// Focus Records - Match and Filter Conditions
// ============================================================================

export function buildFocusMatchAndFilterConditions(
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

// ============================================================================
// Focus Records - Base Pipeline
// ============================================================================

export function buildFocusBasePipeline(searchFilter: any, focusRecordMatchConditions: any) {
	const pipeline: any[] = [];

	if (searchFilter) {
		pipeline.push({ $match: searchFilter });
	}

	if (Object.keys(focusRecordMatchConditions).length > 0) {
		pipeline.push({ $match: focusRecordMatchConditions });
	}

	return pipeline;
}

// ============================================================================
// Focus Records - Task Duration Calculation
// ============================================================================

/**
 * Adds task duration calculation stages to the pipeline.
 * This is shared logic for both challenges and medals services.
 */
export function addFocusTaskDurationCalculation(
	pipeline: any[],
	taskFilterConditions: any[]
) {
	const hasTaskOrProjectFilters = taskFilterConditions.length > 0;

	if (hasTaskOrProjectFilters) {
		// Filter tasks based on conditions
		pipeline.push({
			$addFields: {
				filteredTasks: {
					$filter: {
						input: "$tasks",
						as: "task",
						cond: taskFilterConditions.length > 1
							? { $and: taskFilterConditions }
							: taskFilterConditions[0]
					}
				}
			}
		});

		// Calculate duration from filtered tasks
		pipeline.push({
			$addFields: {
				tasksDuration: {
					$reduce: {
						input: "$filteredTasks",
						initialValue: 0,
						in: { $add: ["$$value", "$$this.duration"] }
					}
				}
			}
		});
	} else {
		// No filters: calculate duration from all tasks
		pipeline.push({
			$addFields: {
				tasksDuration: {
					$reduce: {
						input: "$tasks",
						initialValue: 0,
						in: { $add: ["$$value", "$$this.duration"] }
					}
				}
			}
		});
	}
}
