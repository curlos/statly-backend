import axios from 'axios';
import { Types } from 'mongoose';
import { sortArrayByProperty, arrayToObjectByKey, handleTickTickApiCall } from './helpers.utils';
import FocusRecordTickTick from '../models/FocusRecord';
import Task from '../models/TaskModel';
import { buildAncestorData } from './task.utils';
import { getJsonData } from './mongoose.utils';
import { PipelineStage } from 'mongoose';
import { SessionRecordRaw, BeFocusedRecordRaw, ForestRecordRaw, TideRecordRaw } from '../types/externalApis';
import { parseDateInTimezone } from './timezone.utils';

// new Date(2705792451783) = September 28, 2055. This is to make sure all my tasks are fetched properly. I doubt I'll have to worry about this expiring since I'll be long past TickTick and humans coding anything will be a thing of the past by then with GPT-20 out by then.
const farAwayDateInMs = 2705792451783;

export const fetchTickTickFocusRecords = async (cookie: string, userId: Types.ObjectId) => {
	const localFocusData = await FocusRecordTickTick.find({ userId }).sort({ startTime: -1 }).limit(21).lean()

	let fromMs = 0;
	let toMs = farAwayDateInMs;

	// Check if localFocusData exists and has at least 21 records
	if (localFocusData && localFocusData.length > 20) {
		// Get the local focus data from MongoDB and since the focus records are already sorted by startTime, get the very first focus record in the array and get it's startTime and set the "toMs" variable to that startTime in MS - 1 ms.
		const semiRecentFocusRecord = localFocusData[20];
		const semiRecentStartTimeDate = new Date(semiRecentFocusRecord.startTime);
		const semiRecentStartTimeInMs = semiRecentStartTimeDate.getTime();

		const todayMs = new Date().getTime();

		// Subtract 1 MS to not include latest focus record in our search.
		fromMs = semiRecentStartTimeInMs;
		toMs = todayMs;
	} else {
		// If no local focus records or less than 21, fetch from the beginning
		fromMs = 0;
		toMs = farAwayDateInMs;
	}

	const [focusDataPomos, focusDataStopwatch] = await handleTickTickApiCall(() => Promise.all([
		axios.get(`https://api.ticktick.com/api/v2/pomodoros?from=${fromMs}&to=${toMs}`, {
			headers: {
				Cookie: cookie,
			},
		}),
		axios.get(`https://api.ticktick.com/api/v2/pomodoros/timing?from=${fromMs}&to=${toMs}`, {
			headers: {
				Cookie: cookie,
			},
		})
	]));

	// Add trackingMode to each record before combining
	const pomodorosWithTrackingMode = focusDataPomos.data.map((record: Record<string, unknown>) => ({
		...record,
		trackingMode: 'pomodoro' as const
	}));

	const stopwatchesWithTrackingMode = focusDataStopwatch.data.map((record: Record<string, unknown>) => ({
		...record,
		trackingMode: 'stopwatch' as const
	}));

	const tickTickOneApiFocusData = [...pomodorosWithTrackingMode, ...stopwatchesWithTrackingMode];
	const tickTickOneApiFocusDataById = arrayToObjectByKey(tickTickOneApiFocusData, 'id');
	const localFocusDataById = arrayToObjectByKey(localFocusData, 'id');

	// This is necessary and I can't just check to add focus records that are already in the DB like I did before because I often times edit my focus record after it's been created by updating the focus note. So, if I don't have this logic, then I won't have the latest focus note logic. I'm probably re-writing through around 20 focus records.
	const localFocusDataWithLatestInfo = localFocusData.map((focusRecord) => {
		const focusRecordFromApi = tickTickOneApiFocusDataById[focusRecord.id];

		if (focusRecordFromApi) {
			return focusRecordFromApi;
		}

		return focusRecord;
	});

	// Filter out any focus records that are already stored in the database from the API's returned focus records.
	const tickTickOneApiFocusDataNoDupes = tickTickOneApiFocusData.filter((focusData) => {
		const isNotAlreadyInDatabase = localFocusDataById[focusData.id];
		return !isNotAlreadyInDatabase;
	});

	const allFocusData = [...tickTickOneApiFocusDataNoDupes, ...localFocusDataWithLatestInfo];
	const sortedAllFocusData = sortArrayByProperty(allFocusData, 'startTime');

	return sortedAllFocusData;
};

// Helper types for focus records with tasks
interface FocusRecordWithTasks {
	startTime: string | Date;
	endTime: string | Date;
	tasks?: Array<{ taskId?: string; title?: string; completedTime?: string | Date }>;
	[key: string]: unknown;
}

interface CompletedTask {
	title: string;
	completedTime: Date;
}

// Helper function to add ancestor tasks and completed tasks to focus records
export const addAncestorAndCompletedTasks = async (focusRecords: FocusRecordWithTasks[], userId: Types.ObjectId) => {
	// Extract all unique task IDs from focus records
	const allTaskIds = new Set<string>();
	focusRecords.forEach((record) => {
		if (record.tasks && Array.isArray(record.tasks)) {
			record.tasks.forEach((task) => {
				if (task.taskId) {
					allTaskIds.add(task.taskId);
				}
			});
		}
	});

	// Fetch full task documents to get ancestorIds
	const tasksWithAncestors = await Task.find({ userId, id: { $in: Array.from(allTaskIds) } })
		.select('id title parentId ancestorIds projectId')
		.lean();

	// Build ancestor data
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { ancestorTasksById } = await buildAncestorData(tasksWithAncestors as any, userId);

	// Add the child tasks themselves to the map
	tasksWithAncestors.forEach((task) => {
		ancestorTasksById[task.id] = {
			id: task.id,
			title: task.title,
			parentId: task.parentId ?? null,
			ancestorIds: task.ancestorIds,
			projectId: task.projectId ?? null
		};
	});

	// Add completed tasks to each focus record (optimized with grouping by date)
	const offsetMs = 10 * 60 * 1000; // 10-minute buffer
	const oneDayMs = 24 * 60 * 60 * 1000; // 1 day in milliseconds

	// If no focus records, return early
	if (focusRecords.length === 0) {
		return { focusRecordsWithCompletedTasks: [], ancestorTasksById };
	}

	// Create time ranges with buffer for each focus record
	const timeRanges = focusRecords.map((r) => ({
		start: new Date(r.startTime).getTime() - offsetMs,
		end: new Date(r.endTime).getTime() + offsetMs
	}));

	// Sort by start time
	timeRanges.sort((a, b) => a.start - b.start);

	// Merge ranges if gap is less than 1 day
	const mergedRanges: { start: number, end: number }[] = [];
	let currentRange = { start: timeRanges[0].start, end: timeRanges[0].end };

	for (let i = 1; i < timeRanges.length; i++) {
		// Calculate time gap between end of current range and start of next focus record
		// Example: FR1 ends at 3:00 PM, FR2 starts at 5:00 PM → gap = 2 hours
		// Example: FR1 ends at 3:00 PM, FR2 starts at 2:00 PM → gap = negative (overlap)
		const gap = timeRanges[i].start - currentRange.end;

		if (gap < oneDayMs) {
			// Merge: extend current range to include this one
			// Use Math.max because focus records can overlap - if a shorter session starts
			// during a longer session, we need to keep the furthest end time
			const furthestEndTime = Math.max(currentRange.end, timeRanges[i].end);
			currentRange.end = furthestEndTime;
		} else {
			// Gap too large: save current range and start new one
			mergedRanges.push(currentRange);
			currentRange = { start: timeRanges[i].start, end: timeRanges[i].end };
		}
	}
	// Don't forget the last range
	mergedRanges.push(currentRange);

	// Query all merged ranges in a single query using $or for better performance
	let allCompletedTasks: CompletedTask[] = [];

	if (mergedRanges.length === 0) {
		// No ranges to query
		allCompletedTasks = [];
	} else if (mergedRanges.length === 1) {
		// Single range - use simple query
		const tasks = await Task.find({
			userId,
			completedTime: {
				$exists: true,
				$ne: null,
				$gte: new Date(mergedRanges[0].start),
				$lte: new Date(mergedRanges[0].end)
			}
		})
		.sort({ completedTime: 1 })
		.select('title completedTime -_id')
		.lean();
		allCompletedTasks = tasks as CompletedTask[];
	} else {
		// Multiple ranges - use $or to query all at once (single network roundtrip)
		const orConditions = mergedRanges.map(range => ({
			completedTime: {
				$exists: true,
				$ne: null,
				$gte: new Date(range.start),
				$lte: new Date(range.end)
			}
		}));

		const tasks = await Task.find({ userId, $or: orConditions })
			.sort({ completedTime: 1 })
			.select('title completedTime -_id')
			.lean();
		allCompletedTasks = tasks as CompletedTask[];
	}

	// Group completed tasks by date (YYYY-MM-DD) for faster lookups
	const tasksByDate = new Map<string, CompletedTask[]>();
	allCompletedTasks.forEach((task) => {
		const taskDate = new Date(task.completedTime);
		const dateKey = `${taskDate.getFullYear()}-${String(taskDate.getMonth() + 1).padStart(2, '0')}-${String(taskDate.getDate()).padStart(2, '0')}`;

		if (!tasksByDate.has(dateKey)) {
			tasksByDate.set(dateKey, []);
		}
		tasksByDate.get(dateKey)!.push(task);
	});

	// Map completed tasks to each focus record
	const focusRecordsWithCompletedTasks = focusRecords.map((record) => {
		const startTime = new Date(record.startTime);
		const endTime = new Date(record.endTime);
		const startTimeWithOffset = new Date(startTime.getTime() - offsetMs);
		const endTimeWithOffset = new Date(endTime.getTime() + offsetMs);

		// Get unique dates that this focus record spans
		const relevantDates = new Set<string>();
		const currentDate = new Date(startTimeWithOffset);
		const endDate = new Date(endTimeWithOffset);

		while (currentDate <= endDate) {
			const dateKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
			relevantDates.add(dateKey);
			currentDate.setDate(currentDate.getDate() + 1);
		}

		// Collect tasks only from relevant dates and filter by time
		// Note: Tasks are already sorted by completedTime from the DB query
		const completedTasks: CompletedTask[] = [];
		relevantDates.forEach(dateKey => {
			const tasksForDate = tasksByDate.get(dateKey) || [];
			tasksForDate.forEach((task) => {
				const taskTime = new Date(task.completedTime).getTime();
				if (taskTime >= startTimeWithOffset.getTime() && taskTime <= endTimeWithOffset.getTime()) {
					completedTasks.push(task);
				}
			});
		});

		// Remove completedTime from tasks before adding to focus record (frontend only needs title)
		const completedTasksForResponse = completedTasks.map(task => ({
			title: task.title
		}));

		return {
			...record,
			completedTasks: completedTasksForResponse
		};
	});

	return { focusRecordsWithCompletedTasks, ancestorTasksById };
}

// Helper function to fetch session app focus records with no breaks
export const fetchSessionFocusRecordsWithNoBreaks = async (): Promise<SessionRecordRaw[]> => {
	const sessionAppFocusData = await getJsonData('session-app-data') as SessionRecordRaw[];

	const focusRecordsWithNoBreaks = sessionAppFocusData.filter(
		(focusRecord) => focusRecord['type'] === 'fullFocus'
	);

	return focusRecordsWithNoBreaks;
}

// Helper function to fetch be-focused app focus records
export const fetchBeFocusedAppFocusRecords = async (): Promise<BeFocusedRecordRaw[]> => {
	const beFocusedAppFocusData = await getJsonData('be-focused-app-data') as BeFocusedRecordRaw[];
	return beFocusedAppFocusData;
}

// Helper function to fetch forest app focus records with optional date filter
export const fetchForestAppFocusRecords = async (beforeSessionApp?: boolean): Promise<ForestRecordRaw[]> => {
	const forestAppFocusData = await getJsonData('forest-app-data') as ForestRecordRaw[];

	if (beforeSessionApp) {
		const cutoffDate = new Date('April 14, 2021');

		const filteredData = forestAppFocusData.filter((item) => {
			const itemStartDate = new Date(item['Start Time'] as string);
			// Return true if the item's start date is before the cutoff date
			return itemStartDate < cutoffDate;
		});

		return filteredData;
	}

	return forestAppFocusData;
}

// Helper function to fetch tide app focus records
export const fetchTideAppFocusRecords = async (): Promise<TideRecordRaw[]> => {
	const tideAppFocusData = await getJsonData('tide-ios-app-focus-records') as TideRecordRaw[];
	return tideAppFocusData;
}

// ============================================================================
// Duration Adjustment Helper for Midnight-Crossing Records
// ============================================================================

/**
 * Adds duration adjustment stages to a pipeline for records that cross midnight beyond date boundaries.
 * Only adjusts records where crossesMidnight === true.
 */
export function addMidnightRecordDurationAdjustment(pipeline: PipelineStage[], startDateBoundary: Date | null, endDateBoundary: Date | null) {
	// Only process records that cross midnight - everything inside uses conditional logic
	// based on the crossesMidnight field
	pipeline.push({
		$addFields: {
			// Calculate effective start and end times (only for crossesMidnight records)
			effectiveStartTime: {
				$cond: {
					if: { $eq: ["$crossesMidnight", true] },
					then: startDateBoundary
						? { $max: ["$startTime", startDateBoundary] }
						: "$startTime",
					else: "$startTime"
				}
			},
			effectiveEndTime: {
				$cond: {
					if: { $eq: ["$crossesMidnight", true] },
					then: endDateBoundary
						? { $min: ["$endTime", endDateBoundary] }
						: "$endTime",
					else: "$endTime"
				}
			}
		}
	});

	pipeline.push({
		$addFields: {
			// First, adjust each task's duration using its actual start/end times
			adjustedTasks: {
				$cond: {
					if: { $eq: ["$crossesMidnight", true] },
					then: {
						$map: {
							input: "$tasks",
							as: "task",
							in: {
								$mergeObjects: [
									"$$task",
									{
										duration: {
											// Calculate task's effective time range within the date boundaries
											$let: {
												vars: {
													taskEffectiveStart: startDateBoundary
														? { $max: ["$$task.startTime", startDateBoundary] }
														: "$$task.startTime",
													taskEffectiveEnd: endDateBoundary
														? { $min: ["$$task.endTime", endDateBoundary] }
														: "$$task.endTime"
												},
												in: {
													// Only count duration if task overlaps with the date range
													$cond: {
														if: { $gte: ["$$taskEffectiveEnd", "$$taskEffectiveStart"] },
														then: {
															$divide: [
																{ $subtract: ["$$taskEffectiveEnd", "$$taskEffectiveStart"] },
																1000
															]
														},
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
					else: "$tasks"
				}
			}
		}
	});

	pipeline.push({
		$addFields: {
			// Calculate adjusted duration as sum of adjusted task durations
			// This is better than using effectiveStartTime/effectiveEndTime because:
			// 1. Task durations already account for pauses (pauseDuration is for entire record, not clipped portion)
			// 2. Tasks may not span the entire clipped time range
			adjustedDuration: {
				$cond: {
					if: { $eq: ["$crossesMidnight", true] },
					then: {
						$reduce: {
							input: "$adjustedTasks",
							initialValue: 0,
							in: { $add: ["$$value", "$$this.duration"] }
						}
					},
					else: "$duration"
				}
			}
		}
	});

	// Replace duration and tasks with adjusted versions
	pipeline.push({
		$addFields: {
			duration: "$adjustedDuration",
			tasks: "$adjustedTasks"
		}
	});
}

/**
 * Year-agnostic midnight crossing adjustment
 * Clips records based on month-day boundaries using each record's own year
 *
 * For example, with December filter (month=12, startDay=1, endDay=31):
 * - Record from Dec 31, 2021 11pm → Jan 5, 2022 clips to Dec 31, 2021 end-of-day
 * - Record from Dec 31, 2024 11pm → Jan 5, 2025 clips to Dec 31, 2024 end-of-day
 *
 * @param pipeline - The aggregation pipeline to modify
 * @param startMonth - Start month (1-12)
 * @param startDay - Start day of month (1-31)
 * @param endMonth - End month (1-12)
 * @param endDay - End day of month (1-31)
 * @param timezone - IANA timezone string
 */
export function addYearAgnosticMidnightAdjustment(
	pipeline: PipelineStage[],
	startDate: string,
	endDate: string,
	timezone: string
) {
	// Parse dates to extract month/day components
	const startParsed = parseDateInTimezone(startDate, timezone);
	const endParsed = parseDateInTimezone(endDate, timezone);
	const startMonth = startParsed.getUTCMonth() + 1; // getUTCMonth is 0-indexed
	const startDay = startParsed.getUTCDate();
	const endMonth = endParsed.getUTCMonth() + 1;
	const endDay = endParsed.getUTCDate();

	// Determine if the range crosses year boundary (e.g., Dec 25 → Jan 5)
	const queryFilterCrossesYearBoundary = startMonth > endMonth || (startMonth === endMonth && startDay > endDay);

	pipeline.push({
		$addFields: {
			adjustedTasks: {
				$cond: {
					if: { $eq: ["$crossesMidnight", true] },
					then: {
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
													// Extract task's year, month, day from its start time
													taskStartYear: { $year: { date: "$$task.startTime", timezone } },
													taskStartMonth: { $month: { date: "$$task.startTime", timezone } },
													taskStartDay: { $dayOfMonth: { date: "$$task.startTime", timezone } },
													taskEndYear: { $year: { date: "$$task.endTime", timezone } },
													taskEndMonth: { $month: { date: "$$task.endTime", timezone } },
													taskEndDay: { $dayOfMonth: { date: "$$task.endTime", timezone } },
												},
												in: {
													$let: {
														vars: {
															// Detect if task wraps around year boundary in year-agnostic terms
															// This happens when task month > query month (e.g., Dec > Jan means task is from "previous year")
															taskWrapsYearBoundary: { $gt: ["$$taskStartMonth", startMonth] }
														},
														in: {
															$let: {
																vars: {
																	// Calculate clip boundaries
																	// If task wraps year boundary, query occurs in next year
																	clipStartYear: {
																		$cond: {
																			if: "$$taskWrapsYearBoundary",
																			then: { $add: ["$$taskStartYear", 1] },  // Next year
																			else: "$$taskStartYear"                   // Same year
																		}
																	},
																	clipEndYear: {
																		$cond: {
																			if: {
																				$or: ["$$taskWrapsYearBoundary", queryFilterCrossesYearBoundary]
																			},
																			then: { $add: ["$$taskStartYear", 1] },  // Next year if task wraps OR query crosses year
																			else: "$$taskStartYear"                   // Same year
																		}
																	}
																},
																in: {
																	$let: {
																		vars: {
																			// Construct actual Date boundaries
																			clipStart: {
																				$dateFromParts: {
																					year: "$$clipStartYear",
																					month: startMonth,
																					day: startDay,
																					timezone
																				}
																			},
																			clipEnd: {
																				$dateFromParts: {
																					year: "$$clipEndYear",
																					month: endMonth,
																					day: endDay,
																					hour: 23,
																					minute: 59,
																					second: 59,
																					timezone
																				}
																			}
																		},
																in: {
																	$let: {
																		vars: {
																			// Clip task times to boundaries
																			effectiveStart: { $max: ["$$task.startTime", "$$clipStart"] },
																			effectiveEnd: { $min: ["$$task.endTime", "$$clipEnd"] }
																		},
																		in: {
																			// Only count duration if task overlaps with the month-day range
																			$cond: {
																				if: { $gte: ["$$effectiveEnd", "$$effectiveStart"] },
																				then: {
																					$divide: [
																						{ $subtract: ["$$effectiveEnd", "$$effectiveStart"] },
																						1000
																					]
																				},
																				else: 0
																			}
																		}
																	}
																}
															}
														}
													}
												}
											}
										}
									}
								}
							}
						]
					}
				}
			},
			else: "$tasks"
				}
			}
		}
	});

	pipeline.push({
		$addFields: {
			adjustedDuration: {
				$cond: {
					if: { $eq: ["$crossesMidnight", true] },
					then: {
						$reduce: {
							input: "$adjustedTasks",
							initialValue: 0,
							in: { $add: ["$$value", "$$this.duration"] }
						}
					},
					else: "$duration"
				}
			}
		}
	});

	// Replace duration and tasks with adjusted versions
	pipeline.push({
		$addFields: {
			duration: "$adjustedDuration",
			tasks: "$adjustedTasks"
		}
	});
}
