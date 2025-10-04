import express from 'express';
import { Task, TaskTickTick } from '../../models/taskModel'
import { verifyToken } from '../../middleware/verifyToken';
import { getJsonData } from '../../utils/mongoose.utils';

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

// Helper function to build ancestor data for tasks (batched approach)
async function buildAncestorData(tasks: any[]) {
	// Step 1: Collect all unique parentIds from the paginated tasks
	const parentIdsToFetch = new Set<string>();
	tasks.forEach(task => {
		if (task.parentId) {
			parentIdsToFetch.add(task.parentId);
		}
	});

	// Step 2: Fetch ancestors in batches until we have them all (max 4-5 rounds due to nesting limit)
	const tasksById: Record<string, any> = {};
	let currentParentIds = Array.from(parentIdsToFetch);

	while (currentParentIds.length > 0) {
		// Batch fetch all tasks at this level
		const fetchedTasks = await Task.find({
			id: { $in: currentParentIds }
		}).lean();

		const nextParentIds: string[] = [];
		fetchedTasks.forEach(task => {
			tasksById[task.id] = task;
			// If this task has a parent we haven't fetched yet, add to next round
			if (task.parentId && !tasksById[task.parentId]) {
				nextParentIds.push(task.parentId);
			}
		});

		currentParentIds = nextParentIds;
	}

	// Step 3: Build ancestor data using in-memory map (no more DB queries)
	// Store ancestor chains per unique parentId (not per task to avoid duplication)
	const ancestorTaskIds: Record<string, string[]> = {};
	const ancestorTasksById: Record<string, { id: string; title: string }> = {};

	// For each unique parentId, compute its ancestor chain once
	parentIdsToFetch.forEach(parentId => {
		// Skip if we already computed this ancestor chain
		if (ancestorTaskIds[parentId]) {
			return;
		}

		const ancestorChain: string[] = [];
		let currentParentId: string | undefined = parentId;

		// Walk up the ancestor chain using in-memory map
		while (currentParentId && tasksById[currentParentId]) {
			ancestorChain.push(currentParentId);
			const parentTask: any = tasksById[currentParentId];

			// Cache basic ancestor info
			if (!ancestorTasksById[currentParentId]) {
				ancestorTasksById[currentParentId] = {
					id: parentTask.id,
					title: parentTask.title
				};
			}

			// If we've already computed the chain for this parent's parent, reuse it
			if (parentTask.parentId && ancestorTaskIds[parentTask.parentId]) {
				// Append the already-computed chain and stop
				ancestorChain.push(...ancestorTaskIds[parentTask.parentId]);
				break;
			}

			currentParentId = parentTask.parentId;
		}

		// Store the ancestor chain for this parentId
		ancestorTaskIds[parentId] = ancestorChain;
	});

	return { ancestorTaskIds, ancestorTasksById };
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
		const { ancestorTaskIds, ancestorTasksById } = await buildAncestorData(tasks);

		const hasMore = skip + tasks.length < total;

		res.status(200).json({
			data: tasks,
			ancestorTaskIds,
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

router.get('/test-json-data-ticktick', verifyToken, async (req, res) => {
	try {
		const jsonData = await getJsonData('all-ticktick-tasks');
		res.status(200).json(jsonData);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching JSON data.',
		});
	}
});

router.post('/transfer-tasks-ticktick', verifyToken, async (req, res) => {
	try {
		const jsonData = await getJsonData('all-ticktick-tasks');

		const bulkOps = [];

		for (const task of jsonData) {
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
			if (task.items && task.items.length > 0) {
				for (const item of task.items) {
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

		// Execute all operations in a single bulkWrite
		const result = await TaskTickTick.bulkWrite(bulkOps);

		res.status(200).json({
			message: 'Transfer complete',
			upsertedCount: result.upsertedCount,
			modifiedCount: result.modifiedCount,
			matchedCount: result.matchedCount,
			totalOperations: bulkOps.length,
		});
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred transferring tasks.',
		});
	}
});

export default router;
