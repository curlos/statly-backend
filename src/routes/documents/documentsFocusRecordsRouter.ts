import express from 'express';
import FocusRecordTickTick from '../../models/FocusRecord';
import { verifyToken } from '../../middleware/verifyToken';
import { Task } from '../../models/TaskModel';
import { buildAncestorData } from '../../utils/task.utils';
import { fetchTickTickFocusRecords } from '../../utils/focus.utils';

const router = express.Router();

// Helper function to add ancestor tasks and completed tasks to focus records
async function addAncestorAndCompletedTasks(focusRecords: any[]) {
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

	// Query each merged range separately and combine results
	const allCompletedTasks: any[] = [];
	for (const range of mergedRanges) {
		const tasks = await Task.find({
			completedTime: {
				$exists: true,
				$ne: null,
				$gte: new Date(range.start),
				$lte: new Date(range.end)
			}
		})
		.select('title completedTime')
		.lean();

		allCompletedTasks.push(...tasks);
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

router.get('/', verifyToken, async (req, res) => {
	try {
		const page = parseInt(req.query.page as string) || 0;
		const limit = parseInt(req.query.limit as string) || 25;
		const skip = page * limit;
		const projects = req.query['projects-ticktick'] as string;
		const taskId = req.query['task-id'] as string;
		const startDate = req.query['start-date'] as string;
		const endDate = req.query['end-date'] as string;
		const sortBy = req.query['sort-by'] as string || 'Newest';

		// Build list of project IDs to filter by
		const projectIds: string[] = projects ? projects.split(',') : [];
		const hasTaskOrProjectFilters = projectIds.length > 0 || !!taskId;

		// Build date range filter if provided
		const dateRangeFilter: any = {};
		if (startDate || endDate) {
			dateRangeFilter.startTime = {};
			if (startDate) {
				dateRangeFilter.startTime.$gte = new Date(startDate);
			}
			if (endDate) {
				// Add 1 day to endDate to include the entire end date
				const endDateTime = new Date(endDate);
				endDateTime.setDate(endDateTime.getDate() + 1);
				dateRangeFilter.startTime.$lt = endDateTime;
			}
		}

		// Build sort criteria based on sortBy parameter
		const getSortCriteria = (): { [key: string]: 1 | -1 } => {
			switch (sortBy) {
				case 'Oldest':
					return { startTime: 1 };
				case 'Focus Hours: Most-Least':
					return { duration: -1 };
				case 'Focus Hours: Least-Most':
					return { duration: 1 };
				case 'Newest':
				default:
					return { startTime: -1 };
			}
		};

		const sortCriteria = getSortCriteria();

		// If no task/project filters, use simple query (date filters can be applied directly)
		if (!hasTaskOrProjectFilters) {
			const total = await FocusRecordTickTick.countDocuments(dateRangeFilter);
			const totalPages = Math.ceil(total / limit);

			const focusRecords = await FocusRecordTickTick.find(dateRangeFilter)
				.sort(sortCriteria)
				.skip(skip)
				.limit(limit)
				.lean();

			const hasMore = skip + focusRecords.length < total;

			// Calculate total durations for all focus records
			const durationPipeline: any[] = [];

			// Add date range match stage if needed
			if (Object.keys(dateRangeFilter).length > 0) {
				durationPipeline.push({ $match: dateRangeFilter });
			}

			durationPipeline.push({
				$facet: {
					baseDuration: [
						{
							$group: {
								_id: null,
								total: { $sum: "$duration" }
							}
						}
					],
					tasksDuration: [
						{ $unwind: { path: "$tasks", preserveNullAndEmptyArrays: true } },
						{
							$group: {
								_id: null,
								total: { $sum: "$tasks.duration" }
							}
						}
					]
				}
			});

			const durationResult = await FocusRecordTickTick.aggregate(durationPipeline);

			const totalDuration = durationResult[0]?.baseDuration[0]?.total || 0;
			const onlyTasksTotalDuration = durationResult[0]?.tasksDuration[0]?.total || 0;

			// Add ancestor tasks and completed tasks
			const { focusRecordsWithCompletedTasks, ancestorTasksById } = await addAncestorAndCompletedTasks(focusRecords);

			return res.status(200).json({
				data: focusRecordsWithCompletedTasks,
				ancestorTasksById,
				total,
				totalPages,
				page,
				limit,
				hasMore,
				totalDuration,
				onlyTasksTotalDuration,
			});
		}

		// Build match and filter conditions
		const matchConditions: any = {};
		const filterConditions: any[] = [];

		// Add date range to match conditions
		if (startDate || endDate) {
			matchConditions.startTime = {};
			if (startDate) {
				matchConditions.startTime.$gte = new Date(startDate);
			}
			if (endDate) {
				// Add 1 day to endDate to include the entire end date
				const endDateTime = new Date(endDate);
				endDateTime.setDate(endDateTime.getDate() + 1);
				matchConditions.startTime.$lt = endDateTime;
			}
		}

		if (projectIds.length > 0) {
			matchConditions["tasks.projectId"] = { $in: projectIds };
			filterConditions.push({ $in: ["$$task.projectId", projectIds] });
		}

		if (taskId) {
			// Match if taskId equals task.taskId OR taskId is in task.ancestorIds
			matchConditions.$or = [
				{ "tasks.taskId": taskId },
				{ "tasks.ancestorIds": taskId }
			];
			filterConditions.push({
				$or: [
					{ $eq: ["$$task.taskId", taskId] },
					{ $in: [taskId, "$$task.ancestorIds"] }
				]
			});
		}

		// Filter by project and/or task-id using denormalized data
		const aggregationPipeline: any[] = [
			// Match focus records that have at least one task matching the filters
			{ $match: matchConditions },
			// Store original duration before filtering
			{
				$addFields: {
					originalDuration: "$duration"
				}
			},
			// Filter tasks array to only include tasks matching ALL conditions
			{
				$addFields: {
					tasks: {
						$filter: {
							input: "$tasks",
							as: "task",
							cond: filterConditions.length > 1
								? { $and: filterConditions }
								: filterConditions[0]
						}
					}
				}
			},
			// Recalculate duration based on filtered tasks
			{
				$addFields: {
					duration: {
						$reduce: {
							input: "$tasks",
							initialValue: 0,
							in: { $add: ["$$value", "$$this.duration"] }
						}
					}
				}
			},
			{ $sort: sortCriteria },
			{ $skip: skip },
			{ $limit: limit }
		];

		const focusRecords = await FocusRecordTickTick.aggregate(aggregationPipeline);

		// Count and total duration pipeline using denormalized data
		const countAndDurationPipeline: any[] = [
			// Match focus records that have at least one task matching the filters
			{ $match: matchConditions },
			// Store original duration before filtering
			{
				$addFields: {
					originalDuration: "$duration"
				}
			},
			// Filter tasks array to only include tasks matching ALL conditions
			{
				$addFields: {
					filteredTasks: {
						$filter: {
							input: "$tasks",
							as: "task",
							cond: filterConditions.length > 1
								? { $and: filterConditions }
								: filterConditions[0]
						}
					}
				}
			},
			// Calculate filtered tasks duration
			{
				$addFields: {
					filteredTasksDuration: {
						$reduce: {
							input: "$filteredTasks",
							initialValue: 0,
							in: { $add: ["$$value", "$$this.duration"] }
						}
					}
				}
			},
			{
				$group: {
					_id: null,
					total: { $sum: 1 },
					totalDuration: { $sum: "$originalDuration" },
					onlyTasksTotalDuration: { $sum: "$filteredTasksDuration" }
				}
			}
		];

		const countAndDurationResult = await FocusRecordTickTick.aggregate(countAndDurationPipeline);
		const total = countAndDurationResult[0]?.total || 0;
		const totalDuration = countAndDurationResult[0]?.totalDuration || 0;
		const onlyTasksTotalDuration = countAndDurationResult[0]?.onlyTasksTotalDuration || 0;
		const totalPages = Math.ceil(total / limit);
		const hasMore = skip + focusRecords.length < total;

		// Add ancestor tasks and completed tasks
		const { focusRecordsWithCompletedTasks, ancestorTasksById } = await addAncestorAndCompletedTasks(focusRecords);

		res.status(200).json({
			data: focusRecordsWithCompletedTasks,
			ancestorTasksById,
			total,
			totalPages,
			page,
			limit,
			hasMore,
			totalDuration,
			onlyTasksTotalDuration,
		});
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching focus records.',
		});
	}
});

router.get('/test-json-data', verifyToken, async (req, res) => {
	try {
		const todayOnly = req.query.today === 'true';

		const sortedAllFocusData = await fetchTickTickFocusRecords({
			todayOnly,
			doNotUseMongoDB: false,
		});

		res.status(200).json(sortedAllFocusData);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching focus records from TickTick API.',
		});
	}
});

export default router;
