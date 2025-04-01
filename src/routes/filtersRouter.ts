// src/routes/taskRouter.ts
import express from 'express';
import Filter from '../models/FilterModel';
import { verifyToken } from '../middleware/verifyToken';
const router = express.Router();

router.get('/', verifyToken, async (req, res) => {
	try {
		const filters = await Filter.find(); // Fetch projects based on the filter
		res.status(200).json(filters);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching the filters.',
		});
	}
});

router.post('/add', verifyToken, async (req, res) => {
	try {
		const newFilter = new Filter(req.body);
		const savedFilter = await newFilter.save();

		return res.status(201).json(savedFilter);
	} catch (error) {
		return res
			.status(400)
			.json({ message: error instanceof Error ? error.message : 'An error occurred during filter creation' });
	}
});

router.put('/edit/:filterId', verifyToken, async (req, res) => {
	const { filterId } = req.params;

	try {
		const updatedFilter = await Filter.findByIdAndUpdate(filterId, req.body, { new: true, runValidators: true });

		if (!updatedFilter) {
			return res.status(404).json({ message: 'Filter not found' });
		}

		res.status(200).json(updatedFilter);
	} catch (error) {
		return res
			.status(400)
			.json({ message: error instanceof Error ? error.message : 'An error occurred during filter update' });
	}
});

router.delete('/delete/:filterId', verifyToken, async (req, res) => {
	const { filterId } = req.params;

	try {
		const deletedFilter = await Filter.findByIdAndDelete(filterId);
		if (!deletedFilter) {
			return res.status(400).json({ message: 'Failed to delete the filter.' });
		}

		return res.status(200).json({ success: true, message: `Filter deleted successfully.` });
	} catch (error) {
		return res
			.status(500)
			.json({ message: error instanceof Error ? error.message : 'An error occurred during filter deletion' });
	}
});

export default router;
