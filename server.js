import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { initDB, getDB } from './db.js';

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
    activeBots.delete(strategyId);
    getDB().run('UPDATE strategies SET status = ? WHERE id = ?', ['stopped', strategyId]).catch(console.error);
  });

  activeBots.set(strategyId, botProcess);
  return botProcess;
}

/**
 * Stops a running bot process.
 */
async function stopBot(strategyId) {
  const botProcess = activeBots.get(strategyId);
  if (botProcess) {
    botProcess.kill('SIGTERM');
    activeBots.delete(strategyId);
  }
  const db = getDB();
  await db.run('UPDATE strategies SET status = ? WHERE id = ?', ['stopped', strategyId]);
}

// ─── API Endpoints ────────────────────────────────────────────────────────────────

/**
 * GET /api/strategies
 * Returns all strategies with their current status and a performance summary.
 */
app.get('/api/strategies', async (req, res) => {
  try {
    const db = getDB();
    const strategies = await db.all('SELECT * FROM strategies');

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
 * POST /api/strategies/config
 * Updates strategy configuration and restarts the bot if running.
 */
app.post('/api/strategies/config', async (req, res) => {
  const { strategyId, config } = req.body;
  if (!strategyId || !config) return res.status(400).json({ error: 'strategyId and config are required' });

  try {
    const db = getDB();
    await db.run('UPDATE strategies SET config = ? WHERE id = ?', [JSON.stringify(config), strategyId]);

    if (activeBots.has(strategyId)) {
      await stopBot(strategyId);
      await startBot(strategyId);
    }

    res.json({ status: 'updated', strategyId });
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

// ─── Initialization ──────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    await initDB();
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
