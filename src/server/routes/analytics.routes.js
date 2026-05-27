import express from 'express';
import { analyticsService } from '../services/analytics.service.js';

const router = express.Router();

router.get('/leaderboard', async (req, res) => {
  try {
    const leaderboard = await analyticsService.getLeaderboard();
    res.json(leaderboard);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/summary', async (req, res) => {
  try {
    const summary = await analyticsService.getSummary();
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
