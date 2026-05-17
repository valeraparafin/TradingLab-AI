import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
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
 * Helper to slugify strategy names for filenames
 */
function slugify(text) {
  return text.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

/**
 * Helper to check if a template is locked (used by a running strategy)
 */
async function checkTemplateLock(type, id) {
  const db = getDB();

  const strategies = await db.all(
    `SELECT id, name, status, config FROM strategies WHERE config LIKE ?`,
    [`%${id}%`]
  );

  const usedBy = [];
  let activeCount = 0;
  let isLocked = false;

  for (const s of strategies) {
    const config = JSON.parse(s.config);
    const templateId = type === 'logic' ? config.metadata?.logicTemplateId : config.metadata?.riskTemplateId;

    if (templateId === id) {
      usedBy.push({ id: s.id, name: s.name });

      const isRunning = activeBots.has(s.id) || s.status === 'running';
      if (isRunning) {
        isLocked = true;
        activeCount++;
      }
    }
  }

  return { isLocked, usedBy, activeCount };
}

/**
 * Helper to load templates from disk
 */
function loadTemplate(type, id) {
  const filePath = path.join(process.cwd(), 'templates', type, `${id}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Assembler: Merges logic, risk, and user settings into a final strategy config
 */
function assembleStrategy(name, settings, logicTemplateId, riskTemplateId) {
  const logic = loadTemplate('logic', logicTemplateId);
  const risk = loadTemplate('risk', riskTemplateId);

  if (!logic) throw new Error(`Logic template ${logicTemplateId} not found`);
  if (!risk) throw new Error(`Risk template ${riskTemplateId} not found`);

  // Extract risk-related settings from the root of settings if they exist
  // This ensures that UI fields like maxTradeSizeUSD actually override the template
  const riskOverrides = {
    ...(settings.risk || {}),
    ...(settings.maxTradeSizeUSD !== undefined && { maxTradeSizeUSD: settings.maxTradeSizeUSD }),
    ...(settings.maxTradesPerDay !== undefined && { maxTradesPerDay: settings.maxTradesPerDay }),
  };

  return {
    ...settings, // Spread all user settings (watchlist, timeframe, etc.)
    name,
    logic: logic,
    risk: {
      ...risk.settings, // Base risk from template
      ...riskOverrides   // User overrides (both from settings.risk and root settings)
    },
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

  // Find the strategy file. We assume strategies are stored in the /strategies folder
  // as .json files. We try to map the DB name to the filename or look for a matching file.
  const strategyFilePath = path.join(process.cwd(), 'strategies', `${strategy.name}.json`);

  if (fs.existsSync(strategyFilePath)) {
    return spawnBot(strategyFilePath, strategyId);
  }

  // Fallback: check if there is a file that matches the name loosely or is just smc.json/breakout.json
  const files = fs.readdirSync(path.join(process.cwd(), 'strategies'));
  const fallbackFile = files.find(f =>
    f.toLowerCase().includes(strategy.name.toLowerCase().split(' ')[0].toLowerCase()) ||
    (strategy.name.includes('Smart Money') && f === 'smc.json') ||
    (strategy.name.includes('Breakout') && f === 'breakout.json')
  );

  if (fallbackFile) {
    return spawnBot(path.join(process.cwd(), 'strategies', fallbackFile), strategyId);
  }

  throw new Error(`Strategy file not found for ${strategy.name}`);
}

async function spawnBot(filePath, strategyId) {
  const botProcess = spawn('node', ['bot_engine.js', filePath], {
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
    const logicDir = path.join(process.cwd(), 'templates', 'logic');
    const riskDir = path.join(process.cwd(), 'templates', 'risk');

    const logicFiles = fs.existsSync(logicDir)
      ? fs.readdirSync(logicDir).filter(f => f.endsWith('.json'))
      : [];

    const riskFiles = fs.existsSync(riskDir)
      ? fs.readdirSync(riskDir).filter(f => f.endsWith('.json'))
      : [];

    const logicTemplates = await Promise.all(logicFiles.map(async (f) => {
      const id = f.replace('.json', '');
      const content = JSON.parse(fs.readFileSync(path.join(logicDir, f), 'utf8'));
      const lock = await checkTemplateLock('logic', id);
      return { id, name: content.name, ...lock };
    }));

    const riskTemplates = await Promise.all(riskFiles.map(async (f) => {
      const id = f.replace('.json', '');
      const content = JSON.parse(fs.readFileSync(path.join(riskDir, f), 'utf8'), 'utf8');
      const lock = await checkTemplateLock('risk', id);
      return { id, name: content.name, ...lock };
    }));

    res.json({ logic: logicTemplates, risk: riskTemplates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/templates/:type/:id
 * Returns the content of a specific template
 */
app.get('/api/templates/:type/:id', (req, res) => {
  const { type, id } = req.params;
  try {
    const template = loadTemplate(type, id);
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
app.post('/api/templates/:type', (req, res) => {
  const { type } = req.params;
  const { name, ...content } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Template name is required' });
  }

  try {
    const id = slugify(name);
    const dir = path.join(process.cwd(), 'templates', type);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const filePath = path.join(dir, `${id}.json`);
    if (fs.existsSync(filePath)) {
      return res.status(400).json({ error: `Template with id ${id} already exists` });
    }

    const templateData = { name, ...content };
    fs.writeFileSync(filePath, JSON.stringify(templateData, null, 2));

    res.json({ id, name, type });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    const original = loadTemplate(type, id);
    if (!original) {
      return res.status(404).json({ error: `Template ${id} of type ${type} not found` });
    }

    // 3. Handle potential ID change if name changed
    const newId = name ? slugify(name) : id;
    const dir = path.join(process.cwd(), 'templates', type);
    const oldFilePath = path.join(dir, `${id}.json`);
    const newFilePath = path.join(dir, `${newId}.json`);

    // If name changed, check if new ID is already taken
    if (newId !== id && fs.existsSync(newFilePath)) {
      return res.status(400).json({ error: `Template with id ${newId} already exists` });
    }

    // 4. Update content
    const templateData = { name: name || original.name, ...content };
    fs.writeFileSync(newFilePath, JSON.stringify(templateData, null, 2));

    // 5. Delete old file if ID changed
    if (newId !== id) {
      fs.unlinkSync(oldFilePath);
    }

    res.json({ id: newId, name: templateData.name, type });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    const original = loadTemplate(type, id);
    if (!original) {
      return res.status(404).json({ error: `Template ${id} of type ${type} not found` });
    }

    const newId = slugify(newName);
    const dir = path.join(process.cwd(), 'templates', type);
    const newFilePath = path.join(dir, `${newId}.json`);

    if (fs.existsSync(newFilePath)) {
      return res.status(400).json({ error: `Template with id ${newId} already exists` });
    }

    const newTemplateData = { ...original, name: newName };
    fs.writeFileSync(newFilePath, JSON.stringify(newTemplateData, null, 2));

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
    const filePath = path.join(process.cwd(), 'templates', type, `${id}.json`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: `Template ${id} of type ${type} not found` });
    }

    // 3. Delete file
    fs.unlinkSync(filePath);

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
    const finalConfig = assembleStrategy(name, settings || {}, logicTemplateId, riskTemplateId);
    const configString = JSON.stringify(finalConfig);

    // Insert into database
    const result = await db.run(
      'INSERT INTO strategies (name, config) VALUES (?, ?)',
      [name, configString]
    );

    const strategyId = result.lastID;

    // Create strategy file for bot_engine
    const strategiesDir = path.join(process.cwd(), 'strategies');
    if (!fs.existsSync(strategiesDir)) {
      fs.mkdirSync(strategiesDir);
    }

    const fileName = `${slugify(name)}.json`;
    const filePath = path.join(strategiesDir, fileName);
    fs.writeFileSync(filePath, JSON.stringify(finalConfig, null, 2));

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
      const stats = await db.get(`
        SELECT
          COUNT(*) as total_trades,
          SUM(CASE WHEN status = 'LIVE' OR status = 'PAPER' THEN 1 ELSE 0 END) as successful_trades,
          SUM(result) as total_profit
        FROM trades
        WHERE strategy_id = ?`, [s.id]);

      return {
        ...s,
        running: activeBots.has(s.id) || s.status === 'running',
        stats: {
          totalTrades: stats.total_trades || 0,
          winRate: stats.total_trades ? ((stats.successful_trades / stats.total_trades) * 100).toFixed(2) + '%' : '0%',
          totalProfit: stats.total_profit || 0
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
    if (activeBots.has(strategyId)) {
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

    // 2. Delete the config file
    const fileName = `${slugify(strategy.name)}.json`;
    const filePath = path.join(process.cwd(), 'strategies', fileName);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    res.json({ status: 'permanently_deleted', strategyId: Number(strategyId) });
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
  if (!strategyId || !logicTemplateId || !riskTemplateId) {
    return res.status(400).json({ error: 'strategyId, logicTemplateId, and riskTemplateId are required' });
  }

  try {
    const db = getDB();
    const oldStrategy = await db.get('SELECT name FROM strategies WHERE id = ?', [strategyId]);
    if (!oldStrategy) throw new Error(`Strategy ${strategyId} not found`);

    // Re-assemble the strategy using templates
    const finalName = name || oldStrategy.name;
    const finalConfig = assembleStrategy(finalName, settings || {}, logicTemplateId, riskTemplateId);

    await db.run(
      'UPDATE strategies SET name = ?, config = ? WHERE id = ?',
      [finalName, JSON.stringify(finalConfig), strategyId]
    );

    // Fetch the updated strategy to return it in the response
    const updatedStrategy = await db.get('SELECT * FROM strategies WHERE id = ?', [strategyId]);

    // Handle file renaming and content update
    const strategiesDir = path.join(process.cwd(), 'strategies');
    const oldFileName = `${slugify(oldStrategy.name)}.json`;
    const newFileName = `${slugify(finalName)}.json`;
    const oldPath = path.join(strategiesDir, oldFileName);
    const newPath = path.join(strategiesDir, newFileName);

    if (fs.existsSync(oldPath)) {
      if (oldPath !== newPath) {
        fs.renameSync(oldPath, newPath);
      }
    } else {
      console.log(`Warning: Old strategy file not found at ${oldPath}. Creating new one.`);
    }

    fs.writeFileSync(newPath, JSON.stringify(finalConfig, null, 2));

    if (activeBots.has(strategyId)) {
      await stopBot(strategyId);
      await startBot(strategyId);
    }

    res.json({ status: 'updated', strategy: updatedStrategy });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/analytics/leaderboard
 * Aggregated metrics for all strategies.
 */
app.get('/api/analytics/leaderboard', async (req, res) => {
  try {
    const db = getDB();
    const leaderboard = await db.all(`
      SELECT
        s.name,
        COUNT(t.id) as total_trades,
        AVG(CASE WHEN t.status IN ('LIVE', 'PAPER') THEN 1 ELSE 0 END) * 100 as win_rate,
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
        COUNT(*) as total_trades,
        SUM(CASE WHEN result > 0 THEN 1 ELSE 0 END) as successful_trades
      FROM trades
      WHERE status != 'BLOCKED'
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
app.post('/event', (req, res) => {
  const eventData = req.body;
  console.log(`[Event Received] Strategy ${eventData.strategyId}: ${eventData.type}`);

  // Emit to all connected WebSocket clients
  io.emit('event:update', eventData);

  res.sendStatus(200);
});

async function syncStrategies() {
  try {
    const db = getDB();
    const strategiesDir = path.join(process.cwd(), 'strategies');

    if (!fs.existsSync(strategiesDir)) {
      console.log(`Strategies directory not found: ${strategiesDir}`);
      return;
    }

    const files = fs.readdirSync(strategiesDir).filter(f => f.endsWith('.json'));

    for (const file of files) {
      try {
        const content = JSON.parse(fs.readFileSync(path.join(strategiesDir, file), 'utf8'));
        const name = content.strategy?.name || content.name || file.replace('.json', '');
        await db.run('INSERT OR IGNORE INTO strategies (name) VALUES (?)', [name]);
      } catch (err) {
        console.error(`Error syncing strategy file ${file}:`, err.message);
      }
    }
    console.log(`Synced ${files.length} strategies from /strategies folder`);
  } catch (err) {
    console.error('Failed to sync strategies:', err.message);
  }
}

// ─── Initialization ──────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    await initDB();
    await createStatsView();
    await syncStrategies();
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
