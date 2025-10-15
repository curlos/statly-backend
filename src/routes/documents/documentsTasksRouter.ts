import express from 'express';
import { Task } from '../../models/TaskModel'
import { verifyToken } from '../../middleware/verifyToken';
import { getJsonData } from '../../utils/mongoose.utils';
import { fetchAllTickTickTasks } from '../../utils/ticktick.utils';
import { buildAncestorData } from '../../utils/task.utils';
import { getTasksMedalsHandler } from '../../controllers/medalsController';

const router = express.Router();

router.get('/medals', verifyToken, getTasksMedalsHandler);

// Helper function to build search filter using regex (similar to focus records)
function buildSearchFilter(searchQuery?: string) {
	if (!searchQuery || !searchQuery.trim()) {
		return null;
	}

	const trimmedQuery = searchQuery.trim();
	return {
		$or: [
			{ title: { $regex: trimmedQuery, $options: 'i' } },
			{ content: { $regex: trimmedQuery, $options: 'i' } },
		]
	};
}

// GET /days-with-completed-tasks - Returns completed tasks grouped by date with pagination
router.get('/days-with-completed-tasks', verifyToken, async (req, res) => {
	try {
		const page = parseInt(req.query.page as string) || 0;
		const limit = parseInt(req.query['max-days-per-page'] as string) || 7;
		const projectId = req.query.projectId as string;
		const taskId = (req.query['task-id'] as string);
		const timezone = (req.query.timezone as string) || 'UTC';
		const sortBy = (req.query['sort-by'] as string) || 'Newest';
		const startDate = req.query['start-date'] as string;
		const endDate = req.query['end-date'] as string;
		const projectsTickTick = req.query['projects-ticktick'] as string;
		const projectsTodoist = req.query['projects-todoist'] as string;
		const toDoListApps = req.query['to-do-list-apps'] as string;
		const taskIdIncludeSubtasks = req.query['task-id-include-completed-tasks-from-subtasks'] === 'true';
		const searchQuery = req.query['search'] as string;

		// Build match filter
		const matchFilter: any = {
			completedTime: { $exists: true, $ne: null }
		};

		// Add date range filter
		if (startDate && endDate) {
			const startDateObj = new Date(startDate);
			const endDateObj = new Date(endDate);

			// Set start to beginning of day and end to end of day
			startDateObj.setHours(0, 0, 0, 0);
			endDateObj.setHours(23, 59, 59, 999);

			matchFilter.completedTime = {
				...matchFilter.completedTime,
				$gte: startDateObj,
				$lte: endDateObj
			};
		}

		// Add optional filters
		if (projectId) {
			matchFilter.projectId = projectId;
		}

		// Filter by multiple project IDs (TickTick and/or Todoist)
		if (projectsTickTick || projectsTodoist) {
			const allProjectIds = [];
			if (projectsTickTick) {
				allProjectIds.push(...projectsTickTick.split(','));
			}
			if (projectsTodoist) {
				allProjectIds.push(...projectsTodoist.split(','));
			}
			matchFilter.projectId = { $in: allProjectIds };
		}

		// Filter by taskId
		if (taskId) {
			if (taskIdIncludeSubtasks) {
				// Include task itself + all descendants using ancestorSet
				matchFilter[`ancestorSet.${taskId}`] = true;
			} else {
				// Only include tasks where id matches taskId OR parentId matches taskId
				matchFilter.$or = [
					{ id: taskId },
					{ parentId: taskId }
				];
			}
		}

		// Filter by to-do list app (source)
		if (toDoListApps) {
			const appSources = toDoListApps.split(',');
			matchFilter.source = { $in: appSources };
		}

		// Build search filter if query exists
		const searchFilter = buildSearchFilter(searchQuery);

		// Aggregation pipeline to group tasks by date
		const aggregationPipeline: any[] = [];

		// Step 1: Apply search filter if it exists
		if (searchFilter) {
			aggregationPipeline.push({ $match: searchFilter });
		}

		// Step 2: Filter completed tasks and apply other filters
		aggregationPipeline.push({ $match: matchFilter });

		// Step 3: Sort by completedTime ascending (oldest first within each day)
		aggregationPipeline.push({ $sort: { completedTime: 1 } });

		// Step 4: Group tasks by formatted date string (in user's timezone)
		aggregationPipeline.push({
			$group: {
				_id: {
					$dateToString: {
						format: "%B %d, %Y",
						date: "$completedTime",
						timezone: timezone
					}
				},
				completedTasksForDay: { $push: "$$ROOT" },
				firstCompletedTime: { $first: "$completedTime" },
				taskCount: { $sum: 1 }
			}
		});

		// Step 5: Sort based on sortBy parameter
		if (sortBy === 'Newest') {
			aggregationPipeline.push({ $sort: { firstCompletedTime: -1 } });
		} else if (sortBy === 'Oldest') {
			aggregationPipeline.push({ $sort: { firstCompletedTime: 1 } });
		} else if (sortBy === 'Completed Tasks: Most-Least') {
			aggregationPipeline.push({ $sort: { taskCount: -1 } });
		} else if (sortBy === 'Completed Tasks: Least-Most') {
			aggregationPipeline.push({ $sort: { taskCount: 1 } });
		}

		// Step 6: Paginate days (not tasks)
		aggregationPipeline.push(
			{ $skip: page * limit },
			{ $limit: limit }
		);

		// Step 7: Format output
		aggregationPipeline.push({
			$project: {
				dateStr: "$_id",
				completedTasksForDay: 1,
				_id: 0
			}
		});

		const result = await Task.aggregate(aggregationPipeline);

		// Extract all tasks from the paginated days
		const allTasksInPage: any[] = [];
		result.forEach(day => {
			allTasksInPage.push(...day.completedTasksForDay);
		});

		// Build ancestor data for all tasks
		const { ancestorTasksById } = await buildAncestorData(allTasksInPage);

		// Build count pipelines
		const countDaysPipeline: any[] = [];
		const countTasksPipeline: any[] = [];

		// Add search filter to both count pipelines if it exists
		if (searchFilter) {
			countDaysPipeline.push({ $match: searchFilter });
			countTasksPipeline.push({ $match: searchFilter });
		}

		// Add match filter to both
		countDaysPipeline.push({ $match: matchFilter });
		countTasksPipeline.push({ $match: matchFilter });

		// Count total tasks (before grouping)
		countTasksPipeline.push({ $count: "total" });

		// Count total days (after grouping by date)
		countDaysPipeline.push({
			$group: {
				_id: {
					$dateToString: {
						format: "%B %d, %Y",
						date: "$completedTime",
						timezone: timezone
					}
				}
			}
		});
		countDaysPipeline.push({ $count: "total" });

		// Run both counts in parallel with main query results
		const [totalTasksResult, totalDaysResult] = await Promise.all([
			Task.aggregate(countTasksPipeline),
			Task.aggregate(countDaysPipeline)
		]);

		const totalTasks = totalTasksResult[0]?.total || 0;
		const totalDays = totalDaysResult[0]?.total || 0;
		const totalPages = Math.ceil(totalDays / limit);

		// Calculate hasMore by checking if there's another day after this page
		const hasMore = (page + 1) * limit < totalDays;

		res.status(200).json({
			data: result,
			ancestorTasksById,
			totalTasks,
			totalPages,
			page,
			limit,
			hasMore,
		});
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching days with completed tasks.',
		});
	}
});

router.get('/test-json-data-ticktick', verifyToken, async (req, res) => {
	const useLiveData = true

	try {
		const tickTickTasks = useLiveData ? await fetchAllTickTickTasks() : await getJsonData('all-ticktick-tasks');
		res.status(200).json(tickTickTasks);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching JSON data.',
		});
	}
});

export default router;
