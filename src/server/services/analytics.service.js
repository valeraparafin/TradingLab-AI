import { getDB } from '../../../db.js';
import { botService } from './bot.service.js';
import { toCamel } from '../../../src/utils/casing.js';
import { precisionManager } from '../../../src/utils/precision.js';

class AnalyticsService {
  /**
   * Returns the leaderboard: name, total trades, win rate, and total profit.
   */
  async getLeaderboard() {
    const db = getDB();
    const results = await db.all(`
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
    
    const camelResults = toCamel(results);
    return camelResults.map(row => ({
      ...row,
      totalProfit: precisionManager.format(row.totalProfit || 0, 'USDT'),
      winRate: row.winRate ? precisionManager.format(row.winRate, 'PERCENT') : '0.00%'
    }));
  }

  /**
   * Aggregated metrics for the main dashboard.
   */
  async getSummary() {
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

    // Calculate total profit percentage
    // We need the total investment (sum of size_usd for all unique positions opened)
    // or we can use a simpler approach: sum of (pnl_percent * size_usd) / total_volume
    // Actually, a better way to get a "portfolio percentage" is to track initial capital
    // But since we don't have a global starting balance, we can calculate the aggregated PnL%
    // as a weighted average of all closed trades' pnl_percent relative to their size.

    const trades = await db.all('SELECT result, size_usd FROM trades WHERE status = "CLOSED"');
    let aggProfit = 0;
    let totalVolume = 0;

    for (const t of trades) {
      const result = Number(t.result || 0);
      const size = Number(t.size_usd || 0);
      aggProfit += result;
      totalVolume += size;
    }

    const totalPnlPercent = totalVolume > 0 ? (aggProfit / totalVolume) * 100 : 0;

    // Count active bots from both DB status and active process map (only non-archived)
    const strategies = await db.all('SELECT id, status FROM strategies WHERE is_archived = 0');
    const activeBotsCount = strategies.filter(s => {
      const isProcessActive = botService.isActive(s.id);
      const isDbRunning = s.status === 'running';
      return isProcessActive || isDbRunning;
    }).length;

    return {
      totalProfit: precisionManager.format(totalProfit, 'USDT'),
      totalPnlPercent: precisionManager.format(totalPnlPercent, 'PERCENT'),
      winRate: precisionManager.format(parseFloat(winRate), 'PERCENT'),
      activeBots: `${activeBotsCount} / ${strategies.length}`
    };
  }
}

export const analyticsService = new AnalyticsService();
