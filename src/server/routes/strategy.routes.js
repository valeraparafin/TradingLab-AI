import express from 'express';
import { strategyService } from '../services/strategy.service.js';
import { botService } from '../services/bot.service.js';
import { getDB } from '../../../db.js';
import { toCamel, toSnake } from '../../../src/utils/casing.js';
import { precisionManager } from '../../../src/utils/precision.js';
import { z } from 'zod';
import {
  RiskSettingsSchema,
  LogicConfigSchema
} from '../schemas/strategy.schema.js';
import { UpdateStrategyDTO } from '../dtos/strategy.dto.js';

const router = express.Router();

/**
 * GET /export/:strategyId
 * Streams trade history as CSV.
 */
router.get('/export/:strategyId', async (req, res) => {
  const { strategyId } = req.params;
  try {
    const db = getDB();

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=trades_strategy_${strategyId}.csv`);

    const header = 'id,timestamp,symbol,side,price,size_usd,status,result,notes\\n';
    res.write(header);

    await db.each(
      'SELECT * FROM trades WHERE strategy_id = ? ORDER BY timestamp DESC',
      [strategyId],
      (err, row) => {
        if (err) {
          console.error(`[CSVExport] Error reading row: ${err.message}`);
          return;
        }
        const csvRow = [
          row.id,
          row.timestamp,
          row.symbol,
          row.side,
          row.price,
          row.size_usd,
          row.status,
          row.result,
          row.notes
        ].join(',');
        res.write(csvRow + '\\n');
      },
      async () => {
        res.end();
      }
    );
  } catch (err) {
    console.error(`[CSVExport] Stream failed: ${err.message}`);
    res.status(500).json({ error: 'Export failed' });
  }
});

/**
 * POST /
 * Creates a new strategy.
 */
router.post('/', async (req, res) => {
  console.log('>>> POST /api/strategies request received!');
  console.log('>>> Request Body:', JSON.stringify(req.body));
  try {
    const strategy = await strategyService.createStrategy(req.body);
    console.log('>>> Strategy created successfully:', strategy);
    res.status(201).json(strategy);
  } catch (err) {
    console.log('>>> POST /api/strategies ERROR:', err);
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /
 * Returns all strategies with their current status and a performance summary.
 */
router.get('/', async (req, res) => {
  try {
    const archived = req.query.archived === 'true';
    const strategies = await strategyService.getAllStrategies();
    // Note: StrategyService.getAllStrategies currently ignores 'archived' param,
    // we can update the service to accept it.
    res.json(strategies);
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
      // Note: startBot was a local function in server.js,
      // it should be moved to botService or strategyService.
      // Assuming botService.startBot exists or we use a helper.
      await botService.spawnBot(strategyId);
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
    await strategyService.archiveStrategy(strategyId);
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
    await strategyService.restoreStrategy(strategyId);
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
    await strategyService.deleteStrategy(strategyId);
    res.json({ status: 'permanently_deleted', strategyId: Number(strategyId) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * PATCH /:id/risk
 * Updates partial risk settings for a strategy and restarts bot if running.
 */
router.patch('/:id/risk', async (req, res) => {
  const { id: strategyId } = req.params;

  try {
    const result = await strategyService.updateRiskSettings(strategyId, req.body);
    res.json({ ...result, strategyId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /:id/logic
 * Updates partial logic configuration for a strategy and restarts bot if running.
 */
router.patch('/:id/logic', async (req, res) => {
  const { id: strategyId } = req.params;

  try {
    const result = await strategyService.updateLogicConfig(strategyId, req.body);
    res.json({ ...result, strategyId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /full-config/:id
 * Returns a unified flat object containing both logic and risk parameters.
 */
router.get('/full-config/:id', async (req, res) => {
  const strategyId = Number(req.params.id);
  try {
    const config = await strategyService.getFullConfig(strategyId);
    if (!config) return res.status(404).json({ error: 'Strategy config not found' });
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /config
 * Updates strategy configuration and restarts the bot if running.
 */
router.post('/config', async (req, res) => {
  const { strategyId } = req.body;
  if (!strategyId) return res.status(400).json({ error: 'strategyId is required' });

  try {
    const updatedStrategy = await strategyService.updateFullConfig(strategyId, req.body);
    if (botService.isActive(strategyId)) {
      await botService.stopBot(strategyId);
      await botService.spawnBot(strategyId);
    }
    res.json({ status: 'updated', strategy: updatedStrategy });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /stats/:id
 * Returns KPI stats for a specific strategy from the strategy_stats view.
 */
router.get('/stats/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const stats = await strategyService.getStats(id);
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
    // The service already returns numeric fields + pricePrecision; the client
    // formats at the view (shared formatPrice). No server-side string formatting.
    const positions = await strategyService.getPositions(id);
    res.json(positions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /xai/:id
 * Returns the latest fresh XAI state for a strategy.
 */
router.get('/xai/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const xaiState = await strategyService.getLastXaiState(id);
    if (!xaiState) return res.json(null);

    // Format XAI results: use 'INDICATOR' precision for values since XAI usually shows indicator levels
    const formattedXai = {};
    for (const [symbol, state] of Object.entries(xaiState)) {
      formattedXai[symbol] = {
        ...state,
        results: state.results?.map(r => ({
          ...r,
          actual: typeof r.actual === 'number' ? precisionManager.format(r.actual, 'INDICATOR') : r.actual
        }))
      };
    }

    res.json(formattedXai);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /positions/closed/:id
 * Returns all closed positions for a specific strategy.
 */
router.get('/positions/closed/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const positions = await strategyService.getClosedPositions(id);
    res.json(positions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /trades/:id
 * Returns trade history for a specific strategy.
 */
router.get('/trades/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const trades = await strategyService.getTradeHistory(id);
    res.json(trades);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /events/:strategyId
 * Returns event logs for a specific strategy.
 */

router.get('/events/:strategyId', async (req, res) => {
  const { strategyId } = req.params;
  const limit = req.query.limit ? parseInt(req.query.limit) : 100;

  try {
    const events = await strategyService.getEvents(strategyId);
    const slicedEvents = events.slice(0, limit).reverse();
    res.json(slicedEvents);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
