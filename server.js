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

import { botService } from './src/server/services/bot.service.js';
import { strategyService } from './src/server/services/strategy.service.js';
import { assetService } from './src/server/services/asset.service.js';
import { aiStrategyService } from './src/server/services/aiStrategyService.js';
import AgentOrchestrator from './src/agents/AgentOrchestrator.js';
import templateRouter from './src/server/routes/template.routes.js';
import strategyRouter from './src/server/routes/strategy.routes.js';
import analyticsRouter from './src/server/routes/analytics.routes.js';
import assetRouter from './src/server/routes/asset.routes.js';

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

app.use('/api/templates', templateRouter);
app.use('/api', strategyRouter);
app.use('/api/strategies', strategyRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/assets', assetRouter);

let orchestrator = null;

app.get('/api/agents', async (req, res) => {
  try {
    const agents = await aiStrategyService.listAgents();
    res.json({ success: true, data: agents });
  } catch (err) {
    console.error(`[Agents List Error] ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/agents/risk-templates', async (req, res) => {
  try {
    const templates = await aiStrategyService.listRiskTemplates();
    res.json({ success: true, data: templates });
  } catch (err) {
    console.error(`[Risk Templates Error] ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/agents/start', async (req, res) => {
  const { agent_id } = req.body;

  if (!agent_id) {
    return res.status(400).json({ success: false, error: 'Missing agent_id' });
  }

  try {
    const db = getDB();
    const agent = await db.get('SELECT * FROM ai_strategies WHERE id = ?', [agent_id]);
    if (!agent) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    const riskProfile = await aiStrategyService.getRiskProfile(agent.risk_profile_id);
    if (!riskProfile) {
      return res.status(404).json({ success: false, error: 'Risk profile not found' });
    }

    // Map DB snake_case to AgentOrchestrator's expectations if necessary
    // Note: AgentOrchestrator uses this.config.risk_per_trade_percent
    const config = {
      ...riskProfile,
      symbols: ['BTCUSDT', 'ETHUSDT'], // Default symbols
      portfolioValue: 10000,        // Default portfolio
      cycleInterval: 300000        // Default interval
    };

    if (orchestrator) {
      orchestrator.stop();
    }

    orchestrator = new AgentOrchestrator(io, config);
    orchestrator.start();

    res.json({ status: 'started', message: `Agentic trading loop initiated for agent ${agent_id}` });
  } catch (err) {
    console.error(`[Agent Start Error] ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/agents/stop', (req, res) => {
  orchestrator.stop();
  res.json({ status: 'stopped', message: 'Agentic trading loop halted' });
});

app.get('/api/agents/trades', async (req, res) => {
  const { interval = 'day' } = req.query;
  try {
    const db = getDB();

    // Define time range based on interval
    let dateFilter = 'datetime(\'now\', \'-1 day\')';
    if (interval === 'week') dateFilter = 'datetime(\'now\', \'-7 days\')';
    if (interval === 'month') dateFilter = 'datetime(\'now\', \'-30 days\')';

    // AI trades are stored in paper_trades (default mode)
    const trades = await db.all(
      `SELECT * FROM paper_trades WHERE timestamp >= ${dateFilter} ORDER BY timestamp DESC`
    );

    const activePositions = await db.all(
      `SELECT * FROM active_positions WHERE status = 'OPEN'`
    );

    res.json({
      success: true,
      data: {
        trades,
        activePositions
      }
    });
  } catch (err) {
    console.error(`[AI Trades Error] ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/agents/summary', async (req, res) => {
  try {
    const db = getDB();

    // Calculate total PnL from paper_trades
    // In paper_trades, we don't have a 'result' column like in 'trades',
    // we'd need to calculate it or add it.
    // For now, let's sum up some mock PnL or a simplified version.
    const stats = await db.get(`
      SELECT
        COUNT(*) as totalTrades,
        SUM(CASE WHEN status = 'EXECUTED' THEN 1 ELSE 0 END) as successfulTrades
      FROM paper_trades
    `);

    res.json({
      success: true,
      data: {
        totalProfit: '0.00', // Placeholder until we implement PnL calculation for paper trades
        totalPnlPercent: '0%',
        winRate: '0%',
        activeBots: '1'
      }
    });
  } catch (err) {
    console.error(`[AI Summary Error] ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/agents/config', async (req, res) => {
  const { agent_id, settings } = req.body;
  if (!agent_id || !settings) {
    return res.status(400).json({ success: false, error: 'Missing agent_id or settings' });
  }

  try {
    const db = getDB();
    const agent = await db.get('SELECT * FROM ai_strategies WHERE id = ?', [agent_id]);
    if (!agent) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    const result = await aiStrategyService.updateRiskProfile(agent.risk_profile_id, settings);
    res.json({
      success: true,
      status: result.changes > 0 ? 'updated' : 'no_changes',
      message: result.changes > 0 ? 'Configuration updated successfully' : 'No changes detected'
    });
  } catch (err) {
    console.error(`[Config Update Error] ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/agents/config/:agent_id', async (req, res) => {
  const { agent_id } = req.params;
  try {
    const db = getDB();
    const config = await db.get(
      `SELECT p.* FROM ai_risk_profiles p
       JOIN ai_strategies s ON s.risk_profile_id = p.id
       WHERE s.id = ?`,
      [agent_id]
    );

    if (!config) {
      return res.status(404).json({ success: false, error: 'Configuration not found for this agent' });
    }

    res.json({
      success: true,
      data: config
    });
  } catch (err) {
    console.error(`[Config Fetch Error] ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
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
      'INSERT INTO events (strategy_id, type, payload, timestamp) VALUES (?, ?, ?, ?)',
      [strategyId, eventData.type, JSON.stringify(eventData.payload || {}), Date.now()]
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
    await assetService.init();
    await aiStrategyService.seedTemplates();
    await syncStrategies();
    botService.setIo(io);
    // orchestrator.start(); // Removed: agents now start only via API button
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
