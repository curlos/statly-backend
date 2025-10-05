import express from 'express';
import { Task, TaskTickTick, TaskTodoist } from '../../models/TaskModel'
import { verifyToken } from '../../middleware/verifyToken';
import { getJsonData } from '../../utils/mongoose.utils';
import SyncMetadata from '../../models/SyncMetadataModel';
import { CustomRequest } from '../../interfaces/CustomRequest';
import { fetchAllTickTickTasks } from '../../utils/ticktick.utils';
import { buildAncestorData, getAllTodoistTasks } from '../../utils/task.utils';

const router = express.Router();

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

		// Filter by to-do list app (taskSource)
		if (toDoListApps) {
			const appSources = toDoListApps.split(',').map((app: string) => app.toLowerCase());
			matchFilter.taskSource = { $in: appSources };
		}

		// Build search stage if query exists (reusable for all pipelines)
		const searchStage = searchQuery && searchQuery.trim() ? {
			$search: {
				index: "search_tasks",
				compound: {
					must: [
						{
							text: {
								query: searchQuery.trim(),
								path: ["title", "content", "description"],
								fuzzy: {
									maxEdits: 1,
									prefixLength: 3
								}
							}
						}
					],
					should: [
						{
							text: {
								query: searchQuery.trim(),
								path: "title",
								score: { boost: { value: 10 } }
							}
						},
						{
							text: {
								query: searchQuery.trim(),
								path: "content",
								score: { boost: { value: 10 } }
							}
						},
						{
							text: {
								query: searchQuery.trim(),
								path: "description",
								score: { boost: { value: 5 } }
							}
						}
					]
				}
			}
		} : null;

		// Aggregation pipeline to group tasks by date
		const aggregationPipeline: any[] = [];

		// Step 1: If search query exists, use Atlas Search
		if (searchStage) {
			aggregationPipeline.push(searchStage);

			// Add search score
			aggregationPipeline.push({
				$addFields: {
					searchScore: { $meta: "searchScore" }
				}
			});
		}

		// Step 2: Filter completed tasks and apply other filters
		aggregationPipeline.push({ $match: matchFilter });

		// Step 3: Sort by completedTime ascending (oldest first within each day)
		// Skip this if searching - keep search relevance order
		if (!searchStage) {
			aggregationPipeline.push({ $sort: { completedTime: 1 } });
		}

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
				taskCount: { $sum: 1 },
				// Add day score for search relevance (sum of all task scores in this day)
				dayTasksTotalSearchScore: searchStage ? { $sum: "$searchScore" } : { $sum: 0 }
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
		} else if (sortBy === 'Most Relevant' && searchStage) {
			// Sort by day score (sum of all task scores in the day)
			aggregationPipeline.push({ $sort: { dayTasksTotalSearchScore: -1 } });
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
				dayTasksTotalSearchScore: 1,
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

		// Build count pipelines (must include search stage if it exists)
		const countDaysPipeline: any[] = [];
		const countTasksPipeline: any[] = [];

		// Add search stage to both count pipelines if it exists
		if (searchStage) {
			countDaysPipeline.push(searchStage);
			countTasksPipeline.push(searchStage);
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

router.post('/sync-tasks', verifyToken, async (req: CustomRequest, res) => {
	try {
		// Get or create sync metadata
		let syncMetadata = await SyncMetadata.findOne({ syncType: 'tasks' });

		if (!syncMetadata) {
			syncMetadata = new SyncMetadata({
				userId: req.user!.userId,
				syncType: 'tasks',
				lastSyncTime: new Date(0), // Set to epoch so all tasks are synced initially
			});
		}

		const lastSyncTime = syncMetadata.lastSyncTime;
		const tickTickTasks = await fetchAllTickTickTasks();

		// Step 1: Build tasksById map for quick parent lookups
		const tasksById: Record<string, any> = {};
		tickTickTasks.forEach((task: any) => {
			tasksById[task.id] = task;
		});

		// Step 2: Build ancestor data with caching
		const ancestorCache: Record<string, string[]> = {};

		const buildAncestorChain = (taskId: string, parentId: string | undefined): string[] => {
			// Include the task itself in its ancestor chain
			if (!parentId) {
				return [taskId];
			}

			// Check cache first (reuse for siblings with same parent)
			if (ancestorCache[parentId]) {
				return [taskId, ...ancestorCache[parentId]];
			}

			// Walk up the parent chain
			const chain = [taskId];
			let currentParentId: string | undefined = parentId;

			while (currentParentId && tasksById[currentParentId]) {
				chain.push(currentParentId);
				currentParentId = tasksById[currentParentId].parentId;
			}

			// Cache the chain for this parent (excluding the task itself)
			ancestorCache[parentId] = chain.slice(1);

			return chain;
		};

		const bulkOps = [];

		for (const task of tickTickTasks) {
			// Check if task needs updating based on modifiedTime
			const taskModifiedTime = task.modifiedTime ? new Date(task.modifiedTime) : null;
			const shouldUpdateTask = !taskModifiedTime || taskModifiedTime >= lastSyncTime;

			if (shouldUpdateTask) {
				// Build ancestor data for full task
				const ancestorIds = buildAncestorChain(task.id, task.parentId);
				const ancestorSet: Record<string, boolean> = {};
				ancestorIds.forEach((id: string) => {
					ancestorSet[id] = true;
				});

				// Normalize the FULL task
				const normalizedFullTask = {
					...task,
					taskSource: 'ticktick',
					taskType: 'full',
					title: task.title,
					description: task.desc || task.description || '',
					projectId: task.projectId,
					parentId: task.parentId,
					completedTime: task.completedTime,
					sortOrder: task.sortOrder,
					timeZone: task.timeZone,
					ancestorIds,
					ancestorSet,
				};

				// Add full task upsert operation to bulk array
				bulkOps.push({
					updateOne: {
						filter: { id: task.id },
						update: { $set: normalizedFullTask },
						upsert: true,
					},
				});

				// Process items array (if it exists and has items)
				// Items are always updated if their parent task is updated
				if (task.items && task.items.length > 0) {
					for (const item of task.items) {
						// Build ancestor data for item (parent is the full task)
						const itemAncestorIds = buildAncestorChain(item.id, task.id);
						const itemAncestorSet: Record<string, boolean> = {};
						itemAncestorIds.forEach((id: string) => {
							itemAncestorSet[id] = true;
						});

						// Normalize item task
						const normalizedItemTask = {
							...item,
							taskSource: 'ticktick',
							taskType: 'item',
							title: item.title,
							description: '',
							projectId: task.projectId, // Inherit from parent
							parentId: task.id, // Parent is the full task
							completedTime: item.completedTime,
							sortOrder: item.sortOrder,
							timeZone: item.timeZone,
							startDate: item.startDate,
							ancestorIds: itemAncestorIds,
							ancestorSet: itemAncestorSet,
						};

						// Add item task upsert operation to bulk array
						bulkOps.push({
							updateOne: {
								filter: { id: item.id },
								update: { $set: normalizedItemTask },
								upsert: true,
							},
						});
					}
				}
			}
		}

		// Execute all operations in a single bulkWrite
		const result = await TaskTickTick.bulkWrite(bulkOps);

		// Update sync metadata with current time and tasks updated count
		syncMetadata.lastSyncTime = new Date();
		syncMetadata.tasksUpdated = bulkOps.length;
		await syncMetadata.save();

		res.status(200).json({
			message: 'Transfer complete',
			upsertedCount: result.upsertedCount,
			modifiedCount: result.modifiedCount,
			matchedCount: result.matchedCount,
			totalOperations: bulkOps.length,
			lastSyncTime: syncMetadata.lastSyncTime,
		});
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred transferring tasks.',
		});
	}
});

router.get('/sync-metadata', verifyToken, async (req, res) => {
	try {
		const syncMetadata = await SyncMetadata.findOne({ syncType: 'tasks' });

		if (!syncMetadata) {
			return res.status(404).json({
				message: 'No sync metadata found',
			});
		}

		res.status(200).json(syncMetadata);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching sync metadata.',
		});
	}
});

router.post('/sync-todoist-tasks', verifyToken, async (req: CustomRequest, res) => {
	try {
		const allTasks = await getAllTodoistTasks();

		// Step 1: Build tasksById map for quick parent lookups
		const tasksById: Record<string, any> = {};
		allTasks.forEach((task: any) => {
			tasksById[task.id] = task;
		});

		// Step 2: Build ancestor data with caching
		const ancestorCache: Record<string, string[]> = {};

		const buildAncestorChain = (taskId: string, parentId: string | undefined): string[] => {
			// Include the task itself in its ancestor chain
			if (!parentId) {
				return [taskId];
			}

			// Check cache first (reuse for siblings with same parent)
			if (ancestorCache[parentId]) {
				return [taskId, ...ancestorCache[parentId]];
			}

			// Walk up the parent chain
			const chain = [taskId];
			let currentParentId: string | undefined = parentId;

			while (currentParentId && tasksById[currentParentId]) {
				chain.push(currentParentId);
				currentParentId = tasksById[currentParentId].v2_parent_id || tasksById[currentParentId].parent_id;
			}

			// Cache the chain for this parent (excluding the task itself)
			ancestorCache[parentId] = chain.slice(1);

			return chain;
		};

		const bulkOps = [];

		for (const task of allTasks) {
			// Build ancestor data
			const parentId = task.v2_parent_id || task.parent_id;
			const ancestorIds = buildAncestorChain(task.id, parentId);
			const ancestorSet: Record<string, boolean> = {};
			ancestorIds.forEach((id: string) => {
				ancestorSet[id] = true;
			});

			// Normalize the Todoist task to match our schema
			const normalizedTask = {
				...task,
				id: task.id,
				taskSource: 'todoist',
				title: task.content || task.title || '',
				description: task.description || '',
				projectId: task.v2_project_id || task.project_id,
				parentId: parentId,
				completedTime: task.completed_at ? new Date(task.completed_at) : null,
				ancestorIds,
				ancestorSet,
			};

			// Add upsert operation to bulk array
			bulkOps.push({
				updateOne: {
					filter: { id: task.id },
					update: { $set: normalizedTask },
					upsert: true,
				},
			});
		}

		// Execute all operations in a single bulkWrite
		const result = await TaskTodoist.bulkWrite(bulkOps);

		res.status(200).json({
			message: 'Todoist tasks synced successfully',
			upsertedCount: result.upsertedCount,
			modifiedCount: result.modifiedCount,
			matchedCount: result.matchedCount,
			totalOperations: bulkOps.length,
		});
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred syncing Todoist tasks.',
		});
	}
});

export default router;
