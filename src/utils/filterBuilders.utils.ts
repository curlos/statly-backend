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

// ============================================================================
// Shared Aggregation Pipeline Functions
// ============================================================================

/**
 * Adds task duration calculation stages to the pipeline.
 * This is shared logic for both challenges and medals services.
 */
export function addTaskDurationCalculation(
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

/**
 * Builds date grouping expression for MongoDB aggregation.
 * Used to group by day, week, month, or year.
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
