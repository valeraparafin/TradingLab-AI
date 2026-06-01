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

const orchestrators = new Map(); // agent_id (Number) -> AgentOrchestrator

// ── Static /api/agents routes (MUST be before parameterized /:id routes) ─────

app.get('/api/agents', async (req, res) => {
  try {
    const includeArchived = req.query.archived === 'true';
    const agents = await aiStrategyService.listAgents(includeArchived);
    res.json({ success: true, data: agents });
  } catch (err) {
    console.error(`[Agents List Error] ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/agents', async (req, res) => {
  try {
    if (!req.body.name) return res.status(400).json({ success: false, error: 'Missing name' });
    const result = await aiStrategyService.createAgent(req.body);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error(`[Agent Create Error] ${err.message}`);
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
  const agentId = Number(req.body.agent_id);
  if (!agentId) return res.status(400).json({ success: false, error: 'Missing agent_id' });
  // Reserve the slot synchronously to prevent duplicate starts under concurrent requests.
  if (orchestrators.has(agentId)) return res.json({ status: 'already_running' });
  orchestrators.set(agentId, null); // null = reserved / starting
  try {
    const agent = await aiStrategyService.getAgent(agentId);
    if (!agent) {
      orchestrators.delete(agentId);
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    const riskProfile = agent.risk_profile_id ? await aiStrategyService.getRiskProfile(agent.risk_profile_id) : {};
    if (!agent.risk_profile_id || !riskProfile || Object.keys(riskProfile).length === 0) {
      console.warn(`[Agent Start] Agent ${agentId} is starting WITHOUT risk constraints — no risk profile configured.`);
    }
    // Real-mode safety: no exchange-account picker yet -> force paper trading regardless of agent.paper_trading.
    const paperTrading = true; // TODO: honor agent.paper_trading once exchange accounts exist

    let indicators = ['SMC'];
    try {
      const resolved = await aiStrategyService.getLogicTemplateIndicators(agent.logic_template_id);
      if (resolved?.length) indicators = resolved;
    } catch (e) { /* keep default */ }

    const config = {
      ...riskProfile,
      agentId,
      logicTemplateId: agent.logic_template_id,
      indicators,
      symbols: (agent.watchlist || 'BTCUSDT,ETHUSDT').split(',').map(s => s.trim()).filter(Boolean),
      timeframe: agent.timeframe || '1H',
      portfolioValue: agent.portfolio_value || 10000,
      cycleInterval: agent.cycle_interval_ms || 300000,
      paperTrading,
    };

    const o = new AgentOrchestrator(io, config);
    o.start();
    orchestrators.set(agentId, o);
    await aiStrategyService.updateAgent(agentId, { status: 'running', last_run: new Date().toISOString() });
    io.emit('agent:status', { agentId, status: 'running' });
    res.json({ status: 'started' });
  } catch (err) {
    orchestrators.delete(agentId); // roll back reservation on failure
    console.error(`[Agent Start Error] ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/agents/stop', async (req, res) => {
  const agentId = Number(req.body.agent_id);
  if (!agentId) return res.status(400).json({ success: false, error: 'Missing agent_id' });
  try {
    const o = orchestrators.get(agentId);
    if (o) o.stop();
    orchestrators.delete(agentId);
    await aiStrategyService.updateAgent(agentId, { status: 'stopped' });
    io.emit('agent:status', { agentId, status: 'stopped' });
    res.json({ status: 'stopped' });
  } catch (err) {
    console.error(`[Agent Stop Error] ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/agents/trades', async (req, res) => {
  const { interval = 'day', agent_id } = req.query;
  try {
    const db = getDB('ai');
    let dateFilter = "datetime('now', '-1 day')";
    if (interval === 'week')  dateFilter = "datetime('now', '-7 days')";
    if (interval === 'month') dateFilter = "datetime('now', '-30 days')";
    const params = [];
    let sql = `SELECT * FROM ai_paper_trades WHERE timestamp >= ${dateFilter}`;
    if (agent_id) { sql += ' AND strategy_id = ?'; params.push(Number(agent_id)); }
    sql += ' ORDER BY timestamp DESC';
    const trades = await db.all(sql, params);
    res.json({ success: true, data: { trades } });
  } catch (err) {
    console.error(`[AI Trades Error] ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/agents/summary', async (req, res) => {
  try {
    const db = getDB('ai');
    const params = [];
    let whereClause = '';
    if (req.query.agent_id) {
      whereClause = ' WHERE strategy_id = ?';
      params.push(Number(req.query.agent_id));
    }
    // Keep placeholder PnL — real calculation deferred
    const stats = await db.get(`SELECT COUNT(*) as totalTrades FROM ai_paper_trades${whereClause}`, params);
    const allAgents = await aiStrategyService.listAgents();
    res.json({
      success: true,
      data: {
        totalProfit: '0.00',
        totalPnlPercent: '0%',
        winRate: '0%',
        activeBots: String(orchestrators.size),
        totalAgents: allAgents.length,
        runningAgents: orchestrators.size,
        totalTrades: stats?.totalTrades ?? 0,
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
    const agentId = Number(agent_id);
    const agent = await aiStrategyService.getAgent(agentId);
    if (!agent) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    // Load the existing profile (if any) to check whether it's a shared template.
    const existingProfile = agent.risk_profile_id
      ? await aiStrategyService.getRiskProfile(agent.risk_profile_id)
      : null;

    if (!existingProfile || existingProfile.is_template) {
      // No owned profile yet, or the stored profile is a shared template —
      // create a fresh non-template profile so we never mutate the shared template.
      const { id: newProfileId } = await aiStrategyService.createRiskProfile(
        settings,
        `${agent.name}-risk`
      );
      await aiStrategyService.updateAgent(agentId, { risk_profile_id: newProfileId });
    } else {
      // The agent already owns a non-template profile — update it in place.
      await aiStrategyService.updateRiskProfile(agent.risk_profile_id, settings);
    }

    res.json({ success: true });
  } catch (err) {
    console.error(`[Config Update Error] ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/agents/config/:agent_id', async (req, res) => {
  const { agent_id } = req.params;
  try {
    const db = getDB('ai');
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

// ── Parameterized /api/agents/:id routes (MUST be after all static routes) ───

app.get('/api/agents/:id', async (req, res) => {
  try {
    const agent = await aiStrategyService.getAgent(Number(req.params.id));
    if (!agent) return res.status(404).json({ success: false, error: 'Agent not found' });
    res.json({ success: true, data: agent });
  } catch (err) {
    console.error(`[Agent Get Error] ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/agents/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const agent = await aiStrategyService.getAgent(id);
    if (!agent) return res.status(404).json({ success: false, error: 'Agent not found' });
    await aiStrategyService.updateAgent(id, req.body);
    res.json({ success: true });
  } catch (err) {
    console.error(`[Agent Update Error] ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/agents/:id/archive', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const o = orchestrators.get(id);
    if (o) o.stop();
    orchestrators.delete(id);
    await aiStrategyService.archiveAgent(id);
    io.emit('agent:status', { agentId: id, status: 'stopped' });
    res.json({ success: true });
  } catch (err) {
    console.error(`[Agent Archive Error] ${err.message}`);
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
    // Reset all strategy statuses to 'stopped' on startup since child processes are gone
    await getDB().run('UPDATE strategies SET status = ? WHERE status = ?', ['stopped', 'running']);
    // Reset stale AI agent running statuses (orchestrators don't survive restarts)
    { const db = getDB('ai'); await db.run("UPDATE ai_strategies SET status = 'stopped' WHERE status = 'running'"); }
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
