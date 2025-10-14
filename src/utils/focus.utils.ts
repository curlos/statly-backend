import axios from 'axios';
import { getTodayTimeBounds, sortArrayByProperty, arrayToObjectByKey } from './helpers.utils';
import FocusRecordTickTick from '../models/FocusRecord';
import Task from '../models/TaskModel';
import { buildAncestorData } from './task.utils';
import { getJsonData } from './mongoose.utils';

const TICKTICK_API_COOKIE = process.env.TICKTICK_API_COOKIE;
const cookie = TICKTICK_API_COOKIE;
// new Date(2705792451783) = September 28, 2055. This is to make sure all my tasks are fetched properly. I doubt I'll have to worry about this expiring since I'll be long past TickTick and humans coding anything will be a thing of the past by then with GPT-20 out by then.
const farAwayDateInMs = 2705792451783;

interface FetchFocusRecordsOptions {
	todayOnly?: boolean;
	doNotUseMongoDB?: boolean;
	localSortedAllFocusData?: any;
}

export const fetchTickTickFocusRecords = async (options: FetchFocusRecordsOptions = {}) => {
	const { todayOnly = false, doNotUseMongoDB = false, localSortedAllFocusData = {} } = options;

	const localFocusData = doNotUseMongoDB
		? localSortedAllFocusData
		: await FocusRecordTickTick.find().sort({ startTime: -1 }).lean();

	let fromMs = 0;
	let toMs = farAwayDateInMs;

	if (todayOnly) {
		const { startMs, endMs } = getTodayTimeBounds();
		fromMs = startMs;
		toMs = endMs;
	} else {
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
	}

	const focusDataPomos = await axios.get(`https://api.ticktick.com/api/v2/pomodoros?from=${fromMs}&to=${toMs}`, {
		headers: {
			Cookie: cookie,
		},
	});

	const focusDataStopwatch = await axios.get(
		`https://api.ticktick.com/api/v2/pomodoros/timing?from=${fromMs}&to=${toMs}`,
		{
			headers: {
				Cookie: cookie,
			},
		}
	);

	const tickTickOneApiFocusData = [...focusDataPomos.data, ...focusDataStopwatch.data];
	const tickTickOneApiFocusDataById = arrayToObjectByKey(tickTickOneApiFocusData, 'id');
	const localFocusDataById = arrayToObjectByKey(localFocusData, 'id');

	// This is necessary and I can't just check to add focus records that are already in the DB like I did before because I often times edit my focus record after it's been created by updating the focus note. So, if I don't have this logic, then I won't have the latest focus note logic. I'm probably re-writing through around 20 focus records.
	const localFocusDataWithLatestInfo = localFocusData.map((focusRecord: any) => {
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

// Helper function to add ancestor tasks and completed tasks to focus records
export const addAncestorAndCompletedTasks = async (focusRecords: any[]) => {
	// Extract all unique task IDs from focus records
	const allTaskIds = new Set<string>();
	focusRecords.forEach((record: any) => {
		if (record.tasks && Array.isArray(record.tasks)) {
			record.tasks.forEach((task: any) => {
				if (task.taskId) {
					allTaskIds.add(task.taskId);
				}
			});
		}
	});

	// Fetch full task documents to get ancestorIds
	const tasksWithAncestors = await Task.find({ id: { $in: Array.from(allTaskIds) } }).lean();

	// Build ancestor data
	const { ancestorTasksById } = await buildAncestorData(tasksWithAncestors);

	// Add the child tasks themselves to the map
	tasksWithAncestors.forEach((task: any) => {
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
	const timeRanges = focusRecords.map((r: any) => ({
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
	let allCompletedTasks: any[] = [];

	if (mergedRanges.length === 0) {
		// No ranges to query
		allCompletedTasks = [];
	} else if (mergedRanges.length === 1) {
		// Single range - use simple query
		const tasks = await Task.find({
			completedTime: {
				$exists: true,
				$ne: null,
				$gte: new Date(mergedRanges[0].start),
				$lte: new Date(mergedRanges[0].end)
			}
		})
		.select('title completedTime')
		.lean();
		allCompletedTasks = tasks;
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

		const tasks = await Task.find({ $or: orConditions })
			.select('title completedTime')
			.lean();
		allCompletedTasks = tasks;
	}

	// Group completed tasks by date (YYYY-MM-DD) for faster lookups
	const tasksByDate = new Map<string, any[]>();
	allCompletedTasks.forEach((task: any) => {
		const taskDate = new Date(task.completedTime);
		const dateKey = `${taskDate.getFullYear()}-${String(taskDate.getMonth() + 1).padStart(2, '0')}-${String(taskDate.getDate()).padStart(2, '0')}`;

		if (!tasksByDate.has(dateKey)) {
			tasksByDate.set(dateKey, []);
		}
		tasksByDate.get(dateKey)!.push(task);
	});

	// Map completed tasks to each focus record
	const focusRecordsWithCompletedTasks = focusRecords.map((record: any) => {
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
		const completedTasks: any[] = [];
		relevantDates.forEach(dateKey => {
			const tasksForDate = tasksByDate.get(dateKey) || [];
			tasksForDate.forEach((task: any) => {
				const taskTime = new Date(task.completedTime).getTime();
				if (taskTime >= startTimeWithOffset.getTime() && taskTime <= endTimeWithOffset.getTime()) {
					completedTasks.push(task);
				}
			});
		});

		// Sort by completedTime ascending
		completedTasks.sort((a, b) => new Date(a.completedTime).getTime() - new Date(b.completedTime).getTime());

		return {
			...record,
			completedTasks
		};
	});

	return { focusRecordsWithCompletedTasks, ancestorTasksById };
}

// Helper function to fetch session app focus records with no breaks
export const fetchSessionFocusRecordsWithNoBreaks = async () => {
	const sessionAppFocusData = await getJsonData('session-app-data');

	const focusRecordsWithNoBreaks = sessionAppFocusData.filter(
		(focusRecord: any) => focusRecord['type'] === 'fullFocus'
	);

	return focusRecordsWithNoBreaks;
}

// Helper function to fetch be-focused app focus records
export const fetchBeFocusedAppFocusRecords = async () => {
	const beFocusedAppFocusData = await getJsonData('be-focused-app-data');
	return beFocusedAppFocusData;
}

// Helper function to fetch forest app focus records with optional date filter
export const fetchForestAppFocusRecords = async (beforeSessionApp?: boolean) => {
	const forestAppFocusData = await getJsonData('forest-app-data');

	if (beforeSessionApp) {
		const cutoffDate = new Date('April 14, 2021');

		const filteredData = forestAppFocusData.filter((item: any) => {
			const itemStartDate = new Date(item['Start Time']);
			// Return true if the item's start date is before the cutoff date
			return itemStartDate < cutoffDate;
		});

		return filteredData;
	}

	return forestAppFocusData;
}

// Helper function to fetch tide app focus records
export const fetchTideAppFocusRecords = async () => {
	const tideAppFocusData = await getJsonData('tide-ios-app-focus-records');
	return tideAppFocusData;
}
