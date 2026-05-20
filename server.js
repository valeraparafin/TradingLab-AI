import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { promises as fsp } from 'fs';
import { z } from 'zod';
import { initDB, getDB, createStatsView } from './db.js';

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
const activeBots = new Map();

/**
 * Zod Schemas for Template Validation
 */
const LogicTemplateSchema = z.object({
  name: z.string().min(1),
  type: z.string(),
  indicators: z.record(z.any()),
  safety_checks: z.array(z.object({
    id: z.string(),
    description: z.string(),
  })).optional(),
});

const RiskTemplateSchema = z.object({
  name: z.string().min(1),
  settings: z.object({
    riskPerTradePercent: z.number().positive(),
    maxTradeSizeUSD: z.number().positive(),
    stopLossPercent: z.number().positive(),
    takeProfitPercent: z.number().positive(),
    maxTradesPerDay: z.number().int().positive(),
  }),
});

/**
 * TemplateService: Business logic for managing templates
 */
class TemplateService {
  constructor() {
    this.templatesDir = path.join(process.cwd(), 'templates');
  }

  async loadTemplate(type, id) {
    try {
      const filePath = path.join(this.templatesDir, type, `${id}.json`);
      const data = await fsp.readFile(filePath, 'utf8');
      return JSON.parse(data);
    } catch (err) {
      return null;
    }
  }

  async saveTemplate(type, id, data) {
    const schema = type === 'logic' ? LogicTemplateSchema : RiskTemplateSchema;
    schema.parse(data);

    const dir = path.join(this.templatesDir, type);
    await fsp.mkdir(dir, { recursive: true });

    const filePath = path.join(dir, `${id}.json`);
    await fsp.writeFile(filePath, JSON.stringify(data, null, 2));
  }

  async listTemplates(type, lockChecker) {
    const dir = path.join(this.templatesDir, type);
    try {
      const files = await fsp.readdir(dir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));

      return await Promise.all(jsonFiles.map(async (f) => {
        const id = f.replace('.json', '');
        const content = await this.loadTemplate(type, id);
        const lock = await lockChecker(type, id);
        return {
          id,
          name: content?.name || id,
          ...lock
        };
      }));
    } catch (err) {
      return [];
    }
  }

  async deleteTemplate(type, id) {
    const filePath = path.join(this.templatesDir, type, `${id}.json`);
    await fsp.unlink(filePath);
  }

  async duplicateTemplate(type, id, newId) {
    const data = await this.loadTemplate(type, id);
    if (!data) throw new Error(`Template ${id} of type ${type} not found`);
    await this.saveTemplate(type, newId, data);
  }
}

const templateService = new TemplateService();

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

    const isRunning = activeBots.has(s.id) || s.status === 'running';
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

  return spawnBot(strategyId);
}

async function spawnBot(strategyId) {
  const botProcess = spawn('node', ['bot_engine.js'], {
    stdio: 'inherit',
    env: { ...process.env, STRATEGY_ID: strategyId }
  });

  botProcess.on('exit', (code) => {
    console.log(`Bot for strategy ${strategyId} exited with code ${code}`);
    activeBots.delete(Number(strategyId));
    getDB().run('UPDATE strategies SET status = ? WHERE id = ?', ['stopped', strategyId]).catch(console.error);

    // Notify frontend via WebSocket that the bot has stopped
    io.emit('event:update', {
      strategyId,
      type: 'status_change',
      payload: { status: 'stopped' }
    });
  });

  activeBots.set(Number(strategyId), botProcess);
  await getDB().run(
    'UPDATE strategies SET status = ?, last_run = CURRENT_TIMESTAMP WHERE id = ?',
    ['running', strategyId]
  );

  // Notify frontend via WebSocket that the bot has started
  io.emit('event:update', {
    strategyId,
    type: 'status_change',
    payload: { status: 'running' }
  });

  return botProcess;
}

/**
 * Stops a running bot process.
 */
async function stopBot(strategyId) {
  const botProcess = activeBots.get(Number(strategyId));
  if (botProcess) {
    botProcess.kill('SIGTERM');
    activeBots.delete(Number(strategyId));
  }
  const db = getDB();
  await db.run('UPDATE strategies SET status = ? WHERE id = ?', ['stopped', strategyId]);

  // Notify frontend via WebSocket that the bot has stopped
  io.emit('event:update', {
    strategyId,
    type: 'status_change',
    payload: { status: 'stopped' }
  });
}

// ─── API Endpoints ────────────────────────────────────────────────────────────────

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

    // 3. Handle potential ID change if name changed
    const newId = name ? slugify(name) : id;

    // If name changed, check if new ID is already taken
    if (newId !== id) {
      const exists = await templateService.loadTemplate(type, newId);
      if (exists) {
        return res.status(400).json({ error: `Template with id ${newId} already exists` });
      }
    }

    // 4. Update content
    const templateData = { name: name || original.name, ...content };
    await templateService.saveTemplate(type, newId, templateData);

    // 5. Delete old file if ID changed
    if (newId !== id) {
      await templateService.deleteTemplate(type, id);
    }

    res.json({ id: newId, name: templateData.name, type });
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
 * Creates a new strategy by assembling templates
 */
app.post('/api/strategies', async (req, res) => {
  const { name, logicTemplateId, riskTemplateId, settings } = req.body;
  if (!name || !logicTemplateId || !riskTemplateId) {
    return res.status(400).json({ error: 'Name, logicTemplateId, and riskTemplateId are required' });
  }

  try {
    const db = getDB();

    // Assemble the full strategy config
    const finalConfig = await assembleStrategy(name, settings || {}, logicTemplateId, riskTemplateId);
    const configString = JSON.stringify(finalConfig);

    // Insert into database
    const result = await db.run(
      'INSERT INTO strategies (name, config) VALUES (?, ?)',
      [name, configString]
    );

    const strategyId = result.lastID;

    res.json({ id: strategyId, name, status: 'stopped' });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      res.status(400).json({ error: 'Strategy with this name already exists' });
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
    const strategies = await db.all('SELECT * FROM strategies WHERE is_archived = ?', [archived ? 1 : 0]);

    const strategiesWithStats = await Promise.all(strategies.map(async (s) => {
      const stats = await db.get('SELECT * FROM strategy_stats WHERE strategy_id = ?', [s.id]);

      return {
        ...s,
        running: activeBots.has(s.id) || s.status === 'running',
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
 * POST /api/strategies/toggle
 * Starts or stops a bot.
 */
app.post('/api/strategies/toggle', async (req, res) => {
  const { strategyId } = req.body;
  if (!strategyId) return res.status(400).json({ error: 'strategyId is required' });

  try {
    if (activeBots.has(Number(strategyId))) {
      await stopBot(strategyId);
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
    await stopBot(strategyId);
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
 * GET /api/strategies/config/:id
 * Returns the combined configuration for a strategy (assembled from templates and overrides).
 */
app.get('/api/strategies/config/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const db = getDB();
    const strategy = await db.get('SELECT * FROM strategies WHERE id = ?', [id]);

    if (!strategy) {
      return res.status(404).json({ error: `Strategy ${id} not found` });
    }

    const config = JSON.parse(strategy.config);

    // Use assembleStrategy to regenerate the combined config.
    // This ensures the response is consistent with what the bot_engine actually sees.
    const assembled = await assembleStrategy(
      strategy.name,
      config, // passing the existing config as the settings object
      config.metadata?.logicTemplateId || config.logicTemplateId,
      config.metadata?.riskTemplateId || config.riskTemplateId
    );

    res.json(assembled);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/strategies/config
 * Updates strategy configuration and restarts the bot if running.
 */
app.post('/api/strategies/config', async (req, res) => {
  const { strategyId, name, logicTemplateId, riskTemplateId, settings } = req.body;
  if (!strategyId) return res.status(400).json({ error: 'strategyId is required' });

  try {
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

    await db.run(
      'UPDATE strategies SET name = ?, config = ? WHERE id = ?',
      [finalName, JSON.stringify(finalConfig), strategyId]
    );

    // Fetch the updated strategy to return it in the response
    const updatedStrategy = await db.get('SELECT * FROM strategies WHERE id = ?', [strategyId]);

    if (activeBots.has(Number(strategyId))) {
      await stopBot(strategyId);
      await startBot(strategyId);
    }

    res.json({ status: 'updated', strategy: updatedStrategy });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
      const isProcessActive = activeBots.has(s.id);
      const isDbRunning = s.status === 'running';
      return isProcessActive || isDbRunning;
    }).length;

    console.log(`[Analytics Summary] Total strategies: ${strategies.length}, Active count: ${activeBotsCount}`);
    console.log(`[Analytics Summary] ActiveBot Map size: ${activeBots.size}`);
    strategies.forEach(s => {
      console.log(`[Analytics Summary] Strategy ID ${s.id}: status=${s.status}, inMap=${activeBots.has(s.id)}`);
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
