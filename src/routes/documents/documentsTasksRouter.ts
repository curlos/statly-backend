import express from 'express';
import { Task, TaskTickTick } from '../../models/taskModel'
import { verifyToken } from '../../middleware/verifyToken';
import { getJsonData } from '../../utils/mongoose.utils';
import SyncMetadata from '../../models/SyncMetadataModel';
import { CustomRequest } from '../../interfaces/CustomRequest';
import { fetchAllTickTickTasks } from '../../utils/ticktick.utils';

const router = express.Router();

// Helper function to find all descendants of a task
async function findDescendants(taskId: string) {
	const descendants: any[] = [];

	async function findChildren(parentId: string) {
		const children = await Task.find({ parentId }).lean();
		for (const child of children) {
			descendants.push(child);
			await findChildren(child.id);
		}
	}

	await findChildren(taskId);
	return descendants;
}

// Helper function to build ancestor data for tasks (optimized with pre-computed ancestorIds)
async function buildAncestorData(tasks: any[]) {
	// Step 1: Collect ALL unique ancestor IDs from tasks (using pre-computed ancestorIds)
	const allAncestorIds = new Set<string>();

	tasks.forEach(task => {
		if (task.ancestorIds && task.ancestorIds.length > 0) {
			// Optimization: If we've seen an ancestor in the chain, we've seen all above it
			for (const ancestorId of task.ancestorIds) {
				if (allAncestorIds.has(ancestorId)) {
					break; // Skip the rest - we've already added this ancestor chain
				}
				allAncestorIds.add(ancestorId);
			}
		}
	});

	// Step 2: Fetch ALL ancestor tasks in ONE batch query
	const ancestorTasks = await Task.find({
		id: { $in: Array.from(allAncestorIds) }
	}).lean();

	// Step 3: Build ancestorTasksById map
	const ancestorTasksById: Record<string, { id: string; title: string; parentId: string | null; }> = {};
	ancestorTasks.forEach(task => {
		ancestorTasksById[task.id] = {
			id: task.id,
			title: task.title,
			parentId: task.parentId ?? null
		};
	});

	return { ancestorTasksById };
}

router.get('/', verifyToken, async (req, res) => {
	try {
		const page = parseInt(req.query.page as string) || 0;
		const limit = parseInt(req.query.limit as string) || 50;
		const taskId = req.query.taskId as string;
		const skip = page * limit;

		// Build filter based on taskId if provided
		let filter = {};
		if (taskId) {
			// Find all descendants of the specified taskId using aggregation
			const descendants = await findDescendants(taskId);
			const descendantIds = descendants.map((d: any) => d.id);

			// Include the taskId itself and all its descendants
			filter = { id: { $in: [taskId, ...descendantIds] } };
		}

		// Get total count for pagination metadata
		const total = await Task.countDocuments(filter);
		const totalPages = Math.ceil(total / limit);

		// Fetch paginated tasks sorted by completedTime descending (newest first)
		const tasks = await Task.find(filter)
			.sort({ completedTime: -1 })
			.skip(skip)
			.limit(limit)
			.lean(); // Use lean() for better performance when we don't need Mongoose documents

		// Build ancestor data for all tasks
		const { ancestorTasksById } = await buildAncestorData(tasks);

		const hasMore = skip + tasks.length < total;

		res.status(200).json({
			data: tasks,
			ancestorTasksById,
			total,
			totalPages,
			page,
			limit,
			hasMore,
		});
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching tasks.',
		});
	}
});

// GET /days-with-completed-tasks - Returns completed tasks grouped by date with pagination
router.get('/days-with-completed-tasks', verifyToken, async (req, res) => {
	try {
		const page = parseInt(req.query.page as string) || 0;
		const limit = parseInt(req.query.limit as string) || 7;
		const projectId = req.query.projectId as string;
		const taskId = req.query.taskId as string;
		const timezone = (req.query.timezone as string) || 'UTC';

		// Build match filter
		const matchFilter: any = {
			completedTime: { $exists: true, $ne: null }
		};

		// Add optional filters
		if (projectId) {
			matchFilter.projectId = projectId;
		}

		// Filter by taskId (includes task itself + all descendants)
		if (taskId) {
			matchFilter[`ancestorSet.${taskId}`] = true;
		}

		// Aggregation pipeline to group tasks by date
		const result = await Task.aggregate([
			// Step 1: Filter completed tasks (and optional projectId filter)
			{ $match: matchFilter },

			// Step 2: Sort by completedTime descending (uses index)
			{ $sort: { completedTime: -1 } },

			// Step 3: Group tasks by formatted date string (in user's timezone)
			{
				$group: {
					_id: {
						$dateToString: {
							format: "%B %d, %Y",
							date: "$completedTime",
							timezone: timezone
						}
					},
					completedTasksForDay: { $push: "$$ROOT" },
					firstCompletedTime: { $first: "$completedTime" }
				}
			},

			// Step 4: Sort grouped days by date descending (newest first)
			{ $sort: { firstCompletedTime: -1 } },

			// Step 5: Paginate days (not tasks)
			{ $skip: page * limit },
			{ $limit: limit },

			// Step 6: Format output
			{
				$project: {
					dateStr: "$_id",
					completedTasksForDay: 1,
					_id: 0
				}
			}
		]);

		// Extract all tasks from the paginated days
		const allTasksInPage: any[] = [];
		result.forEach(day => {
			allTasksInPage.push(...day.completedTasksForDay);
		});

		// Build ancestor data for all tasks
		const { ancestorTasksById } = await buildAncestorData(allTasksInPage);

		// Get total count of all tasks matching the filters
		const totalTasks = await Task.countDocuments(matchFilter);

		// Get total number of days with completed tasks (for totalPages calculation)
		const totalDaysResult = await Task.aggregate([
			{ $match: matchFilter },
			{
				$group: {
					_id: {
						$dateToString: {
							format: "%B %d, %Y",
							date: "$completedTime"
						}
					}
				}
			}
		]);

		const totalDays = totalDaysResult.length;
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

export default router;
