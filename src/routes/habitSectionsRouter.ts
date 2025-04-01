import express from 'express';
import HabitSection from '../models/HabitSectionModel';
import { verifyToken } from '../middleware/verifyToken';
const router = express.Router();

router.get('/', verifyToken, async (req, res) => {
	try {
		const habitSections = await HabitSection.find();
		res.status(200).json(habitSections);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching the habit sections.',
		});
	}
});

router.post('/add', verifyToken, async (req, res) => {
	try {
		const newHabitSection = new HabitSection(req.body);
		const savedHabitSection = await newHabitSection.save();

		return res.status(201).json(savedHabitSection);
	} catch (error) {
		return res.status(400).json({
			message: error instanceof Error ? error.message : 'An error occurred during habit section creation',
		});
	}
});

router.put('/edit/:habitSectionId', verifyToken, async (req, res) => {
	const { habitSectionId } = req.params;

	try {
		const updatedHabit = await HabitSection.findByIdAndUpdate(habitSectionId, req.body, {
			new: true,
			runValidators: true,
		});

		if (!updatedHabit) {
			return res.status(404).json({ message: 'Habit section not found' });
		}

		res.status(200).json(updatedHabit);
	} catch (error) {
		return res.status(400).json({
			message: error instanceof Error ? error.message : 'An error occurred during habit section update',
		});
	}
});

router.delete('/delete/:habitSectionId', verifyToken, async (req, res) => {
	const { habitSectionId } = req.params;

	try {
		const deletedHabitSection = await HabitSection.findByIdAndDelete(habitSectionId);
		if (!deletedHabitSection) {
			return res.status(400).json({ message: 'Failed to delete the habit section.' });
		}

		return res.status(200).json({ success: true, message: `Habit section deleted successfully.` });
	} catch (error) {
		return res
			.status(500)
			.json({
				message: error instanceof Error ? error.message : 'An error occurred during habit section deletion',
			});
	}
});

export default router;
