import express from 'express';
import Task from '../models/taskModel';

const router = express.Router();

router.get('/', async (req, res) => {
	try {
		const tasks = await Task.find({});
		res.status(200).json(tasks);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching the tasks',
		});
	}
});

router.get('/:taskId', async (req, res) => {
	const { taskId } = req.params;
	const includeSubtasks = req.query.subtasks === 'true';

	try {
		const task = await Task.findById(taskId);
		if (!task) {
			return res.status(404).json({ message: 'Task not found' });
		}

		if (includeSubtasks && task.children && task.children.length > 0) {
			const subtasks = await Task.find({
				_id: { $in: task.children },
			});

			return res.status(200).json({ task, subtasks });
		}

		res.status(200).json(task);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching the task',
		});
	}
});

router.post('/add', async (req, res) => {
	const { parentId } = req.query;

	try {
		const newTask = new Task({
			...req.body,
		});

		const savedTask = await newTask.save();

		// When adding a subtask, update the parent task as well and add the subtask to the "children" array
		if (parentId) {
			const parentTask = await Task.findByIdAndUpdate(
				parentId,
				{ $push: { children: savedTask._id } },
				{ new: true }
			);

			if (!parentTask) {
				return res.status(404).json({ message: 'Parent task not found' });
			}

			return res.status(201).json(savedTask);
		}

		return res.status(201).json(savedTask);
	} catch (error) {
		return res
			.status(400)
			.json({ message: error instanceof Error ? error.message : 'An error occurred during task creation' });
	}
});

// "children" property of a task SHOULD NOT be updated through this endpoint. ONLY allow it to be edited through the bulk edit tasks endpoint as editing the children of a task affects multiple tasks, not just one.
router.put('/edit/:taskId', async (req, res) => {
	const { taskId } = req.params;
	let updateData = req.body;

	// Remove 'children' property from update data if it exists
	if (updateData.hasOwnProperty('children')) {
		const { children, ...otherUpdates } = updateData;
		updateData = otherUpdates;
	}

	try {
		const updatedTask = await Task.findByIdAndUpdate(taskId, updateData, { new: true, runValidators: true });

		if (!updatedTask) {
			return res.status(404).json({ message: 'Task not found' });
		}

		return res.status(200).json(updatedTask);
	} catch (error) {
		return res
			.status(400)
			.json({ message: error instanceof Error ? error.message : 'An error occurred during task update' });
	}
});

// This is mainly meant to be used when dragging a task in list of tasks/subtasks and changing the order. Since the "children" property of the task changes for every task, they all need to be updated in bulk.
router.put('/bulk-edit', async (req, res) => {
	const tasksToUpdate = req.body;

	if (!Array.isArray(tasksToUpdate)) {
		return res.status(400).json({ message: 'Payload must be an array of tasks' });
	}

	const bulkOps = tasksToUpdate.map((task) => ({
		updateOne: {
			filter: { _id: task._id },
			update: { $set: task },
			upsert: false,
		},
	}));

	try {
		const result = await Task.bulkWrite(bulkOps);

		return res.status(200).json({
			message: `Updated ${result.modifiedCount} task(s)`,
			result,
		});
	} catch (error: any) {
		return res.status(500).json({ message: error.message });
	}
});

const deleteTaskAndSubtasks = async (taskId: string) => {
	const task = await Task.findById(taskId);
	if (!task) return;

	if (task.children && task.children.length > 0) {
		for (const subtaskId of task.children) {
			await deleteTaskAndSubtasks(String(subtaskId));
		}
	}

	await Task.findByIdAndDelete(taskId);
};

// TODO: So this does actually delete tasks from the DB and it's good to keep it like this for NOw. However, I don't think it's a good idea for me to actually DELETE the tasks from the DB because I like to keep track of everything. Even stuff I've "deleted". I think it'll be a better idea to mark tasks with a flag or something saying they're deleted but not actually removing them. It'll just be more futureproof in case I wanna bring something back.
// TODO: Add parentId here so that if a task is deleted, it can be removed from the parent's "children"
router.delete('/delete/:taskId', async (req, res) => {
	const { taskId } = req.params;

	try {
		await deleteTaskAndSubtasks(taskId);
		res.status(200).json({ message: 'Task and all its subtasks have been deleted successfully' });
	} catch (error) {
		console.error('Faied to delete task and its subtasks: ', error);
		res.status(500).json({ message: 'An error occured during the delete process' });
	}
});

const markTaskAndSubtasksWithProperty = async (taskId: string, property: string, value: boolean, parentId = null) => {
	const task = await Task.findById(taskId);
	if (!task) return;

	// Recursively mark subtasks
	if (task.children && task.children.length > 0) {
		for (const subtaskId of task.children) {
			await markTaskAndSubtasksWithProperty(String(subtaskId), property, value, parentId);
		}
	}

	// Update the specified property on the current task
	await Task.findByIdAndUpdate(taskId, { [property]: value });

	// If parentId is provided, remove this task from its parent's children array
	if (parentId) {
		await Task.findByIdAndUpdate(parentId, { $pull: { children: taskId } });
	}
};

router.patch('/flag/:taskId', async (req, res) => {
	const { taskId } = req.params;
	const { property, value, parentId } = req.body;

	if (typeof property !== 'string' || value === undefined) {
		return res.status(400).json({ message: 'Invalid request data' });
	}

	try {
		await markTaskAndSubtasksWithProperty(taskId, property, value, parentId);
		res.status(200).json({ message: `Task and all its subtasks have been marked as ${property}` });
	} catch (error) {
		console.error(`Failed to mark task and its subtasks as ${property}: `, error);
		res.status(500).json({ message: 'An error occurred during the update process' });
	}
});

export default router;
