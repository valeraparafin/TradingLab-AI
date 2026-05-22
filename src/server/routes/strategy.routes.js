import express from 'express';
import { botService } from '../services/bot.service.js';
import { strategyService } from '../services/strategy.service.js';
import { getDB } from '../../db/db.js';
import { z } from 'zod';
import { RiskSettingsSchema, LogicConfigSchema } from '../schemas/strategy.schema.js';

const router = express.Router();

/**
 * Helper to start a bot engine process.
 */
async function startBot(strategyId) {
  const db = getDB();
  const strategy = await db.get('SELECT * FROM strategies WHERE id = ?', [strategyId]);
  if (!strategy) throw new Error(`Strategy ${strategyId} not found`);

  return botService.spawnBot(strategyId);
}

/**
 * GET /
 * Returns all strategies with their current status and a performance summary.
 */
router.get('/', async (req, res) => {
  try {
    const db = getDB();
    const archived = req.query.archived === 'true';
    const strategies = await db.all('SELECT *, logic_config as config FROM strategies WHERE is_archived = ?', [archived ? 1 : 0]);

    const strategiesWithStats = await Promise.all(strategies.map(async (s) => {
      const stats = await db.get('SELECT * FROM strategy_stats WHERE strategy_id = ?', [s.id]);

      return {
        ...s,
        running: botService.isActive(s.id) || s.status === 'running',
        stats: {
          totalTrades: stats?.totalTrades || 0,
          winRate: stats?.winRate ? `${stats.winRate.toFixed(2)}%` : '0%',
          totalProfit: stats?.netPnL || 0
        }
      };
    }));

    res.json(strategiesWithStats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /toggle
 * Starts or stops a bot.
 */
router.post('/toggle', async (req, res) => {
  const { strategyId } = req.body;
  if (!strategyId) return res.status(400).json({ error: 'strategyId is required' });

  try {
    if (botService.isActive(strategyId)) {
      await botService.stopBot(strategyId);
      res.json({ status: 'stopped', strategyId });
    } else {
      await startBot(strategyId);
      res.json({ status: 'running', strategyId });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /archive
 * Archives a strategy and stops it if it's running.
 */
router.post('/archive', async (req, res) => {
  const { strategyId } = req.body;
  if (!strategyId) return res.status(400).json({ error: 'strategyId is required' });

  try {
    await botService.stopBot(strategyId);
    const db = getDB();
    await db.run('UPDATE strategies SET is_archived = 1 WHERE id = ?', [strategyId]);
    res.json({ status: 'archived', strategyId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /restore
 * Restores an archived strategy.
 */
router.post('/restore', async (req, res) => {
  const { strategyId } = req.body;
  if (!strategyId) return res.status(400).json({ error: 'strategyId is required' });

  try {
    const db = getDB();
    await db.run('UPDATE strategies SET is_archived = 0 WHERE id = ?', [strategyId]);
    res.json({ status: 'restored', strategyId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /:id
 * Permanently deletes an archived strategy and its config file.
 */
router.delete('/:id', async (req, res) => {
  const strategyId = req.params.id;
  try {
    const db = getDB();
    const strategy = await db.get('SELECT name, is_archived FROM strategies WHERE id = ?', [strategyId]);

    if (!strategy) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    if (strategy.is_archived === 0) {
      return res.status(400).json({ error: 'Strategy must be archived before permanent deletion' });
    }

    // 1. Delete from DB (CASCADE handles trades, events, positions)
    await db.run('DELETE FROM strategies WHERE id = ?', [strategyId]);

    res.json({ status: 'permanently_deleted', strategyId: Number(strategyId) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /:id/risk
 * Updates partial risk settings for a strategy and restarts bot if running.
 */
router.patch('/:id/risk', async (req, res) => {
  const { id: strategyId } = req.params;
  const updates = req.body;

  try {
    const db = getDB();

    // Validate partial payload
    RiskSettingsSchema.partial().parse(updates);

    // Build dynamic SQL update
    const columns = Object.keys(updates);
    if (columns.length === 0) {
      return res.status(400).json({ error: 'No risk settings provided for update' });
    }

    const setClause = columns.map(col => `${col} = ?`).join(', ');
    const values = [...Object.values(updates), strategyId];

    await db.run(`UPDATE strategy_risk_settings SET ${setClause} WHERE strategy_id = ?`, values);

    // Bot Restart Trigger
    if (botService.isActive(strategyId) || (await db.get('SELECT status FROM strategies WHERE id = ?', [strategyId]))?.status === 'running') {
      await botService.stopBot(strategyId);
      await startBot(strategyId);
    }

    res.json({ status: 'updated', strategyId });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.message });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

/**
 * PATCH /:id/logic
 * Updates partial logic configuration for a strategy and restarts bot if running.
 */
router.patch('/:id/logic', async (req, res) => {
  const { id: strategyId } = req.params;
  const updates = req.body;

  try {
    const db = getDB();
    const strategy = await db.get('SELECT logic_config FROM strategies WHERE id = ?', [strategyId]);
    if (!strategy) return res.status(404).json({ error: 'Strategy not found' });

    const currentLogic = JSON.parse(strategy.logic_config || '{}');
    const mergedLogic = { ...currentLogic, ...updates };

    // Validate merged config
    LogicConfigSchema.parse(mergedLogic);

    await db.run('UPDATE strategies SET logic_config = ? WHERE id = ?', [JSON.stringify(mergedLogic), strategyId]);

    // Bot Restart Trigger
    if (botService.isActive(strategyId) || (await db.get('SELECT status FROM strategies WHERE id = ?', [strategyId]))?.status === 'running') {
      await botService.stopBot(strategyId);
      await startBot(strategyId);
    }

    res.json({ status: 'updated', strategyId });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.message });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

/**
 * GET /full-config/:id
 * Returns a unified flat object containing both logic and risk parameters.
 */
router.get('/full-config/:id', async (req, res) => {
  const { id: strategyId } = req.params;
  try {
    const db = getDB();
    const row = await db.get(`
      SELECT s.*, r.*
      FROM strategies s
      JOIN strategy_risk_settings r ON s.id = r.strategy_id
      WHERE s.id = ?`,
      [strategyId]
    );

    if (!row) return res.status(404).json({ error: 'Strategy config not found' });

    const logicConfig = JSON.parse(row.logic_config || '{}');

    // Flatten the result: combine strategy metadata, logic_config, and risk settings
    const fullConfig = {
      ...row,
      ...logicConfig,
      // Remove redundant keys from the JOIN result
      logic_config: undefined,
      strategy_id: undefined
    };
    delete fullConfig.logic_config;
    delete fullConfig.strategy_id;

    res.json(fullConfig);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /config
 * Updates strategy configuration and restarts the bot if running.
 */
router.post('/config', async (req, res) => {
  const { strategyId, name, logicTemplateId, riskTemplateId, settings } = req.body;
  if (!strategyId) return res.status(400).json({ error: 'strategyId is required' });

  try {
    const db = getDB();
    const oldStrategy = await db.get('SELECT name, logic_config FROM strategies WHERE id = ?', [strategyId]);
    if (!oldStrategy) throw new Error(`Strategy ${strategyId} not found`);

    // Use provided template IDs or fallback to existing ones from config
    let finalLogicTemplateId = logicTemplateId;
    let finalRiskTemplateId = riskTemplateId;

    if (!finalLogicTemplateId || !finalRiskTemplateId) {
      const existingConfig = JSON.parse(oldStrategy.logic_config);
      finalLogicTemplateId = logicTemplateId || existingConfig.metadata?.logicTemplateId;
      finalRiskTemplateId = riskTemplateId || existingConfig.metadata?.riskTemplateId;
    }

    if (!finalLogicTemplateId || !finalRiskTemplateId) {
      return res.status(400).json({ error: 'logicTemplateId and riskTemplateId are required' });
    }

    // Merge new settings updates into existing settings
    const currentConfig = JSON.parse(oldStrategy.logic_config);
    const mergedSettings = {
      ...currentConfig,
      ...settings
    };

    // Re-assemble the strategy using templates and merged settings
    const finalName = name || oldStrategy.name;
    const finalConfig = await strategyService.assembleStrategy(finalName, mergedSettings, finalLogicTemplateId, finalRiskTemplateId);

    await db.run(
      'UPDATE strategies SET name = ?, logic_config = ? WHERE id = ?',
      [finalName, JSON.stringify(finalConfig), strategyId]
    );

    // Fetch the updated strategy to return it in the response
    const updatedStrategy = await db.get('SELECT * FROM strategies WHERE id = ?', [strategyId]);

    if (botService.isActive(strategyId)) {
      await botService.stopBot(strategyId);
      await startBot(strategyId);
    }

    res.json({ status: 'updated', strategy: updatedStrategy });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /
 * Creates a new strategy by assembling templates and saving as a snapshot.
 */
router.post('/', async (req, res) => {
  const { name, logicTemplateId, riskTemplateId, settings } = req.body;
  if (!name || !logicTemplateId || !riskTemplateId) {
    return res.status(400).json({ error: 'Name, logicTemplateId, and riskTemplateId are required' });
  }

  try {
    const db = getDB();

    // 1. Assemble the strategy configuration
    const finalConfig = await strategyService.assembleStrategy(name, settings || {}, logicTemplateId, riskTemplateId);

    // Separate Logic and Risk for the snapshot model
    const logicConfig = {
      ...finalConfig,
      metadata: finalConfig.metadata
    };
    delete logicConfig.riskOverrides;
    delete logicConfig.riskTemplateId;
    delete logicConfig.name;

    const riskSettings = {
      risk_per_trade_percent: (settings?.risk?.riskPerTradePercent ?? finalConfig.riskOverrides?.riskPerTradePercent ?? 1.0),
      stop_loss_percent: (settings?.risk?.stopLossPercent ?? finalConfig.riskOverrides?.stopLossPercent ?? 2.0),
      take_profit_percent: (settings?.risk?.takeProfitPercent ?? finalConfig.riskOverrides?.takeProfitPercent ?? 4.0),
      min_risk_reward_ratio: (settings?.risk?.minRiskRewardRatio ?? 2.0),
      max_portfolio_heat_percent: (settings?.risk?.maxPortfolioHeatPercent ?? 10.0),
      max_open_positions: (settings?.risk?.maxOpenPositions ?? 5),
      max_trades_per_day: (settings?.risk?.maxTradesPerDay ?? finalConfig.riskOverrides?.maxTradesPerDay ?? 10),
      daily_loss_limit_percent: (settings?.risk?.dailyLossLimitPercent ?? 3.0),
      daily_profit_target_percent: (settings?.risk?.dailyProfitTargetPercent ?? 5.0),
    };

    // Validate risk settings with Zod
    RiskSettingsSchema.parse(riskSettings);

    // 2. Save in a single transaction
    await db.run('BEGIN TRANSACTION');
    try {
      const result = await db.run(
        'INSERT INTO strategies (name, logic_config) VALUES (?, ?)',
        [name, JSON.stringify(logicConfig)]
      );
      const strategyId = result.lastID;

      await db.run(
        `INSERT INTO strategy_risk_settings
        (strategy_id, risk_per_trade_percent, stop_loss_percent, take_profit_percent, max_trade_size_usd, min_risk_reward_ratio, max_portfolio_heat_percent, max_open_positions, max_trades_per_day, daily_loss_limit_percent, daily_profit_target_percent)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          strategyId,
          riskSettings.risk_per_trade_percent,
          riskSettings.stop_loss_percent,
          riskSettings.take_profit_percent,
          riskSettings.max_trade_size_usd || 100,
          riskSettings.min_risk_reward_ratio,
          riskSettings.max_portfolio_heat_percent,
          riskSettings.max_open_positions,
          riskSettings.max_trades_per_day,
          riskSettings.daily_loss_limit_percent,
          riskSettings.daily_profit_target_percent
        ]
      );
      await db.run('COMMIT');

      res.json({ id: result.lastID, name, status: 'stopped' });
    } catch (transactionError) {
      await db.run('ROLLBACK');
      throw transactionError;
    }
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      res.status(400).json({ error: 'Strategy with this name already exists' });
    } else if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.message });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

/**
 * GET /stats/:id
 * Returns KPI stats for a specific strategy from the strategy_stats view.
 */
router.get('/stats/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const db = getDB();
    const stats = await db.get('SELECT * FROM strategy_stats WHERE strategy_id = ?', [id]);

    if (!stats) {
      return res.json({
        strategy_id: id,
        netPnL: 0,
        totalTrades: 0,
        totalOrders: 0,
        winRate: 0,
        profitFactor: 0,
        successfulTrades: 0,
        failedTrades: 0,
        avgTradeProfit: 0
      });
    }
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /positions/:id
 * Returns all active positions for a specific strategy.
 */
router.get('/positions/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const db = getDB();
    const positions = await db.all('SELECT * FROM active_positions WHERE strategy_id = ? AND status = \'OPEN\'', [id]);

    const mappedPositions = await Promise.all(positions.map(async (pos) => {
      let currentPrice = 0;
      let pnl = 0;

      try {
        // Fetch current price from Binance public API
        const response = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${pos.symbol}`);
        if (response.ok) {
          const data = await response.json();
          currentPrice = parseFloat(data.price);

          // Calculate initial PnL
          const isBuy = pos.side === 'BUY';
          pnl = isBuy
            ? pos.size_usd * (currentPrice / pos.entry_price - 1)
            : pos.size_usd * (1 - currentPrice / pos.entry_price);
        }
      } catch (err) {
        console.error(`[PositionFetch] Failed to get price for ${pos.symbol}: ${err.message}`);
      }

      return {
        symbol: pos.symbol,
        side: pos.side === 'BUY' ? 'LONG' : (pos.side === 'SELL' ? 'SHORT' : pos.side),
        entryPrice: pos.entry_price,
        currentPrice: currentPrice,
        pnl: pnl,
        sl: pos.stop_loss,
        tp: pos.take_profit
      };
    }));

    res.json(mappedPositions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /events/:strategyId
 * Returns detailed logs of safety checks and engine events.
 */
router.get('/events/:strategyId', async (req, res) => {
  const { strategyId } = req.params;
  const limit = req.query.limit ? parseInt(req.query.limit) : 100;

  try {
    const db = getDB();
    const events = await db.all(
      'SELECT id, strategy_id as strategyId, timestamp, type, payload FROM events WHERE strategy_id = ? ORDER BY timestamp DESC LIMIT ?',
      [strategyId, limit]
    );

    const transformedEvents = events.map(e => ({
      ...e,
      payload: e.payload ? JSON.parse(e.payload) : null
    }));

    res.json(transformedEvents.reverse());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
