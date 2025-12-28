import { createHash } from "crypto";
import { Types } from 'mongoose';
import { FocusRecordTickTick, FocusRecordBeFocused, FocusRecordForest, FocusRecordTide, FocusRecordSession } from "../../models/FocusRecord";
import { TaskTickTick } from "../../models/TaskModel";
import { fetchBeFocusedAppFocusRecords, fetchForestAppFocusRecords, fetchSessionFocusRecordsWithNoBreaks, fetchTickTickFocusRecords, fetchTideAppFocusRecords } from "../focus.utils";
import { crossesMidnightInTimezone } from "../timezone.utils";
import { getOrCreateSyncMetadata, getTickTickCookie } from "../helpers.utils";
import { analyzeNoteEmotionsCore } from "../../controllers/sentimentBatchController";
import UserSettings from "../../models/UserSettingsModel";
import { TickTickFocusRecordRaw, BeFocusedRecordRaw, ForestRecordRaw, TideRecordRaw, SessionRecordRaw } from "../../types/externalApis";

// Helper types for sync operations
type TickTickTask = NonNullable<TickTickFocusRecordRaw['tasks']>[number];

interface TaskData {
	projectId?: string;
	ancestorIds: string[];
}

interface ExistingRecordData {
	note: string;
	emotions: unknown;
}

function createDeterministicId(source: string, ...fields: unknown[]): string {
	const data = fields.join('|');
	const hash = createHash('sha256').update(data).digest('hex').substring(0, 12);
	return `${source}-${hash}`;
}

/**
 * Helper function to check if a record crosses midnight with caching
 * @param startTime - Start time of the record
 * @param endTime - End time of the record
 * @param timezone - User's timezone
 * @param cache - Map to cache results
 * @returns boolean indicating if record crosses midnight
 */
function getCachedCrossesMidnight(
	startTime: Date,
	endTime: Date,
	timezone: string,
	cache: Map<string, boolean>
): boolean {
	const startDay = Math.floor(startTime.getTime() / 86400000);
	const endDay = Math.floor(endTime.getTime() / 86400000);
	const dateKey = `${timezone}_${startDay}_${endDay}`;

	let crossesMidnight = cache.get(dateKey);
	if (crossesMidnight === undefined) {
		crossesMidnight = crossesMidnightInTimezone(startTime, endTime, timezone);
		cache.set(dateKey, crossesMidnight);
	}

	return crossesMidnight;
}

export async function syncTickTickFocusRecords(userId: Types.ObjectId, timezone: string = 'UTC') {
	// Get or create sync metadata for focus records
	const syncMetadata = await getOrCreateSyncMetadata(userId, 'tickTickFocusRecords');

	// Get user's TickTick cookie
	const cookie = await getTickTickCookie(userId);

	// Get user settings for emotion analysis feature
	const userSettings = await UserSettings.findOne({ userId });

	const lastSyncTime = syncMetadata.lastSyncTime;
	const focusRecords = await fetchTickTickFocusRecords(cookie, userId);

	// Calculate the cutoff date (3 days before last sync)
	const threeDaysBeforeLastSync = new Date(lastSyncTime);
	threeDaysBeforeLastSync.setDate(threeDaysBeforeLastSync.getDate() - 3);

	// Check if we should analyze emotions (do this early to avoid unnecessary work)
	const shouldAnalyzeEmotions = userSettings?.pages?.focusRecords?.analyzeNoteEmotionsWhileSyncingFocusRecords || false;

	// Only fetch existing records if we need to analyze emotions
	let existingRecordsMap = new Map<string, ExistingRecordData>();
	if (shouldAnalyzeEmotions) {
		const recordIds = focusRecords
			.filter(r => new Date(r.endTime) >= threeDaysBeforeLastSync)
			.map(r => r.id);

		const existingRecords = await FocusRecordTickTick.find({
			userId,
			id: { $in: recordIds }
		}).select('id note emotions').lean();

		existingRecordsMap = new Map(
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(existingRecords as any[]).map((r: any) => [r.id, { note: r.note || '', emotions: r.emotions }])
		);
	}

	// Collect all unique task IDs from focus records
	const allTaskIds = new Set<string>();
	for (const record of focusRecords) {
		const recordEndTime = new Date(record.endTime);
		if (recordEndTime >= threeDaysBeforeLastSync && record.tasks) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			record.tasks.forEach((task: any) => {
				if (task.taskId) {
					allTaskIds.add(task.taskId);
				}
			});
		}
	}

	// Fetch full task documents to get projectId and ancestorIds
	const tasksById: Record<string, TaskData> = {};
	if (allTaskIds.size > 0) {
		const fullTasks = await TaskTickTick.find({
			userId,
			id: { $in: Array.from(allTaskIds) }
		}).select('id projectId ancestorIds').lean();

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(fullTasks as any[]).forEach((task: any) => {
			tasksById[task.id] = {
				projectId: task.projectId,
				ancestorIds: task.ancestorIds || []
			};
		});
	}

	const bulkOps = [];
	const recordsNeedingEmotionAnalysis: string[] = [];
	// Cache for crossesMidnight calculations (keyed by start/end day pair)
	const midnightCache = new Map<string, boolean>();

	for (const record of focusRecords) {
		const recordEndTime = new Date(record.endTime);

		// Only sync if endTime is within 3 days of last sync or after.
		if (recordEndTime >= threeDaysBeforeLastSync) {
			// Calculate duration and denormalize projectId/ancestorIds for each task
			const tasksWithDuration = (record.tasks || []).map((task: TickTickTask) => {
				const startTime = new Date(task.startTime);
				const endTime = new Date(task.endTime);
				const duration = (endTime.getTime() - startTime.getTime()) / 1000; // Duration in seconds

				const taskData = tasksById[task.taskId];
				return {
					...task,
					duration,
					// If the task has no projectId, it must be an empty task or an older task like the "Full Stack Open" focus tasks from 2020.
					projectId: taskData?.projectId || userSettings?.tickTickInboxProjectId || '',
					ancestorIds: taskData?.ancestorIds || []
				};
			});

			// Calculate the focus record's total duration (subtract pauseDuration, in seconds)
			const startTime = new Date(record.startTime);
			const endTime = new Date(record.endTime);
			const totalDurationSeconds = (endTime.getTime() - startTime.getTime()) / 1000; // Convert to seconds
			const pauseDuration = record.pauseDuration || 0; // pauseDuration is already in seconds
			const realFocusDuration = totalDurationSeconds - pauseDuration; // Subtract pause duration

			// Check if record crosses midnight in user's timezone (with caching)
			const crossesMidnight = getCachedCrossesMidnight(startTime, endTime, timezone, midnightCache);

			// Normalize the focus record to match our schema
			// Remove _id to prevent duplicate key errors on upsert
			const { _id, ...recordWithoutMongoDbId } = record;
			const normalizedRecord = {
				...recordWithoutMongoDbId,
				userId,
				duration: realFocusDuration,
				tasks: tasksWithDuration,
				crossesMidnight,
			};

			// Determine if this record needs emotion analysis (only if setting is enabled)
			if (shouldAnalyzeEmotions && normalizedRecord.note && normalizedRecord.note.trim() !== '') {
				const existingRecord = existingRecordsMap.get(record.id);

				if (!existingRecord) {
					// New record with a note - needs analysis
					recordsNeedingEmotionAnalysis.push(record.id);
				} else {
					// Existing record - check if note changed or if it has no emotions
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const hasEmotions = existingRecord.emotions && (existingRecord.emotions as any).length > 0;
					const noteChanged = existingRecord.note !== normalizedRecord.note;

					if (!hasEmotions || noteChanged) {
						// Either no emotions OR note changed - needs (re)analysis
						recordsNeedingEmotionAnalysis.push(record.id);
					}
				}
			}

			// Add upsert operation to bulk array
			bulkOps.push({
				updateOne: {
					filter: { id: record.id, userId },
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

	// Analyze emotions for records that need it
	let emotionAnalysisResult = null;
	if (shouldAnalyzeEmotions && recordsNeedingEmotionAnalysis.length > 0) {
		try {
			console.log(`🧠 Analyzing emotions for ${recordsNeedingEmotionAnalysis.length} records...`);

			// Fetch the MongoDB _id values for these records (using their TickTick IDs)
			const recordsToAnalyze = await FocusRecordTickTick.find({
				userId,
				id: { $in: recordsNeedingEmotionAnalysis }
			}).select('_id').lean();

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const mongoIds = (recordsToAnalyze as any[]).map((r: any) => r._id.toString());

			if (mongoIds.length > 0) {
				emotionAnalysisResult = await analyzeNoteEmotionsCore(mongoIds, userId);
				console.log(`✅ Emotion analysis complete: ${emotionAnalysisResult.analyzed} analyzed, ${emotionAnalysisResult.failed} failed`);
			} else {
				console.log('⚠️ No records found to analyze');
				emotionAnalysisResult = { analyzed: 0, failed: 0 };
			}
		} catch (error) {
			console.error('Error analyzing emotions during sync:', error);
			// Don't fail the sync if emotion analysis fails
			emotionAnalysisResult = { error: 'Failed to analyze emotions', analyzed: 0, failed: recordsNeedingEmotionAnalysis.length };
		}
	}

	return {
		message: 'TickTick focus records synced successfully',
		upsertedCount: result.upsertedCount,
		modifiedCount: result.modifiedCount,
		matchedCount: result.matchedCount,
		totalOperations: bulkOps.length,
		lastSyncTime: syncMetadata.lastSyncTime,
		emotionAnalysis: emotionAnalysisResult,
	};
}

export async function syncBeFocusedFocusRecords(userId: Types.ObjectId, timezone: string = 'UTC') {
	// Get or create sync metadata
	const syncMetadata = await getOrCreateSyncMetadata(userId, 'beFocusedFocusRecords');

	// Fetch raw BeFocused data
	const rawBeFocusedRecords = await fetchBeFocusedAppFocusRecords();

	// Initialize cache for crossesMidnight calculations
	const midnightCache = new Map<string, boolean>();

	// Normalize each record to match TickTick format
	const normalizedRecords = rawBeFocusedRecords.map((record: BeFocusedRecordRaw) => {
		const startDate = new Date(record['Start date']);
		const durationInMinutes = Number(record['Duration']);
		const durationInSeconds = durationInMinutes * 60; // Convert minutes to seconds
		const endDate = new Date(startDate.getTime() + durationInMinutes * 60 * 1000);
		const assignedTask = record['Assigned task'] || 'Untitled';

		// Create deterministic ID using the parsed variables
		const id = createDeterministicId('befocused', startDate.toISOString(), durationInSeconds.toString(), assignedTask);

		// Create custom taskId: "TaskName - BeFocused"
		const taskId = `${assignedTask} - BeFocused`;

		// Check if record crosses midnight in user's timezone (with caching)
		const crossesMidnight = getCachedCrossesMidnight(startDate, endDate, timezone, midnightCache);
		const focusAppSource = 'FocusRecordBeFocused'

		return {
			id,
			userId,
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
	const bulkOps = normalizedRecords.map((record) => ({
		updateOne: {
			filter: { id: record.id, userId },
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

export async function syncForestFocusRecords(userId: Types.ObjectId, timezone: string = 'UTC') {
	// Get or create sync metadata
	const syncMetadata = await getOrCreateSyncMetadata(userId, 'forestFocusRecords');

	// Fetch raw Forest data
	const rawForestRecords = await fetchForestAppFocusRecords(true);

	// Initialize cache for crossesMidnight calculations
	const midnightCache = new Map<string, boolean>();

	// Normalize each record to match TickTick format
	const normalizedRecords = rawForestRecords.map((record: ForestRecordRaw) => {
		const startDate = new Date(record['Start Time'] as string);
		const endDate = new Date(record['End Time'] as string);
		const durationInSeconds = Math.floor((endDate.getTime() - startDate.getTime()) / 1000);
		const tag = record['Tag'] || '';
		const note = record['Note'] || '';
		const treeType = record['Tree Type'] || '';
		const isSuccess = record['Is Success'] === 'True';

		// Create deterministic ID using the parsed variables
		const id = createDeterministicId('forest', startDate.toISOString(), endDate.toISOString(), tag, isSuccess.toString());

		// Create custom taskId: "Tag - Forest"
		const taskId = `${tag} - Forest`;

		// Check if record crosses midnight in user's timezone (with caching)
		const crossesMidnight = getCachedCrossesMidnight(startDate, endDate, timezone, midnightCache);

		const focusAppSource = 'FocusRecordForest'

		return {
			id,
			userId,
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
	const bulkOps = normalizedRecords.map((record) => ({
		updateOne: {
			filter: { id: record.id, userId },
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

export async function syncTideFocusRecords(userId: Types.ObjectId, timezone: string = 'UTC') {
	// Get or create sync metadata
	const syncMetadata = await getOrCreateSyncMetadata(userId, 'tideFocusRecords');

	// Fetch raw Tide data
	const rawTideRecords = await fetchTideAppFocusRecords();

	// Initialize cache for crossesMidnight calculations
	const midnightCache = new Map<string, boolean>();

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
	const normalizedRecords = rawTideRecords.map((record: TideRecordRaw) => {
		const startDate = new Date(record['startTime']);
		const durationInSeconds = parseDuration((record['duration'] as unknown) as string) || 0;
		const endDate = new Date(startDate.getTime() + durationInSeconds * 1000);
		const name = record['name'] || 'Untitled';

		// Create deterministic ID using the parsed variables
		const id = createDeterministicId('tide', startDate.toISOString(), endDate.toISOString(), durationInSeconds.toString());

		// Create custom taskId: "Name - Tide"
		const taskId = `${name} - Tide`;

		// Check if record crosses midnight in user's timezone (with caching)
		const crossesMidnight = getCachedCrossesMidnight(startDate, endDate, timezone, midnightCache);

		const focusAppSource = 'FocusRecordTide'

		return {
			id,
			userId,
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
	const bulkOps = normalizedRecords.map((record) => ({
		updateOne: {
			filter: { id: record.id, userId },
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

export async function syncSessionFocusRecords(userId: Types.ObjectId, timezone: string = 'UTC') {
	// Get or create sync metadata
	const syncMetadata = await getOrCreateSyncMetadata(userId, 'sessionFocusRecords');

	// Fetch raw Session data
	const rawSessionRecords = await fetchSessionFocusRecordsWithNoBreaks();

	// Initialize cache for crossesMidnight calculations
	const midnightCache = new Map<string, boolean>();

	// Normalize each record to match TickTick format
	const normalizedRecords = rawSessionRecords.map((record: SessionRecordRaw) => {
		const startDate = new Date(record['start_date'] as string);
		const endDate = new Date(record['end_date'] as string);
		const totalDurationInSeconds = record['duration_second'] as number;
		const pauseDurationInSeconds = (record['pause_second'] as number) || 0;
		const actualDurationInSeconds = totalDurationInSeconds - pauseDurationInSeconds;

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const categoryTitle = (record['category'] as any)?.['title'] || 'General';
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const categoryId = (record['category'] as any)?.['id'] || 'general-session';
		const title = record['title'] || categoryTitle;
		const note = record['notes'] || '';

		// Normalize "General" category
		const projectId = categoryId === '' ? 'general-session' : categoryId;
		const projectName = categoryTitle;

		// Parse meta array to get pause periods
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const metaPauses = ((record['meta'] as any) || [])
			.filter((m: Record<string, unknown>) => m.type === 'PAUSE')
			.map((m: Record<string, unknown>) => ({
				start: new Date(m['start_date'] as string),
				end: new Date(m['end_date'] as string)
			}))
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

		// Check if record crosses midnight in user's timezone (with caching)
		const crossesMidnight = getCachedCrossesMidnight(startDate, endDate, timezone, midnightCache);

		// Create deterministic ID using the parsed variables
		const id = createDeterministicId('session', startDate.toISOString(), endDate.toISOString(), totalDurationInSeconds.toString(), title);

		return {
			id,
			userId,
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
	const bulkOps = normalizedRecords.map((record) => ({
		updateOne: {
			filter: { id: record.id, userId },
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