import express from 'express';
import UserSettings from '../models/UserSettingsModel';
import { verifyToken } from '../middleware/verifyToken';
import { CustomRequest } from '../interfaces/CustomRequest';
import FocusRecord from '../models/FocusRecord';
import Task from '../models/TaskModel';
import Project from '../models/projectModel';
import ProjectGroupTickTick from '../models/projectGroupModel';
const router = express.Router();

// Get user settings for logged in user
router.get('/', verifyToken, async (req: CustomRequest, res) => {
	const user = req.user; // This is set by the verifyToken middleware
	// @ts-ignore
	const { userId } = user;

	try {
		// @ts-ignore
		const userSettings = await UserSettings.findOne({ userId });

		if (!userSettings) {
			return res.status(404).json({ message: 'User Settings not found' });
		}

		res.json(userSettings);
	} catch (error) {
		res.status(500).json({ message: error instanceof Error ? error.message : error });
	}
});

router.put('/edit', verifyToken, async (req: CustomRequest, res) => {
	const user = req.user; // This is set by the verifyToken middleware
	// @ts-ignore
	const { userId } = user;

	const { userId: bodyUserId } = req.body;

	// Remove userId from req.body to prevent it from being updated
	delete req.body.userId;

	try {
		// If userId in body exists and does not match the one in the params, throw an error
		if (bodyUserId && bodyUserId !== userId) {
			return res.status(400).json({ message: 'Changing userId is not allowed' });
		}

		const updatedUserSettings = await UserSettings.findOneAndUpdate({ userId }, req.body, { new: true });

		if (!updatedUserSettings) {
			return res.status(404).json({ message: 'User Settings not found' });
		}

		res.json(updatedUserSettings);
	} catch (error) {
		res.status(400).json({ message: error instanceof Error ? error.message : error });
	}
});

// Get document counts for logged in user
router.get('/document-counts', verifyToken, async (req: CustomRequest, res) => {
	const user = req.user;
	// @ts-ignore
	const { userId } = user;

	try {
		const [focusRecordsCount, tasksCount, projectsCount, projectGroupsCount] = await Promise.all([
			FocusRecord.countDocuments({ userId }),
			Task.countDocuments({ userId }),
			Project.countDocuments({ userId }),
			ProjectGroupTickTick.countDocuments({ userId })
		]);

		res.json({
			focusRecords: focusRecordsCount,
			tasks: tasksCount,
			projects: projectsCount,
			projectGroups: projectGroupsCount
		});
	} catch (error) {
		res.status(500).json({ message: error instanceof Error ? error.message : error });
	}
});

export default router;
