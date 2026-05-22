import express from 'express';
import { getDB } from '../../db/db.js';

const router = express.Router();

/**
 * GET /leaderboard
 * Returns the strategy leaderboard based on total profit.
 */
router.get('/leaderboard', async (req, res) => {
  try {
    const db = getDB();
    const leaderboard = await db.all(`
      SELECT
        s.name,
        COUNT(CASE WHEN t.status = 'CLOSED' THEN 1 END) as total_trades,
        (COUNT(CASE WHEN t.status = 'CLOSED' AND t.result > 0 THEN 1 END) * 100.0 / NULLIF(COUNT(CASE WHEN t.status = 'CLOSED' THEN 1 END), 0)) as win_rate,
        SUM(t.result) as total_profit
      FROM strategies s
      LEFT JOIN trades t ON s.id = t.strategy_id
      GROUP BY s.id
      ORDER BY total_profit DESC
    `);
    res.json(leaderboard);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /summary
 * Aggregated metrics for the main dashboard.
 */
router.get('/summary', async (req, res) => {
  try {
    const db = getDB();
    const summary = await db.get(`
      SELECT
        SUM(result) as total_profit,
        COUNT(CASE WHEN status = 'CLOSED' THEN 1 END) as total_trades,
        COUNT(CASE WHEN status = 'CLOSED' AND result > 0 THEN 1 END) as successful_trades
      FROM trades
    `);

    const totalProfit = summary.total_profit || 0;
    const totalTrades = summary.total_trades || 0;
    const winRate = totalTrades ? ((summary.successful_trades / totalTrades) * 100).toFixed(2) : '0.00';

    // Note: Bot activity counting is handled differently if we want to check active processes.
    // This summary focuses on trade stats.
    res.json({
      totalProfit,
      winRate: winRate + '%',
      // activeBots is removed here because it requires botService which is better handled in strategy routes or a separate check.
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /export/:strategyId
 * Streams trade history as CSV.
 */
router.get('/export/:strategyId', async (req, res) => {
  const { strategyId } = req.params;
  try {
    const db = getDB();
    const trades = await db.all('SELECT * FROM trades WHERE strategy_id = ? ORDER BY timestamp DESC', [strategyId]);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=trades_strategy_${strategyId}.csv`);

    const header = 'id,timestamp,symbol,side,price,size_usd,status,result,notes\\n';
    res.write(header);

    trades.forEach(t => {
      const row = [t.id, t.timestamp, t.symbol, t.side, t.price, t.size_usd, t.status, t.result, t.notes].join(',');
      res.write(row + '\\n');
    });

    res.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
