import express from 'express';
import Habit from '../models/HabitModel';
import HabitSection from '../models/HabitSectionModel';
import { verifyToken } from '../middleware/verifyToken';
const router = express.Router();

router.get('/', verifyToken, async (req, res) => {
	try {
		const habits = await Habit.find();
		res.status(200).json(habits);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching the habits.',
		});
	}
});

router.post('/add', verifyToken, async (req, res) => {
	try {
		const newHabit = new Habit(req.body);
		const savedHabit = await newHabit.save();

		if (savedHabit.habitSectionId) {
			await HabitSection.findByIdAndUpdate(
				savedHabit.habitSectionId,
				{ $push: { habitIds: savedHabit._id } },
				{ new: true }
			);
		}

		return res.status(201).json(savedHabit);
	} catch (error) {
		return res
			.status(400)
			.json({ message: error instanceof Error ? error.message : 'An error occurred during habit creation' });
	}
});

router.put('/edit/:habitId', verifyToken, async (req, res) => {
	const { habitId } = req.params;

	try {
		const originalHabit = await Habit.findById(habitId);
		const updatedHabit = await Habit.findByIdAndUpdate(habitId, req.body, { new: true, runValidators: true });

		if (!updatedHabit) {
			return res.status(404).json({ message: 'Habit not found' });
		}

		// Ensure the habit ID is removed from any sections that should no longer contain it
		await HabitSection.updateMany(
			{ _id: { $ne: updatedHabit.habitSectionId }, habitIds: habitId },
			{ $pull: { habitIds: habitId } }
		);

		// Add the habit ID to the new HabitSection if needed
		if (updatedHabit.habitSectionId) {
			await HabitSection.findByIdAndUpdate(
				updatedHabit.habitSectionId,
				{ $addToSet: { habitIds: habitId } },
				{ new: true }
			);
		}

		res.status(200).json(updatedHabit);
	} catch (error) {
		return res
			.status(400)
			.json({ message: error instanceof Error ? error.message : 'An error occurred during habit update' });
	}
});

router.patch('/flag/:habitId', verifyToken, async (req, res) => {
	const { habitId } = req.params;
	const { property, value } = req.body;

	if (typeof property !== 'string' || value === undefined) {
		return res.status(400).json({ message: 'Invalid request data' });
	}

	try {
		// Update the specified property on the current task
		await Habit.findByIdAndUpdate(habitId, { [property]: value });

		res.status(200).json({ message: `Habit has been marked as ${property}` });
	} catch (error) {
		console.error(`Failed to mark habit as ${property}: `, error);
		res.status(500).json({ message: 'An error occurred during the update process' });
	}
});

router.delete('/delete/:habitId', verifyToken, async (req, res) => {
	const { habitId } = req.params;

	try {
		const deletedHabit = await Habit.findByIdAndDelete(habitId);
		if (!deletedHabit) {
			return res.status(400).json({ message: 'Failed to delete the habit.' });
		}

		// Remove the habit ID from all sections where it might still be listed
		await HabitSection.updateMany({ habitIds: habitId }, { $pull: { habitIds: habitId } });

		return res.status(200).json({ success: true, message: `Habit deleted successfully.` });
	} catch (error) {
		return res
			.status(500)
			.json({ message: error instanceof Error ? error.message : 'An error occurred during habit deletion' });
	}
});

export default router;
