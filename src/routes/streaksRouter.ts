import express from 'express';
import { verifyToken } from '../middleware/verifyToken';
import {
	getTodayFocus,
	getStreakHistory,
	getCombinedStreakHistory
} from '../controllers/streaksController';

const router = express.Router();

// GET /streaks/today - Today's focus for all active rings
router.get('/today', verifyToken, getTodayFocus);

// GET /streaks/history - Streak history for all active rings
router.get('/history', verifyToken, getStreakHistory);

// GET /streaks/combined - Combined streak history for all active rings
router.get('/combined', verifyToken, getCombinedStreakHistory);

export default router;
