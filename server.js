import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { promises as fsp } from 'fs';
import { z } from 'zod';
import {
  LogicTemplateSchema,
  RiskTemplateSchema,
  RiskSettingsSchema,
  LogicConfigSchema
} from './src/server/schemas/strategy.schema.js';
import { UpdateStrategyDTO } from './src/server/dtos/strategy.dto.js';
import { initDB, getDB, createStatsView } from './db.js';
import { PrecisionManager } from './src/utils/precision.js';
import { toCamel, toSnake } from './src/utils/casing.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// Store for active bot processes: strategyId -> ChildProcess
import { templateService } from './src/server/services/template.service.js';
import { botService } from './src/server/services/bot.service.js';
// The botService.activeBots map replaces the local activeBots map

/**
 * Zod Schemas for Template and Strategy Validation
 */
 


const precisionManager = new PrecisionManager();

/**
 * Helper to check if a template is locked (used by a running strategy)
 */
async function checkTemplateLock(type, id) {
  const db = getDB();

  // Use json_extract to filter strategies that use this template ID in the metadata
  // config is stored as a JSON string in the database.
  // path: '$.metadata.logicTemplateId' or '$.metadata.riskTemplateId'
  const jsonPath = type === 'logic' ? '$.metadata.logicTemplateId' : '$.metadata.riskTemplateId';

  const strategies = await db.all(
    `SELECT id, name, status, config FROM strategies WHERE json_extract(config, ?) = ?`,
    [jsonPath, id]
  );

  const usedBy = [];
  let activeCount = 0;
  let isLocked = false;

  for (const s of strategies) {
    usedBy.push({ id: s.id, name: s.name });

    const isRunning = botService.isActive(s.id) || s.status === 'running';
    if (isRunning) {
      isLocked = true;
      activeCount++;
    }
  }

  return { isLocked, usedBy, activeCount };
}

/**
 * Assembler: Merges logic, risk, and user settings into a final strategy config
 */
async function assembleStrategy(name, settings, logicTemplateId, riskTemplateId) {
  const [logic, risk] = await Promise.all([
    templateService.loadTemplate('logic', logicTemplateId),
    templateService.loadTemplate('risk', riskTemplateId)
  ]);

  if (!logic) throw new Error(`Logic template ${logicTemplateId} not found`);
  if (!risk) throw new Error(`Risk template ${riskTemplateId} not found`);

  // Calculate Risk Overrides
  const riskSettings = risk.settings || risk.content?.settings || risk;

  // Start with existing overrides if they exist in settings
  const riskOverrides = { ...(settings.riskOverrides || {}) };

  // Extract desired risk values from settings (top-level or inside .risk)
  const desiredRisk = {
    ...(settings.risk || {}),
    ...settings
  };

  for (const [key, value] of Object.entries(desiredRisk)) {
    if (riskSettings[key] !== undefined) {
      if (value !== undefined) {
        if (value !== riskSettings[key]) {
          riskOverrides[key] = value;
        } else {
          // If it now matches the template, remove the override
          delete riskOverrides[key];
        }
      }
    }
  }
  console.log(`[Assemble] Resulting Overrides:`, riskOverrides);



  // Calculate Logic Overrides (if any settings are provided for logic)
  const logicOverrides = {};
  if (settings.logic) {
    for (const [key, value] of Object.entries(settings.logic)) {
      if (value !== undefined && JSON.stringify(value) !== JSON.stringify(logic[key])) {
        logicOverrides[key] = value;
      }
    }
  }

  return {
    name,
    riskTemplateId,
    riskOverrides,
    logicTemplateId,
    logicOverrides,
    // Preserve only non-risk and non-logic settings (watchlist, timeframe, paperTrading, tradeMode, etc.)
    ...Object.fromEntries(
      Object.entries(settings).filter(([key]) => {
        const riskFields = ['maxTradesPerDay', 'maxTradeSizeUSD', 'riskPerTradePercent', 'stopLossPercent', 'takeProfitPercent', 'risk'];
        const logicFields = ['logic'];
        return !riskFields.includes(key) && !logicFields.includes(key);
      })
    ),
    metadata: {
      logicTemplateId,
      riskTemplateId,
      assembledAt: new Date().toISOString()
    }
  };


}

/**
 * Starts a bot engine process for a specific strategy.

 */
async function startBot(strategyId) {
  const db = getDB();
  const strategy = await db.get('SELECT * FROM strategies WHERE id = ?', [strategyId]);
  if (!strategy) throw new Error(`Strategy ${strategyId} not found`);

  return botService.spawnBot(strategyId);
}

 

/**
 * GET /api/precision
 * Returns the decimal precision for a given symbol.
 */
app.get('/api/precision', async (req, res) => {
  const { symbol } = req.query;
  if (!symbol) {
    return res.status(400).json({ error: 'symbol query parameter is required' });
  }
  try {
    const precision = await precisionManager.getPrecision(symbol);
    res.json({ symbol, precision });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/templates
 * Returns available logic and risk templates
 */
app.get('/api/templates', async (req, res) => {
  try {
    const logicTemplates = await templateService.listTemplates('logic', checkTemplateLock);
    const riskTemplates = await templateService.listTemplates('risk', checkTemplateLock);

    res.json({ logic: logicTemplates, risk: riskTemplates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/templates/:type/:id
 * Returns the content of a specific template
 */
app.get('/api/templates/:type/:id', async (req, res) => {
  const { type, id } = req.params;
  try {
    const template = await templateService.loadTemplate(type, id);
    if (!template) {
      return res.status(404).json({ error: `Template ${id} of type ${type} not found` });
    }
    res.json(template);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/templates/:type
 * Creates a new template
 */
app.post('/api/templates/:type', async (req, res) => {
  const { type } = req.params;
  const { name, ...content } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Template name is required' });
  }

  try {
    const id = slugify(name);
    const templateData = { name, ...content };
    await templateService.saveTemplate(type, id, templateData);

    res.json({ id, name, type });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.message });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

/**
 * PUT /api/templates/:type/:id
 * Updates a template's name and content.
 * Enforces lock if the template is used by a running bot.
 */
app.put('/api/templates/:type/:id', async (req, res) => {
  const { type, id } = req.params;
  const { name, ...content } = req.body;

  try {
    // 1. Check for lock
    const lock = await checkTemplateLock(type, id);
    if (lock.isLocked) {
      return res.status(403).json({
        error: 'Template is locked because it is used by running strategies',
        activeStrategies: lock.usedBy
      });
    }

    // 2. Verify template exists
    const original = await templateService.loadTemplate(type, id);
    if (!original) {
      return res.status(404).json({ error: `Template ${id} of type ${type} not found` });
    }

    // 3. Update content (ID remains constant to avoid breaking strategy links)
    const templateData = { name: name || original.name, ...content };
    await templateService.saveTemplate(type, id, templateData);

    res.json({ id, name: templateData.name, type });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.message });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

/**
 * POST /api/templates/:type/:id/duplicate
 * Creates a copy of an existing template with a new name.
 */
app.post('/api/templates/:type/:id/duplicate', async (req, res) => {
  const { type, id } = req.params;
  const { newName } = req.body;

  if (!newName) {
    return res.status(400).json({ error: 'newName is required for duplication' });
  }

  try {
    const newId = slugify(newName);
    await templateService.duplicateTemplate(type, id, newId);

    res.json({ id: newId, name: newName, type });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/templates/:type/:id
 * Removes a template file.
 * Enforces lock if the template is used by a running bot.
 */
app.delete('/api/templates/:type/:id', async (req, res) => {
  const { type, id } = req.params;

  try {
    // 1. Check for lock
    const lock = await checkTemplateLock(type, id);
    if (lock.isLocked) {
      return res.status(403).json({
        error: 'Template is locked because it is used by running strategies',
        activeStrategies: lock.usedBy
      });
    }

    // 2. Verify template exists
    const template = await templateService.loadTemplate(type, id);
    if (!template) {
      return res.status(404).json({ error: `Template ${id} of type ${type} not found` });
    }

    // 3. Delete template
    await templateService.deleteTemplate(type, id);

    res.json({ status: 'deleted', id, type });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


/**
 * POST /api/strategies
 * Creates a new strategy by assembling templates and saving as a snapshot.
 */
app.post('/api/strategies', async (req, res) => {
  const { name, logicTemplateId, riskTemplateId, settings } = req.body;
  if (!name || !logicTemplateId || !riskTemplateId) {
    return res.status(400).json({ error: 'Name, logicTemplateId, and riskTemplateId are required' });
  }

  try {
    const db = getDB();

    // 1. Assemble the strategy configuration
    const finalConfig = await assembleStrategy(name, settings || {}, logicTemplateId, riskTemplateId);

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
        [name, JSON.stringify(toSnake(logicConfig))]
      );
      const strategyId = result.lastID;

      await db.run(
        `INSERT INTO strategy_risk_settings
        (strategy_id, risk_per_trade_percent, stop_loss_percent, take_profit_percent, min_risk_reward_ratio, max_portfolio_heat_percent, max_open_positions, max_trades_per_day, daily_loss_limit_percent, daily_profit_target_percent)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          strategyId,
          riskSettings.risk_per_trade_percent,
          riskSettings.stop_loss_percent,
          riskSettings.take_profit_percent,
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
 * GET /api/strategies
 * Returns all strategies with their current status and a performance summary.
 */
app.get('/api/strategies', async (req, res) => {
  try {
    const db = getDB();
    const archived = req.query.archived === 'true';

    const strategiesWithStats = await db.all(`
      SELECT s.*,
             st.totalTrades,
             st.winRate,
             st.netPnL as totalProfit
      FROM strategies s
      LEFT JOIN strategy_stats st ON s.id = st.strategy_id
      WHERE s.is_archived = ?`,
      [archived ? 1 : 0]
    );

    const result = strategiesWithStats.map(s => {
      const camelS = toCamel(s);
      return {
        ...camelS,
        running: botService.isActive(s.id) || s.status === 'running',
        stats: {
          totalTrades: s.totalTrades || 0,
          winRate: s.winRate ? `${s.winRate.toFixed(2)}%` : '0%',
          totalProfit: s.totalProfit || 0
        }
      };
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/strategies/toggle
 * Starts or stops a bot.
 */
app.post('/api/strategies/toggle', async (req, res) => {
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
 * POST /api/strategies/archive
 * Archives a strategy and stops it if it's running.
 */
app.post('/api/strategies/archive', async (req, res) => {
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
 * POST /api/strategies/restore
 * Restores an archived strategy.
 */
app.post('/api/strategies/restore', async (req, res) => {
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
 * DELETE /api/strategies/:id
 * Permanently deletes an archived strategy and its config file.
 */
app.delete('/api/strategies/:id', async (req, res) => {
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
 * PATCH /api/strategies/:id/risk
 * Updates partial risk settings for a strategy and restarts bot if running.
 */
app.patch('/api/strategies/:id/risk', async (req, res) => {
  const { id: strategyId } = req.params;
  const updates = toSnake(req.body);

  try {
    const db = getDB();

    // Validate partial payload
    RiskSettingsSchema.partial().parse(updates);

    // Build dynamic SQL update
    const columns = Object.keys(updates);
    if (columns.length === 0) {
      return res.status(400).json({ error: 'No risk settings provided for update' });
    }

    // Dirty Check: Compare updates with existing settings
    const currentSettings = await db.get('SELECT * FROM strategy_risk_settings WHERE strategy_id = ?', [strategyId]);
    if (!currentSettings) return res.status(404).json({ error: 'Risk settings not found' });

    let isDirty = false;
    for (const [key, value] of Object.entries(updates)) {
      if (currentSettings[key] !== value) {
        isDirty = true;
        break;
      }
    }

    if (!isDirty) {
      return res.json({ status: 'no_change', strategyId });
    }

    const setClause = columns.map(col => `${col} = ?`).join(', ');
    const values = [...Object.values(updates), strategyId];

    await db.run(`UPDATE strategy_risk_settings SET ${setClause} WHERE strategy_id = ?`, values);

    // Bot Restart Trigger
    if (botService.isActive(strategyId) || (await db.get('SELECT status FROM strategies WHERE id = ?', [strategyId]))?.status === 'running') {
      await botService.restartBot(strategyId);
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
 * PATCH /api/strategies/:id/logic
 * Updates partial logic configuration for a strategy and restarts bot if running.
 */
app.patch('/api/strategies/:id/logic', async (req, res) => {
  const { id: strategyId } = req.params;
  const updates = toSnake(req.body);

  try {
    const db = getDB();
    const strategy = await db.get('SELECT logic_config FROM strategies WHERE id = ?', [strategyId]);
    if (!strategy) return res.status(404).json({ error: 'Strategy not found' });

    const currentLogic = JSON.parse(strategy.logic_config || '{}');

    // Dirty Check: Compare merged result with current config
    const mergedLogic = { ...currentLogic, ...updates };
    if (JSON.stringify(currentLogic) === JSON.stringify(mergedLogic)) {
      return res.json({ status: 'no_change', strategyId });
    }

    // Validate merged config
    LogicConfigSchema.parse(mergedLogic);

    await db.run('UPDATE strategies SET logic_config = ? WHERE id = ?', [JSON.stringify(mergedLogic), strategyId]);

    // Bot Restart Trigger
    if (botService.isActive(strategyId) || (await db.get('SELECT status FROM strategies WHERE id = ?', [strategyId]))?.status === 'running') {
      await botService.restartBot(strategyId);
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
 * GET /api/strategies/full-config/:id
 * Returns a unified flat object containing both logic and risk parameters.
 */
app.get('/api/strategies/full-config/:id', async (req, res) => {
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
      ...toCamel(row),
      ...toCamel(logicConfig),
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
 * POST /api/strategies/config
 * Updates strategy configuration and restarts the bot if running.
 */
app.post('/api/strategies/config', async (req, res) => {
  const { strategyId } = req.body;
  if (!strategyId) return res.status(400).json({ error: 'strategyId is required' });

  try {
    const validatedData = UpdateStrategyDTO.parse(req.body);
    const { name, logicTemplateId, riskTemplateId, settings } = validatedData;
    const db = getDB();
    const oldStrategy = await db.get('SELECT name, config FROM strategies WHERE id = ?', [strategyId]);
    if (!oldStrategy) throw new Error(`Strategy ${strategyId} not found`);

    // Use provided template IDs or fallback to existing ones from config
    let finalLogicTemplateId = logicTemplateId;
    let finalRiskTemplateId = riskTemplateId;
    let finalSettings = { ...oldStrategy.config }; // Start with existing config

    if (!finalLogicTemplateId || !finalRiskTemplateId) {
      const existingConfig = JSON.parse(oldStrategy.config);
      finalLogicTemplateId = logicTemplateId || existingConfig.metadata?.logicTemplateId;
      finalRiskTemplateId = riskTemplateId || existingConfig.metadata?.riskTemplateId;
    }

    if (!finalLogicTemplateId || !finalRiskTemplateId) {
      return res.status(400).json({ error: 'logicTemplateId and riskTemplateId are required' });
    }

    // Merge new settings updates into existing settings
    // We expect 'settings' to be the object containing overrides (triggerMode, interval, etc.)
    const currentConfig = JSON.parse(oldStrategy.config);
    const mergedSettings = {
      ...currentConfig,
      ...settings
    };

    // CRITICAL: Remove existing metadata and assembled overrides to prevent them from being treated as settings
    // during re-assembly, and prevent duplicate metadata entries.
    delete mergedSettings.metadata;
    delete mergedSettings.riskOverrides;
    delete mergedSettings.logicOverrides;


    // Re-assemble the strategy using templates and merged settings
    const finalName = name || oldStrategy.name;
    const finalConfig = await assembleStrategy(finalName, mergedSettings, finalLogicTemplateId, finalRiskTemplateId);

    await db.run('UPDATE strategies SET name = ?, config = ? WHERE id = ?',
      [finalName, JSON.stringify(toSnake(finalConfig)), strategyId]
    );

    // Fetch the updated strategy to return it in the response
    const updatedStrategy = await db.get('SELECT * FROM strategies WHERE id = ?', [strategyId]);

    if (botService.isActive(strategyId)) {
      await botService.stopBot(strategyId);
      await startBot(strategyId);
    }

    res.json({ status: 'updated', strategy: updatedStrategy });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.message });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

/**
 * GET /api/strategies/stats/:id
 * Returns KPI stats for a specific strategy from the strategy_stats view.
 */
app.get('/api/strategies/stats/:id', async (req, res) => {
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
 * GET /api/strategies/positions/:id
 * Returns all active positions for a specific strategy.
 */
app.get('/api/strategies/positions/:id', async (req, res) => {
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
          // Long: size * (current / entry - 1)
          // Short: size * (1 - current / entry)
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

app.get('/api/strategies/events/:strategyId', async (req, res) => {
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

app.get('/api/analytics/leaderboard', async (req, res) => {
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
 * GET /api/analytics/summary
 * Aggregated metrics for the main dashboard.
 */
app.get('/api/analytics/summary', async (req, res) => {
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

    // Count active bots from both DB status and active process map (only non-archived)
    const strategies = await db.all('SELECT id, status FROM strategies WHERE is_archived = 0');
    const activeBotsCount = strategies.filter(s => {
      const isProcessActive = botService.isActive(s.id);
      const isDbRunning = s.status === 'running';
      return isProcessActive || isDbRunning;
    }).length;

    console.log(`[Analytics Summary] Total strategies: ${strategies.length}, Active count: ${activeBotsCount}`);
    console.log(`[Analytics Summary] ActiveBot Map size: ${botService.activeBots.size}`);
    strategies.forEach(s => {
      console.log(`[Analytics Summary] Strategy ID ${s.id}: status=${s.status}, inMap=${botService.activeBots.has(s.id)}`);
    });

    res.json({
      totalProfit,
      winRate: winRate + '%',
      activeBots: `${activeBotsCount} / ${strategies.length}`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/export/:strategyId
 * Streams trade history as CSV.
 */
app.get('/api/export/:strategyId', async (req, res) => {
  const { strategyId } = req.params;
  try {
    const db = getDB();

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=trades_strategy_${strategyId}.csv`);

    const header = 'id,timestamp,symbol,side,price,size_usd,status,result,notes\\n';
    res.write(header);

    // Use db.each for streaming records one by one to avoid loading everything into memory
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
 * POST /event
 * Endpoint for bot_engine.js to report real-time events.
 */
app.post('/event', async (req, res) => {
  const eventData = req.body;
  const strategyId = eventData.strategyId;
  console.log(`[Event Received] Strategy ${strategyId}: ${eventData.type}`);

  try {
    const db = getDB();
    // Automatically mark strategy as running in DB since it's sending events
    await db.run('UPDATE strategies SET status = ? WHERE id = ?', ['running', strategyId]);

    // Insert main event to get eventId
    const result = await db.run(
      'INSERT INTO events (strategy_id, type, payload, timestamp) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
      [strategyId, eventData.type, JSON.stringify(eventData.payload || {})]
    );
    const eventId = result.lastID;

    // If safety_check event with results, store rule scores
    if (eventData.type === 'safety_check' && Array.isArray(eventData.payload?.results)) {
      await Promise.all(
        eventData.payload.results.map(result =>
          db.run(
            'INSERT INTO event_scores (event_id, rule_id, score, actual_value) VALUES (?, ?, ?, ?)',
            [eventId, result.label, result.score, result.actual]
          )
        )
      );
    }
  } catch (err) {
    console.error(`[Event Error] Failed to process event for strategy ${strategyId}: ${err.message}`);
  }

  // Emit to all connected WebSocket clients
  io.emit('event:update', eventData);
  res.sendStatus(200);
});

async function syncStrategies() {
  // This function is now a legacy stub.
  // Strategies are managed via API and DB, not via the /strategies folder.
  console.log(`[Sync] Strategy synchronization from filesystem is disabled (SSOT mode).`);
}

// ─── Initialization ──────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    await initDB();
    await createStatsView();
    await syncStrategies();
    // Reset all strategy statuses to 'stopped' on startup since child processes are gone
    await getDB().run('UPDATE strategies SET status = ? WHERE status = ?', ['stopped', 'running']);
    httpServer.listen(PORT, () => {
      console.log(`🚀 Orchestrator Server running on http://localhost:${PORT}`);
      console.log(`🔌 WebSocket server enabled`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();
