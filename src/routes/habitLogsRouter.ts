import express from 'express';
import HabitLog from '../models/HabitLog';
import Habit from '../models/HabitModel';
const router = express.Router();

router.get('/', async (req, res) => {
	try {
		const habitSections = await HabitLog.find();
		res.status(200).json(habitSections);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching the habit logs.',
		});
	}
});

router.post('/add', async (req, res) => {
	try {
		const payload = req.body;
		const { habitId, checkedInDayKey } = payload;

		const newHabitLog = new HabitLog(payload);
		const savedHabitLog = await newHabitLog.save();

		// Find the specific Habit and update it
		const habit = await Habit.findById(habitId);
		if (!habit) {
			return res.status(404).json({ message: 'Habit not found' });
		}

		if (!habit.checkedInDays) {
			habit.checkedInDays = new Map(); // Initialize if it doesn't exist
		}

		// Retrieve or create a new entry for the specific date
		let checkedInDay = habit.checkedInDays.get(checkedInDayKey);
		if (!checkedInDay) {
			const currentCheckedInDay = habit.checkedInDays.get(checkedInDayKey);
			checkedInDay = {
				isAchieved: currentCheckedInDay?.isAchieved ? currentCheckedInDay?.isAchieved : null,
				habitLogId: currentCheckedInDay?.habitLogId ? currentCheckedInDay?.habitLogId : null,
			}; // Create a new CheckedInDay object if it doesn't exist
		}

		if (savedHabitLog._id) {
			// Update the habitLogId for this entry
			// @ts-ignore
			checkedInDay.habitLogId = savedHabitLog._id;
		}

		// Set the updated CheckedInDay object back into the map
		habit.checkedInDays.set(checkedInDayKey, checkedInDay);

		await habit.save();

		return res.status(201).json(savedHabitLog);
	} catch (error) {
		return res.status(400).json({
			message: error instanceof Error ? error.message : 'An error occurred during habit log creation',
		});
	}
});

router.put('/edit/:habitLogId', async (req, res) => {
	const { habitLogId } = req.params;
	const payload = req.body;
	const { habitId, checkedInDayKey } = payload;

	try {
		const updatedHabitLog = await HabitLog.findByIdAndUpdate(habitLogId, payload, {
			new: true,
			runValidators: true,
		});

		if (!updatedHabitLog) {
			return res.status(404).json({ message: 'Habit log not found' });
		}

		// Find the specific Habit and update it
		const habit = await Habit.findById(habitId);
		if (!habit) {
			return res.status(404).json({ message: 'Habit not found' });
		}

		if (!habit.checkedInDays) {
			habit.checkedInDays = new Map(); // Initialize if it doesn't exist
		}

		// Retrieve or create a new entry for the specific date
		let checkedInDay = habit.checkedInDays.get(checkedInDayKey);
		if (!checkedInDay) {
			checkedInDay = { isAchieved: null, habitLogId: null }; // Initialize if not exist
		}

		// Update the habitLogId for this entry
		// @ts-ignore
		checkedInDay.habitLogId = updatedHabitLog._id;

		// Set the updated CheckedInDay object back into the map
		habit.checkedInDays.set(checkedInDayKey, checkedInDay);

		await habit.save();

		res.status(200).json(updatedHabitLog);
	} catch (error) {
		return res.status(400).json({
			message: error instanceof Error ? error.message : 'An error occurred during habit log update',
		});
	}
});

router.delete('/delete/:habitLogId', async (req, res) => {
	const { habitLogId } = req.params;

	try {
		const deleteHabitLog = await HabitLog.findByIdAndDelete(habitLogId);
		if (!deleteHabitLog) {
			return res.status(400).json({ message: 'Failed to delete the habit log.' });
		}

		// @ts-ignore
		const { habitId, checkedInDayKey } = deleteHabitLog;

		// Find the Habit using the habitId obtained from HabitLog
		const habit = await Habit.findById(habitId);

		if (habit && habit.checkedInDays.has(checkedInDayKey)) {
			// If the checkedInDayKey exists in the map, set its habitLogId to null
			const checkedInDay = habit.checkedInDays.get(checkedInDayKey);

			if (checkedInDay) {
				checkedInDay.habitLogId = null;
				habit.checkedInDays.set(checkedInDayKey, checkedInDay);

				// Explicitly mark the modified path. This is necessary because "checkedInDays" is a complex object of a mixed type so MongoDB's internal tracking isn't able to automatically detect that a change was made and thus the change won't be saved because it thinks that nothing changed. So, it has to be set as modified manually here.
				habit.markModified('checkedInDays');

				await habit.save();
			}
		}

		return res.status(200).json({ success: true, message: `Habit log deleted successfully.` });
	} catch (error) {
		return res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred during habit log deletion',
		});
	}
});

export default router;
