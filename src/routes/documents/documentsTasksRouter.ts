import express from 'express';
import { CustomRequest } from '../../interfaces/CustomRequest';
import { Task } from '../../models/TaskModel'
import { verifyToken } from '../../middleware/verifyToken';
import { getJsonData } from '../../utils/mongoose.utils';
import { fetchAllTickTickTasks } from '../../utils/ticktick.utils';
import { getTasksMedalsHandler } from '../../controllers/medalsController';
import { getTasksChallengesHandler } from '../../controllers/challengesController';
import { getDaysWithCompletedTasksHandler, exportDaysWithCompletedTasksHandler } from '../../controllers/daysWithCompletedTasksController';

const router = express.Router();

router.get('/medals', verifyToken, getTasksMedalsHandler);

router.get('/challenges', verifyToken, getTasksChallengesHandler);

router.get('/days-with-completed-tasks', verifyToken, getDaysWithCompletedTasksHandler);

router.get('/days-with-completed-tasks/export', verifyToken, exportDaysWithCompletedTasksHandler);

// GET /all - Returns all tasks with pagination support
router.get('/all', verifyToken, async (req: CustomRequest, res) => {
	try {
		const userId = req.user!.userId;
		const page = parseInt(req.query.page as string) || 1;
		const limit = parseInt(req.query.limit as string) || 5000;
		const skip = (page - 1) * limit;

		// Get total count for pagination metadata
		const total = await Task.countDocuments({ userId });
		const totalPages = Math.ceil(total / limit);

		// Fetch paginated tasks with .lean() for better performance
		// Sort by completedTime (if exists), then createdTime, then added_at - all descending (newest first)
		const tasks = await Task.find({ userId })
			.sort({ completedTime: -1, createdTime: -1, added_at: -1 })
			.skip(skip)
			.limit(limit)
			.lean();

		res.status(200).json({
			data: tasks,
			total,
			page,
			totalPages,
			limit
		});
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching all tasks.',
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
