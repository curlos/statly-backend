import express from 'express';
import { verifyToken } from '../middleware/verifyToken';
import {
	getTodayFocus,
	getStreakHistory
} from '../controllers/streaksController';

const router = express.Router();

// GET /streaks/today - Today's focus for all active rings
router.get('/today', verifyToken, getTodayFocus);

// GET /streaks/history - Streak history for all active rings
router.get('/history', verifyToken, getStreakHistory);

export default router;
