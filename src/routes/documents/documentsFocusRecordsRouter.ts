import express from 'express';
import { verifyToken } from '../../middleware/verifyToken';
import { fetchSessionFocusRecordsWithNoBreaks, fetchBeFocusedAppFocusRecords, fetchForestAppFocusRecords, fetchTideAppFocusRecords } from '../../utils/focus.utils';
import { getFocusRecordsHandler, exportFocusRecordsHandler } from '../../controllers/focusRecordsController';
import { getFocusMedalsHandler } from '../../controllers/medalsController';
import { getFocusChallengesHandler } from '../../controllers/challengesController';
import FocusRecord from '../../models/FocusRecord';

const router = express.Router();

router.get('/', verifyToken, getFocusRecordsHandler);
router.get('/export', verifyToken, exportFocusRecordsHandler);
router.get('/medals', verifyToken, getFocusMedalsHandler);
router.get('/challenges', verifyToken, getFocusChallengesHandler);

// GET /all - Returns all focus records with pagination support
router.get('/all', verifyToken, async (req, res) => {
	try {
		const page = parseInt(req.query.page as string) || 1;
		const limit = parseInt(req.query.limit as string) || 5000;
		const skip = (page - 1) * limit;

		// Get total count for pagination metadata
		const total = await FocusRecord.countDocuments({});
		const totalPages = Math.ceil(total / limit);

		// Fetch paginated focus records with .lean() for better performance
		// Sort by startTime descending (newest first)
		const focusRecords = await FocusRecord.find({})
			.sort({ startTime: -1 })
			.skip(skip)
			.limit(limit)
			.lean();

		res.status(200).json({
			data: focusRecords,
			total,
			page,
			totalPages,
			limit
		});
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching all focus records.',
		});
	}
});

router.get('/test-json-data', verifyToken, async (req, res) => {
	try {
		const app = req.query.app as string;

		let focusRecords;
		switch (app) {
			case 'session':
				focusRecords = await fetchSessionFocusRecordsWithNoBreaks();
				break;
			case 'be-focused':
				focusRecords = await fetchBeFocusedAppFocusRecords();
				break;
			case 'forest':
				focusRecords = await fetchForestAppFocusRecords(true);
				break;
			case 'tide':
				focusRecords = await fetchTideAppFocusRecords();
				break;
			default:
				// Default to session if no app specified
				focusRecords = await fetchSessionFocusRecordsWithNoBreaks();
				break;
		}

		res.status(200).json(focusRecords);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching focus records.',
		});
	}
});

export default router;
