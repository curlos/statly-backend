import express from 'express';
import { verifyToken } from '../../middleware/verifyToken';
import { fetchSessionFocusRecordsWithNoBreaks, fetchBeFocusedAppFocusRecords, fetchForestAppFocusRecords, fetchTideAppFocusRecords } from '../../utils/focus.utils';
import { getFocusRecordsHandler } from '../../controllers/focusRecordsController';

const router = express.Router();

router.get('/', verifyToken, getFocusRecordsHandler);

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
