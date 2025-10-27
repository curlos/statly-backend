import express from 'express';
import { verifyToken } from '../../middleware/verifyToken';
import { getOverviewStatsHandler, getStatsFocusHandler } from '../../controllers/statsOverviewController';

const router = express.Router();

router.get('/overview', verifyToken, getOverviewStatsHandler);
router.get('/focus', verifyToken, getStatsFocusHandler);

export default router;
