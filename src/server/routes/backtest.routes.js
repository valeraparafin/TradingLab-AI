import express from 'express';
import { backtestService } from '../services/backtest.service.js';

const router = express.Router();

/** GET /groups — distinct run groups (+ ungrouped bucket). */
router.get('/groups', async (req, res) => {
  try {
    res.json(await backtestService.listGroups());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /groups/:group — comparison rows for one group ('ungrouped' => null group). */
router.get('/groups/:group', async (req, res) => {
  try {
    res.json(await backtestService.getGroup(req.params.group));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /runs/:id — run detail: metrics/params/costs + equity curve + trades. */
router.get('/runs/:id', async (req, res) => {
  try {
    const detail = await backtestService.getRunDetail(Number(req.params.id));
    if (!detail) return res.status(404).json({ error: 'run not found' });
    res.json(detail);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
