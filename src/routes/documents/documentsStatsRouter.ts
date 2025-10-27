import express from 'express';
import { verifyToken } from '../../middleware/verifyToken';
import { getOverviewStatsHandler } from '../../controllers/statsOverviewController';

const router = express.Router();

router.get('/overview', verifyToken, getOverviewStatsHandler);

export default router;
