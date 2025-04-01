import express from 'express';
import Matrix from '../models/MatrixModel';
import { verifyToken } from '../middleware/verifyToken';

const router = express.Router();

router.get('/', verifyToken, async (req, res) => {
	try {
		// Use projection to exclude the _id field from selectedPriorities and dateOptions
		const matrices = await Matrix.find({}, { 'selectedPriorities._id': 0, 'dateOptions._id': 0 });
		res.status(200).json(matrices);
	} catch (error) {
		res.status(500).json({ message: 'Error fetching matrices', error });
	}
});

router.post('/add', verifyToken, async (req, res) => {
	const { name, selectedProjects, selectedDates, selectedPriorities, projectId } = req.body;
	const newMatrix = new Matrix({
		name,
		selectedProjects,
		selectedDates,
		selectedPriorities,
		projectId,
	});

	try {
		const savedMatrix = await newMatrix.save();
		res.status(201).json(savedMatrix);
	} catch (error) {
		res.status(500).json({ message: 'Error adding the matrix', error });
	}
});

router.put('/edit/:id', verifyToken, async (req, res) => {
	const { id } = req.params;

	try {
		const updatedMatrix = await Matrix.findByIdAndUpdate(id, req.body, { new: true, runValidators: true });

		if (!updatedMatrix) {
			return res.status(404).json({ message: 'Matrix not found' });
		}

		res.status(200).json(updatedMatrix);
	} catch (error) {
		res.status(500).json({ message: 'Error updating the matrix', error });
	}
});

export default router;
