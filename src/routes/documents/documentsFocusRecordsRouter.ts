import express from 'express';
import FocusRecordTickTick from '../../models/FocusRecord';
import { verifyToken } from '../../middleware/verifyToken';
import { getJsonData } from '../../utils/mongoose.utils';
import { Task } from '../../models/TaskModel';
import { buildAncestorData } from '../../utils/task.utils';

const router = express.Router();

router.get('/', verifyToken, async (req, res) => {
	try {
		const page = parseInt(req.query.page as string) || 0;
		const limit = parseInt(req.query.limit as string) || 25;
		const skip = page * limit;
		const projects = req.query['projects-ticktick'] as string;

		// Build list of project IDs to filter by
		const projectIds: string[] = projects ? projects.split(',') : [];

		// If no project filter, use simple query
		if (projectIds.length === 0) {
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
				tasksByDate
			});
		}

		// Build aggregation pipeline for filtering by project
		// const aggregationPipeline: any[] = [
		// 	// Step 1: Unwind tasks array (excludes focus records with no tasks)
		// 	{ $unwind: { path: "$tasks", preserveNullAndEmptyArrays: false } },

		// 	// Step 2: Lookup the full Task document by taskId
		// 	{
		// 		$lookup: {
		// 			from: "tasks",
		// 			localField: "tasks.taskId",
		// 			foreignField: "id",
		// 			as: "taskDoc"
		// 		}
		// 	},

		// 	// Step 3: Unwind the looked-up task
		// 	{ $unwind: "$taskDoc" },

		// 	// Step 4: Filter tasks by projectId
		// 	{ $match: { "taskDoc.projectId": { $in: projectIds } } },

		// 	// Step 5: Group back into focus records with filtered tasks
		// 	{
		// 		$group: {
		// 			_id: "$_id",
		// 			id: { $first: "$id" },
		// 			source: { $first: "$source" },
		// 			startTime: { $first: "$startTime" },
		// 			endTime: { $first: "$endTime" },
		// 			note: { $first: "$note" },
		// 			pauseDuration: { $first: "$pauseDuration" },
		// 			tasks: { $push: "$tasks" },
		// 			// Calculate duration from filtered tasks (sum of task durations in milliseconds)
		// 			duration: { $sum: "$tasks.duration" }
		// 		}
		// 	},

		// 	// Step 6: Sort by startTime descending (newest first)
		// 	{ $sort: { startTime: -1 } },

		// 	// Step 7: Paginate
		// 	{ $skip: skip },
		// 	{ $limit: limit }
		// ];

		// // Execute aggregation
		// const focusRecords = await FocusRecordTickTick.aggregate(aggregationPipeline);

		// // Build count and total duration pipeline (same as above but without pagination)
		// const countAndDurationPipeline: any[] = [
		// 	{ $unwind: { path: "$tasks", preserveNullAndEmptyArrays: false } },
		// 	{
		// 		$lookup: {
		// 			from: "tasks",
		// 			localField: "tasks.taskId",
		// 			foreignField: "id",
		// 			as: "taskDoc"
		// 		}
		// 	},
		// 	{ $unwind: "$taskDoc" },
		// 	{ $match: { "taskDoc.projectId": { $in: projectIds } } },
		// 	{
		// 		$group: {
		// 			_id: "$_id",
		// 			originalDuration: { $first: "$duration" },
		// 			filteredTasksDuration: { $sum: "$tasks.duration" }
		// 		}
		// 	},
		// 	{
		// 		$group: {
		// 			_id: null,
		// 			total: { $sum: 1 },
		// 			totalDuration: { $sum: "$originalDuration" },
		// 			onlyTasksTotalDuration: { $sum: "$filteredTasksDuration" }
		// 		}
		// 	}
		// ];

		// const countAndDurationResult = await FocusRecordTickTick.aggregate(countAndDurationPipeline);
		// const total = countAndDurationResult[0]?.total || 0;
		// const totalDuration = countAndDurationResult[0]?.totalDuration || 0;
		// const onlyTasksTotalDuration = countAndDurationResult[0]?.onlyTasksTotalDuration || 0;
		// const totalPages = Math.ceil(total / limit);
		// const hasMore = skip + focusRecords.length < total;

		// res.status(200).json({
		// 	data: focusRecords,
		// 	total,
		// 	totalPages,
		// 	page,
		// 	limit,
		// 	hasMore,
		// 	totalDuration,
		// 	onlyTasksTotalDuration,
		// });
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
