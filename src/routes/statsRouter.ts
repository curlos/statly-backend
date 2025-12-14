import express from 'express';
import { getOverviewStatsHandler, getStatsFocusHandler, getStatsTasksHandler } from '../controllers/statsOverviewController';
import { verifyToken } from '../middleware/verifyToken';

const router = express.Router();

router.get('/overview', verifyToken, getOverviewStatsHandler);
router.get('/focus', verifyToken, getStatsFocusHandler);
router.get('/tasks', verifyToken, getStatsTasksHandler);

export default router;
