import express from 'express';
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
