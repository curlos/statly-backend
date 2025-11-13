import { createHash } from "crypto";
import { FocusRecordTickTick, FocusRecordBeFocused, FocusRecordForest, FocusRecordTide, FocusRecordSession } from "../../models/FocusRecord";
import { TaskTickTick } from "../../models/TaskModel";
import { fetchBeFocusedAppFocusRecords, fetchForestAppFocusRecords, fetchSessionFocusRecordsWithNoBreaks, fetchTickTickFocusRecords, fetchTideAppFocusRecords } from "../focus.utils";
import { crossesMidnightInTimezone } from "../timezone.utils";
import { getOrCreateSyncMetadata } from "../helpers.utils";

function createDeterministicId(source: string, ...fields: any[]): string {
	const data = fields.join('|');
	const hash = createHash('sha256').update(data).digest('hex').substring(0, 12);
	return `${source}-${hash}`;
}

export async function syncTickTickFocusRecords(userId: string, timezone: string = 'UTC') {
	// Get or create sync metadata for focus records
	const syncMetadata = await getOrCreateSyncMetadata(userId, 'tickTickFocusRecords');

	const lastSyncTime = syncMetadata.lastSyncTime;
	const focusRecords = await fetchTickTickFocusRecords();

	// Calculate the cutoff date (30 days before last sync)
	const thirtyDaysBeforeLastSync = new Date(lastSyncTime);
	thirtyDaysBeforeLastSync.setDate(thirtyDaysBeforeLastSync.getDate() - 30);

	// Collect all unique task IDs from focus records
	const allTaskIds = new Set<string>();
	for (const record of focusRecords) {
		const recordEndTime = new Date(record.endTime);
		if (recordEndTime >= thirtyDaysBeforeLastSync && record.tasks) {
			record.tasks.forEach((task: any) => {
				if (task.taskId) {
					allTaskIds.add(task.taskId);
				}
			});
		}
	}

	// Fetch full task documents to get projectId and ancestorIds
	const tasksById: Record<string, any> = {};
	if (allTaskIds.size > 0) {
		const fullTasks = await TaskTickTick.find({
			id: { $in: Array.from(allTaskIds) }
		}).select('id projectId ancestorIds').lean();

		fullTasks.forEach((task: any) => {
			tasksById[task.id] = {
				projectId: task.projectId,
				ancestorIds: task.ancestorIds || []
			};
		});
	}

	const bulkOps = [];

	for (const record of focusRecords) {
		const recordEndTime = new Date(record.endTime);

		// Only sync if endTime is within 30 days of last sync
		if (recordEndTime >= thirtyDaysBeforeLastSync) {
			// Calculate duration and denormalize projectId/ancestorIds for each task
			const tasksWithDuration = (record.tasks || []).map((task: any) => {
				const startTime = new Date(task.startTime);
				const endTime = new Date(task.endTime);
				const duration = (endTime.getTime() - startTime.getTime()) / 1000; // Duration in seconds

				const taskData = tasksById[task.taskId];
				return {
					...task,
					duration,
					// If the task has no projectId, it must be an empty task or an older task like the "Full Stack Open" focus tasks from 2020.
					projectId: taskData?.projectId || 'inbox116577688',
					ancestorIds: taskData?.ancestorIds || []
				};
			});

			// Calculate the focus record's total duration (subtract pauseDuration, in seconds)
			const startTime = new Date(record.startTime);
			const endTime = new Date(record.endTime);
			const totalDurationSeconds = (endTime.getTime() - startTime.getTime()) / 1000; // Convert to seconds
			const pauseDuration = record.pauseDuration || 0; // pauseDuration is already in seconds
			const realFocusDuration = totalDurationSeconds - pauseDuration; // Subtract pause duration

			// Check if record crosses midnight in user's timezone
			const crossesMidnight = crossesMidnightInTimezone(startTime, endTime, timezone);

			// Normalize the focus record to match our schema
			const normalizedRecord = {
				...record,
				duration: realFocusDuration,
				tasks: tasksWithDuration,
				crossesMidnight,
			};

			// Add upsert operation to bulk array
			bulkOps.push({
				updateOne: {
					filter: { id: record.id },
					update: { $set: normalizedRecord },
					upsert: true,
				},
			});
		}
	}

	// Execute all operations in a single bulkWrite
	const result = bulkOps.length > 0 ? await FocusRecordTickTick.bulkWrite(bulkOps) : {
		upsertedCount: 0,
		modifiedCount: 0,
		matchedCount: 0,
	};

	// Update sync metadata with current time
	syncMetadata.lastSyncTime = new Date();
	await syncMetadata.save();

	return {
		message: 'TickTick focus records synced successfully',
		upsertedCount: result.upsertedCount,
		modifiedCount: result.modifiedCount,
		matchedCount: result.matchedCount,
		totalOperations: bulkOps.length,
		lastSyncTime: syncMetadata.lastSyncTime,
	};
}

export async function syncBeFocusedFocusRecords(userId: string, timezone: string = 'UTC') {
	// Get or create sync metadata
	const syncMetadata = await getOrCreateSyncMetadata(userId, 'beFocusedFocusRecords');

	// Fetch raw BeFocused data
	const rawBeFocusedRecords = await fetchBeFocusedAppFocusRecords();

	// Normalize each record to match TickTick format
	const normalizedRecords = rawBeFocusedRecords.map((record: any) => {
		const startDate = new Date(record['Start date']);
		const durationInMinutes = Number(record['Duration']);
		const durationInSeconds = durationInMinutes * 60; // Convert minutes to seconds
		const endDate = new Date(startDate.getTime() + durationInMinutes * 60 * 1000);
		const assignedTask = record['Assigned task'] || 'Untitled';

		// Create deterministic ID using the parsed variables
		const id = createDeterministicId('befocused', startDate.toISOString(), durationInSeconds.toString(), assignedTask);

		// Create custom taskId: "TaskName - BeFocused"
		const taskId = `${assignedTask} - BeFocused`;

		// Check if record crosses midnight in user's timezone
		const crossesMidnight = crossesMidnightInTimezone(startDate, endDate, timezone);
		const focusAppSource = 'FocusRecordBeFocused'

		return {
			id,
			source: focusAppSource,
			startTime: startDate, // Date object for MongoDB
			endTime: endDate, // Date object for MongoDB
			duration: durationInSeconds, // Duration in seconds like TickTick
			crossesMidnight,
			tasks: [
				{
					taskId,
					title: assignedTask,
					startTime: startDate, // Date object for MongoDB
					endTime: endDate, // Date object for MongoDB
					duration: durationInSeconds, // Each task has the full duration since there's only one task,
					projectId: focusAppSource,
					projectName: focusAppSource
				}
			]
		};
	});

	// Bulk upsert to database
	const bulkOps = normalizedRecords.map((record: any) => ({
		updateOne: {
			filter: { id: record.id },
			update: { $set: record },
			upsert: true
		}
	}));

	const result = await FocusRecordBeFocused.bulkWrite(bulkOps);

	// Update sync metadata
	syncMetadata.lastSyncTime = new Date();
	await syncMetadata.save();

	return {
		message: 'BeFocused focus records synced successfully',
		recordsProcessed: normalizedRecords.length,
		upsertedCount: result.upsertedCount,
		modifiedCount: result.modifiedCount,
		lastSyncTime: syncMetadata.lastSyncTime,
	};
}

export async function syncForestFocusRecords(userId: string, timezone: string = 'UTC') {
	// Get or create sync metadata
	const syncMetadata = await getOrCreateSyncMetadata(userId, 'forestFocusRecords');

	// Fetch raw Forest data
	const rawForestRecords = await fetchForestAppFocusRecords(true);

	// Normalize each record to match TickTick format
	const normalizedRecords = rawForestRecords.map((record: any) => {
		const startDate = new Date(record['Start Time']);
		const endDate = new Date(record['End Time']);
		const durationInSeconds = Math.floor((endDate.getTime() - startDate.getTime()) / 1000);
		const tag = record['Tag'] || '';
		const note = record['Note'] || '';
		const treeType = record['Tree Type'] || '';
		const isSuccess = record['Is Success'] === 'True';

		// Create deterministic ID using the parsed variables
		const id = createDeterministicId('forest', startDate.toISOString(), endDate.toISOString(), tag, isSuccess.toString());

		// Create custom taskId: "Tag - Forest"
		const taskId = `${tag} - Forest`;

		// Check if record crosses midnight in user's timezone
		const crossesMidnight = crossesMidnightInTimezone(startDate, endDate, timezone);

		const focusAppSource = 'FocusRecordForest'

		return {
			id,
			source: focusAppSource,
			startTime: startDate, // Date object for MongoDB
			endTime: endDate, // Date object for MongoDB
			duration: durationInSeconds, // Duration in seconds like TickTick
			crossesMidnight,
			note,
			treeType,
			isSuccess,
			tasks: [
				{
					taskId,
					title: tag,
					startTime: startDate, // Date object for MongoDB
					endTime: endDate, // Date object for MongoDB
					duration: durationInSeconds, // Each task has the full duration since there's only one task
					projectId: focusAppSource,
					projectName: focusAppSource
				}
			]
		};
	});

	// Bulk upsert to database
	const bulkOps = normalizedRecords.map((record: any) => ({
		updateOne: {
			filter: { id: record.id },
			update: { $set: record },
			upsert: true
		}
	}));

	const result = await FocusRecordForest.bulkWrite(bulkOps);

	// Update sync metadata
	syncMetadata.lastSyncTime = new Date();
	await syncMetadata.save();

	return {
		message: 'Forest focus records synced successfully',
		recordsProcessed: normalizedRecords.length,
		upsertedCount: result.upsertedCount,
		modifiedCount: result.modifiedCount,
		lastSyncTime: syncMetadata.lastSyncTime,
	};
}

export async function syncTideFocusRecords(userId: string, timezone: string = 'UTC') {
	// Get or create sync metadata
	const syncMetadata = await getOrCreateSyncMetadata(userId, 'tideFocusRecords');

	// Fetch raw Tide data
	const rawTideRecords = await fetchTideAppFocusRecords();

	// Helper function to parse duration string (e.g., "1h50m", "35m", "3m")
	const parseDuration = (durationStr: string): number => {
		let totalSeconds = 0;
		const hourMatch = durationStr.match(/(\d+)h/);
		const minuteMatch = durationStr.match(/(\d+)m/);

		if (hourMatch) {
			totalSeconds += parseInt(hourMatch[1]) * 3600;
		}
		if (minuteMatch) {
			totalSeconds += parseInt(minuteMatch[1]) * 60;
		}

		return totalSeconds;
	};

	// Normalize each record to match TickTick format
	const normalizedRecords = rawTideRecords.map((record: any) => {
		const startDate = new Date(record['startTime']);
		const durationInSeconds = parseDuration(record['duration']);
		const endDate = new Date(startDate.getTime() + durationInSeconds * 1000);
		const name = record['name'] || 'Untitled';

		// Create deterministic ID using the parsed variables
		const id = createDeterministicId('tide', startDate.toISOString(), endDate.toISOString(), durationInSeconds.toString());

		// Create custom taskId: "Name - Tide"
		const taskId = `${name} - Tide`;

		// Check if record crosses midnight in user's timezone
		const crossesMidnight = crossesMidnightInTimezone(startDate, endDate, timezone);

		const focusAppSource = 'FocusRecordTide'

		return {
			id,
			source: focusAppSource,
			startTime: startDate, // Date object for MongoDB
			endTime: endDate, // Date object for MongoDB
			duration: durationInSeconds, // Duration in seconds like TickTick
			crossesMidnight,
			tasks: [
				{
					taskId,
					title: name,
					startTime: startDate, // Date object for MongoDB
					endTime: endDate, // Date object for MongoDB
					duration: durationInSeconds, // Each task has the full duration since there's only one task
					projectId: focusAppSource,
					projectName: focusAppSource
				}
			]
		};
	});

	// Bulk upsert to database
	const bulkOps = normalizedRecords.map((record: any) => ({
		updateOne: {
			filter: { id: record.id },
			update: { $set: record },
			upsert: true
		}
	}));

	const result = await FocusRecordTide.bulkWrite(bulkOps);

	// Update sync metadata
	syncMetadata.lastSyncTime = new Date();
	await syncMetadata.save();

	return {
		message: 'Tide focus records synced successfully',
		recordsProcessed: normalizedRecords.length,
		upsertedCount: result.upsertedCount,
		modifiedCount: result.modifiedCount,
		lastSyncTime: syncMetadata.lastSyncTime,
	};
}

export async function syncSessionFocusRecords(userId: string, timezone: string = 'UTC') {
	// Get or create sync metadata
	const syncMetadata = await getOrCreateSyncMetadata(userId, 'sessionFocusRecords');

	// Fetch raw Session data
	const rawSessionRecords = await fetchSessionFocusRecordsWithNoBreaks();

	// Normalize each record to match TickTick format
	const normalizedRecords = rawSessionRecords.map((record: any) => {
		const startDate = new Date(record['start_date']);
		const endDate = new Date(record['end_date']);
		const totalDurationInSeconds = record['duration_second'];
		const pauseDurationInSeconds = record['pause_second'] || 0;
		const actualDurationInSeconds = totalDurationInSeconds - pauseDurationInSeconds;

		const categoryTitle = record['category']?.['title'] || 'General';
		const categoryId = record['category']?.['id'] || 'general-session';
		const title = record['title'] || categoryTitle;
		const note = record['notes'] || '';

		// Normalize "General" category
		const projectId = categoryId === '' ? 'general-session' : categoryId;
		const projectName = categoryTitle;

		// Parse meta array to get pause periods
		const metaPauses = (record['meta'] || [])
			.filter((m: any) => m.type === 'PAUSE')
			.map((m: any) => ({
				start: new Date(m['start_date']),
				end: new Date(m['end_date'])
			}))
			.sort((a: any, b: any) => a.start.getTime() - b.start.getTime());

		// Build tasks array by splitting based on pauses
		const tasks = [];
		let currentStart = startDate;

		for (const pause of metaPauses) {
			// Task before this pause
			const taskEnd = pause.start;
			const taskDuration = Math.floor((taskEnd.getTime() - currentStart.getTime()) / 1000);

			if (taskDuration > 0) {
				tasks.push({
					taskId: `${title} - Session`,
					title,
					startTime: currentStart,
					endTime: taskEnd,
					duration: taskDuration,
					projectId,
					projectName,
				});
			}

			// Move start to after pause
			currentStart = pause.end;
		}

		// Final task (after last pause or entire session if no pauses)
		const finalTaskDuration = Math.floor((endDate.getTime() - currentStart.getTime()) / 1000);
		if (finalTaskDuration > 0) {
			tasks.push({
				taskId: `${title} - Session`,
				title,
				startTime: currentStart,
				endTime: endDate,
				duration: finalTaskDuration,
				projectId,
				projectName,
			});
		}

		// Check if record crosses midnight in user's timezone
		const crossesMidnight = crossesMidnightInTimezone(startDate, endDate, timezone);

		// Create deterministic ID using the parsed variables
		const id = createDeterministicId('session', startDate.toISOString(), endDate.toISOString(), totalDurationInSeconds.toString(), title);

		return {
			id,
			source: 'FocusRecordSession',
			startTime: startDate,
			endTime: endDate,
			duration: actualDurationInSeconds, // Total duration minus pauses
			crossesMidnight,
			note,
			pauseDuration: pauseDurationInSeconds,
			tasks
		};
	});

	// Bulk upsert to database
	const bulkOps = normalizedRecords.map((record: any) => ({
		updateOne: {
			filter: { id: record.id },
			update: { $set: record },
			upsert: true
		}
	}));

	const result = await FocusRecordSession.bulkWrite(bulkOps);

	// Update sync metadata
	syncMetadata.lastSyncTime = new Date();
	await syncMetadata.save();

	return {
		message: 'Session focus records synced successfully',
		recordsProcessed: normalizedRecords.length,
		upsertedCount: result.upsertedCount,
		modifiedCount: result.modifiedCount,
		lastSyncTime: syncMetadata.lastSyncTime,
	};
}