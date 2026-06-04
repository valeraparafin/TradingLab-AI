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
    const id = Number(req.params.id);
    // Explicit guard: a non-numeric id (e.g. /runs/abc) is a 404, not a 500.
    // Don't rely on the sqlite driver coercing NaN to a no-match row.
    if (!Number.isFinite(id)) return res.status(404).json({ error: 'run not found' });
    const detail = await backtestService.getRunDetail(id);
    if (!detail) return res.status(404).json({ error: 'run not found' });
    res.json(detail);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
