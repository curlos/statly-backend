// src/routes/taskRouter.ts
import express from 'express';
const router = express.Router();
import { sortedAllFocusData } from '../../focus-data/allFocusData';

router.get('/', async (req, res) => {
	try {
		const focusRecords = sortedAllFocusData;
		res.status(200).json(focusRecords);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching the focus data.',
		});
	}
});

export default router;
