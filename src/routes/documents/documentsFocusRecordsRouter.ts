import express from 'express';
import { verifyToken } from '../../middleware/verifyToken';
import { fetchTickTickFocusRecords } from '../../utils/focus.utils';
import { getFocusRecordsHandler } from '../../controllers/focusRecordsController';

const router = express.Router();

router.get('/', verifyToken, getFocusRecordsHandler);

router.get('/test-json-data', verifyToken, async (req, res) => {
	try {
		const todayOnly = req.query.today === 'true';

		const sortedAllFocusData = await fetchTickTickFocusRecords({
			todayOnly,
			doNotUseMongoDB: false,
		});

		res.status(200).json(sortedAllFocusData);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching focus records from TickTick API.',
		});
	}
});

export default router;
