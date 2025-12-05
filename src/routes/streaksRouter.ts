import express from 'express';
import { verifyToken } from '../middleware/verifyToken';
import { getTodayFocus, getStreakHistory } from '../controllers/streaksController';

const router = express.Router();

// GET /streaks/today - Today's focus hours only (fast)
router.get('/today', verifyToken, getTodayFocus);

// GET /streaks/history - Full streak history (current + longest)
router.get('/history', verifyToken, getStreakHistory);

export default router;
