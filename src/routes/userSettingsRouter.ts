import express from 'express';
import UserSettings from '../models/UserSettingsModel';
import { verifyToken } from '../middleware/verifyToken';
import { CustomRequest } from '../interfaces/CustomRequest';
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

// Get all user settings
router.get('/all', async (req, res) => {
	try {
		const userSettings = await UserSettings.find({});

		if (!userSettings) {
			return res.status(404).json({ message: 'User Settings not found' });
		}

		res.json(userSettings);
	} catch (error) {
		res.status(500).json({ message: error instanceof Error ? error.message : error });
	}
});

router.post('/add', async (req, res) => {
	const { userId } = req.body;

	if (!userId) {
		return res.status(400).json({ message: 'User ID is required' });
	}

	try {
		// Check if settings already exist for the user
		const existingUserSettings = await UserSettings.findOne({ userId });
		if (existingUserSettings) {
			return res.status(409).json({ message: 'User Settings already exist for this user' });
		}

		const newUserSettings = new UserSettings(req.body);
		const savedUserSettings = await newUserSettings.save();
		res.status(201).json(savedUserSettings);
	} catch (error) {
		res.status(400).json({ message: error instanceof Error ? error.message : error });
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

// SHOULD NOT BE IN THE FRONTEND. THE INDIVIDUAL USERS SHOULD NOT BE ABLE TO DELETE THIS, ONLY DEVELOPER. THIS IS MOSTLY FOR TESTING PURPOSES ON THE BACKEND!
router.delete('/delete/:userSettingsId', async (req, res) => {
	const { userSettingsId } = req.params;

	try {
		const deletedUserSettings = await UserSettings.findByIdAndDelete(userSettingsId);

		if (!deletedUserSettings) {
			return res.status(404).json({ message: 'User Settings not found' });
		}

		res.status(200).json({ message: 'User Settings deleted successfully' });
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred during the deletion process',
		});
	}
});

export default router;
