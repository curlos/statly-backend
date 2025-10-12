import express from 'express';
import FocusRecordTickTick from '../../models/FocusRecord';
import { verifyToken } from '../../middleware/verifyToken';
import { getJsonData } from '../../utils/mongoose.utils';
import { Task } from '../../models/TaskModel';
import { buildAncestorData } from '../../utils/task.utils';

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

	// If no focus records, return early
	if (focusRecords.length === 0) {
		return { focusRecordsWithCompletedTasks: [], ancestorTasksById };
	}

	// Find the overall time range across all focus records
	const allStartTimes = focusRecords.map((r: any) => new Date(r.startTime).getTime() - offsetMs);
	const allEndTimes = focusRecords.map((r: any) => new Date(r.endTime).getTime() + offsetMs);
	const minStartTime = new Date(Math.min(...allStartTimes));
	const maxEndTime = new Date(Math.max(...allEndTimes));

	// Single query to fetch all potentially relevant completed tasks
	const allCompletedTasks = await Task.find({
		completedTime: {
			$exists: true,
			$ne: null,
			$gte: minStartTime,
			$lte: maxEndTime
		}
	})
	.select('title completedTime')
	.lean();

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

		// Build list of project IDs to filter by
		const projectIds: string[] = projects ? projects.split(',') : [];
		const hasFilters = projectIds.length > 0 || !!taskId;

		// If no filters, use simple query
		if (!hasFilters) {
			const total = await FocusRecordTickTick.countDocuments();
			const totalPages = Math.ceil(total / limit);

			const focusRecords = await FocusRecordTickTick.find()
				.sort({ startTime: -1 })
				.skip(skip)
				.limit(limit)
				.lean();

			const hasMore = skip + focusRecords.length < total;

			// Calculate total durations for all focus records
			const durationResult = await FocusRecordTickTick.aggregate([
				{
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
				}
			]);

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
			{ $sort: { startTime: -1 } },
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
		const jsonData = await getJsonData('sorted-all-focus-data');
		res.status(200).json(jsonData);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching JSON data.',
		});
	}
});

export default router;
