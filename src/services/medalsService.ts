import { Types } from 'mongoose';
import { FocusRecord } from '../models/FocusRecord';
import { Task } from '../models/TaskModel';
import {
	DEFAULT_DAILY_FOCUS_HOURS_MEDALS,
	DEFAULT_WEEKLY_FOCUS_HOURS_MEDALS,
	DEFAULT_MONTHLY_FOCUS_HOURS_MEDALS,
	DEFAULT_YEARLY_FOCUS_HOURS_MEDALS,
	DEFAULT_DAILY_COMPLETED_TASKS_MEDALS,
	DEFAULT_WEEKLY_COMPLETED_TASKS_MEDALS,
	DEFAULT_MONTHLY_COMPLETED_TASKS_MEDALS,
	DEFAULT_YEARLY_COMPLETED_TASKS_MEDALS,
} from '../utils/constants/medals.utils';
import {
	buildFocusSearchFilter,
	buildFocusMatchAndFilterConditions,
	buildFocusBasePipeline,
	addFocusTaskDurationCalculation,
} from '../utils/focusFilterBuilders.utils';
import { getDateGroupingExpression } from '../utils/filterBuilders.utils';
import { buildTaskSearchFilter, buildTaskMatchConditions } from '../utils/taskFilterBuilders.utils';
import { MedalsQueryParams } from '../utils/queryParams.utils';

// ============================================================================
// Date Formatting Helpers
// ============================================================================

// Helper function to remove leading zero from day in date string
// Converts "October 03, 2024" to "October 3, 2024"
function formatDateWithoutLeadingZero(dateStr: string): string {
	// Match pattern: "Month 0X, Year" and replace with "Month X, Year"
	return dateStr.replace(/(\w+)\s0(\d),\s(\d{4})/, '$1 $2, $3');
}

// For weekly intervals, we need to format the period key to match frontend format
// Format: "Sep 29, 2025 - Oct 5, 2025"
function formatWeeklyPeriodKey(mondayDateStr: string): string {
	const monday = new Date(mondayDateStr);
	const sunday = new Date(monday);
	sunday.setDate(monday.getDate() + 6);

	const formatDate = (date: Date) => {
		return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	};

	return `${formatDate(monday)} - ${formatDate(sunday)}`;
}

// ============================================================================
// Medal Calculation Functions
// ============================================================================

const GRACE_PERIOD_SECONDS = 300; // 5 minutes

function getMedalsByInterval(interval: string, type: 'focus' | 'tasks') {
	if (type === 'focus') {
		switch (interval) {
			case 'daily': return DEFAULT_DAILY_FOCUS_HOURS_MEDALS;
			case 'weekly': return DEFAULT_WEEKLY_FOCUS_HOURS_MEDALS;
			case 'monthly': return DEFAULT_MONTHLY_FOCUS_HOURS_MEDALS;
			case 'yearly': return DEFAULT_YEARLY_FOCUS_HOURS_MEDALS;
			default: return DEFAULT_DAILY_FOCUS_HOURS_MEDALS;
		}
	} else {
		switch (interval) {
			case 'daily': return DEFAULT_DAILY_COMPLETED_TASKS_MEDALS;
			case 'weekly': return DEFAULT_WEEKLY_COMPLETED_TASKS_MEDALS;
			case 'monthly': return DEFAULT_MONTHLY_COMPLETED_TASKS_MEDALS;
			case 'yearly': return DEFAULT_YEARLY_COMPLETED_TASKS_MEDALS;
			default: return DEFAULT_DAILY_COMPLETED_TASKS_MEDALS;
		}
	}
}

function calculateMedalsFromPeriodTotals(
	periodTotals: { [key: string]: number },
	medals: any[],
	interval: string,
	type: 'focus' | 'tasks'
) {
	const medalResults: any = {};

	// Initialize all medals with empty arrays
	medals.forEach(medal => {
		medalResults[medal.name] = {
			type: type,
			intervalsEarned: []
		};
	});

	// Check each period against medal thresholds
	Object.entries(periodTotals).forEach(([periodKey, total]) => {
		// Format period key based on interval type
		let formattedPeriodKey = periodKey;
		if (interval === 'weekly') {
			formattedPeriodKey = formatWeeklyPeriodKey(periodKey);
		} else if (interval === 'daily') {
			// Remove leading zeros from day (e.g., "October 03, 2024" -> "October 3, 2024")
			formattedPeriodKey = formatDateWithoutLeadingZero(periodKey);
		}

		medals.forEach(medal => {
			const threshold = type === 'focus' ? medal.requiredDuration : medal.requiredCompletedTasks;
			const adjustedTotal = type === 'focus' ? total + GRACE_PERIOD_SECONDS : total;

			if (adjustedTotal >= threshold) {
				medalResults[medal.name].intervalsEarned.push(formattedPeriodKey);
			}
		});
	});

	// Sort intervalsEarned arrays from newest to oldest
	Object.values(medalResults).forEach((medalData: any) => {
		medalData.intervalsEarned.sort((a: string, b: string) => {
			const dateA = new Date(a);
			const dateB = new Date(b);
			return dateB.getTime() - dateA.getTime(); // Newest first
		});
	});

	return medalResults;
}

// ============================================================================
// Split Midnight-Crossing Records for Medals
// ============================================================================

/**
 * Splits midnight-crossing records into multiple documents (one per period) for accurate
 * duration attribution when grouping by intervals (daily/weekly/monthly/yearly).
 *
 * For records where crossesMidnight === true:
 * - Generates multiple documents, one for each period the record spans
 * - Each split document has adjusted startTime, duration, and tasks for that period
 *
 * For records where crossesMidnight === false:
 * - Pass through unchanged
 */
function splitMidnightCrossingRecordsForMedals(
	pipeline: any[],
	interval: string,
	timezone: string
) {
	// Step 1: Generate split documents for midnight-crossing records
	pipeline.push({
		$addFields: {
			splitDocuments: {
				$cond: {
					if: { $eq: ["$crossesMidnight", true] },
					then: {
						// For daily interval: split by days
						$let: {
							vars: {
								// Calculate how many days this record spans
								startDate: {
									$dateTrunc: {
										date: "$startTime",
										unit: "day",
										timezone: timezone
									}
								},
								endDate: {
									$dateTrunc: {
										date: "$endTime",
										unit: "day",
										timezone: timezone
									}
								}
							},
							in: {
								// Generate array of split documents
								// $map: Loop over an array and create a split document for each day
								$map: {
									// input: The array to loop over - creates [0, 1] for a 2-day span, [0, 1, 2] for 3-day span, etc.
									input: {
										$range: [
											0,
											{
												// Number of days touched = dateDiff + 1
												// Example: Oct 16 11:22 PM → Oct 17 12:38 AM
												// - dateDiff = 1 (Oct 16 midnight to Oct 17 midnight = 1 day difference)
												// - But touches 2 days (Oct 16 AND Oct 17), so: 1 + 1 = 2
												$add: [
													{
														$dateDiff: {
															startDate: "$$startDate",
															endDate: "$$endDate",
															unit: "day",
															timezone: timezone
														}
													},
													1 // Converts "days of difference" to "number of days touched"
												]
											}
										]
									},
									as: "dayOffset",
									in: {
										$let: {
											vars: {
												// For each dayOffset, calculate when that day starts and ends (midnight to midnight)
												// Example: dayOffset=0 → Oct 16 midnight to Oct 17 midnight
												//          dayOffset=1 → Oct 17 midnight to Oct 18 midnight
												// These boundaries are independent of the record's actual start/end times
												periodStart: {
													$dateAdd: {
														startDate: "$$startDate",
														unit: "day",
														amount: "$$dayOffset",
														timezone: timezone
													}
												},
												periodEnd: {
													$dateAdd: {
														startDate: "$$startDate",
														unit: "day",
														amount: { $add: ["$$dayOffset", 1] },
														timezone: timezone
													}
												}
											},
											in: {
												$let: {
													vars: {
														// Clip record boundaries to this period
														effectiveStart: { $max: ["$startTime", "$$periodStart"] },
														effectiveEnd: { $min: ["$endTime", "$$periodEnd"] }
													},
													in: {
														// Build the split document
														startTime: "$$periodStart", // Use period start for grouping
														endTime: "$endTime",
														duration: {
															// Calculate duration for this period only
															$divide: [
																{ $subtract: ["$$effectiveEnd", "$$effectiveStart"] },
																1000
															]
														},
														tasks: {
															// Adjust each task's duration for this period (same clipping logic as record, but per task)
															$map: {
																input: "$tasks",
																as: "task",
																in: {
																	$mergeObjects: [
																		"$$task",
																		{
																			duration: {
																				$let: {
																					vars: {
																						// Clip task times to period boundaries
																						// Example: Task 11:50 PM → 12:10 AM, Period Oct 16
																						taskEffectiveStart: { $max: ["$$task.startTime", "$$periodStart"] }, // max(11:50 PM, Oct 16 midnight) = 11:50 PM
																						taskEffectiveEnd: { $min: ["$$task.endTime", "$$periodEnd"] }          // min(12:10 AM, Oct 17 midnight) = midnight
																					},
																					in: {
																						$cond: {
																							// Check if task overlaps with this period
																							// If task is entirely on Oct 17 but we're evaluating Oct 16:
																							//   effectiveStart = max(12:05 AM, Oct 16 midnight) = 12:05 AM
																							//   effectiveEnd = min(12:10 AM, Oct 17 midnight) = midnight
																							//   midnight < 12:05 AM → no overlap
																							if: { $gte: ["$$taskEffectiveEnd", "$$taskEffectiveStart"] },
																							then: {
																								// Task overlaps: calculate duration for this period only
																								// Example: midnight - 11:50 PM = 10 minutes
																								$divide: [
																									{ $subtract: ["$$taskEffectiveEnd", "$$taskEffectiveStart"] },
																									1000
																								]
																							},
																							// Task doesn't overlap: return 0 (it'll get proper duration on Oct 17 split)
																							else: 0
																						}
																					}
																				}
																			}
																		}
																	]
																}
															}
														},
														// Preserve other fields
														crossesMidnight: "$crossesMidnight",
														_id: "$_id"
													}
												}
											}
										}
									}
								}
							}
						}
					},
					else: [
						{
							// For non-midnight-crossing records, keep as single document
							startTime: "$startTime",
							endTime: "$endTime",
							duration: "$duration",
							tasks: "$tasks",
							crossesMidnight: "$crossesMidnight",
							_id: "$_id"
						}
					]
				}
			}
		}
	});

	// Step 2: Unwind split documents into separate records
	pipeline.push({
		$unwind: "$splitDocuments"
	});

	// Step 3: Replace root with split document
	pipeline.push({
		$replaceRoot: {
			newRoot: "$splitDocuments"
		}
	});
}

// ============================================================================
// Main Service Methods
// ============================================================================

export async function getFocusHoursMedals(params: MedalsQueryParams, userId: Types.ObjectId) {
	// Build filters
	const searchFilter = buildFocusSearchFilter(params.searchQuery);
	const { focusRecordMatchConditions, taskFilterConditions } = buildFocusMatchAndFilterConditions(
		userId,
		params.taskId,
		params.projectIds,
		params.startDate,
		params.endDate,
		params.taskIdIncludeFocusRecordsFromSubtasks,
		params.focusAppSources,
		params.crossesMidnight,
		null,
		null,
		params.emotions,
		params.timezone
	);

	// Build aggregation pipeline
	const pipeline = buildFocusBasePipeline(searchFilter, focusRecordMatchConditions);

	// Split midnight-crossing records into separate documents for accurate period attribution
	splitMidnightCrossingRecordsForMedals(pipeline, params.interval, params.timezone);

	// Add task duration calculation (shared logic)
	addFocusTaskDurationCalculation(pipeline, taskFilterConditions);

	// Group by period and sum task durations
	pipeline.push({
		$group: {
			_id: getDateGroupingExpression(params.interval, params.timezone),
			totalDuration: { $sum: "$tasksDuration" }
		}
	});

	// Execute aggregation
	// Example results: [
	//   { _id: 'October 15, 2025', totalDuration: 32400 },
	//   { _id: 'October 16, 2025', totalDuration: 18000 }
	// ]
	const results = await FocusRecord.aggregate(pipeline);

	// Convert results to period totals object
	const periodTotals: { [key: string]: number } = {};
	results.forEach(result => {
		periodTotals[result._id] = result.totalDuration;
	});

	// Calculate medals
	const medals = getMedalsByInterval(params.interval, 'focus');
	return calculateMedalsFromPeriodTotals(periodTotals, medals, params.interval, 'focus');
}

export async function getCompletedTasksMedals(params: MedalsQueryParams, userId: Types.ObjectId) {
	// Build filters using shared builder
	const searchFilter = buildTaskSearchFilter(params.searchQuery);
	const matchFilter = buildTaskMatchConditions(
		userId,
		params.taskId,
		params.projectIds,
		params.startDate,
		params.endDate,
		params.taskIdIncludeFocusRecordsFromSubtasks,
		params.toDoListAppSources,
		'completedTime',
		undefined,
		undefined,
		params.timezone
	);

	// Build aggregation pipeline
	const pipeline: any[] = [];

	if (searchFilter) {
		pipeline.push({ $match: searchFilter });
	}

	pipeline.push({ $match: matchFilter });

	// Group by period and count tasks
	pipeline.push({
		$group: {
			_id: getDateGroupingExpression(params.interval, params.timezone, '$completedTime'),
			taskCount: { $sum: 1 }
		}
	});

	// Execute aggregation
	const results = await Task.aggregate(pipeline);

	// Convert results to period totals object
	const periodTotals: { [key: string]: number } = {};
	results.forEach(result => {
		periodTotals[result._id] = result.taskCount;
	});

	// Calculate medals
	const medals = getMedalsByInterval(params.interval, 'tasks');
	return calculateMedalsFromPeriodTotals(periodTotals, medals, params.interval, 'tasks');
}
