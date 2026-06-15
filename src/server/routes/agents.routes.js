// src/server/routes/agents.routes.js
import { Router } from 'express';
import { getDB } from '../../../db.js';
import { aiStrategyService } from '../services/aiStrategyService.js';
import { toolRegistry } from '../../registry/ToolRegistry.js';
import { assetService } from '../services/asset.service.js';

export function createAgentsRouter(manager) {
  const r = Router();

  // ── Static routes (MUST be before parameterized /:id routes) ─────

  r.get('/', async (req, res) => {
    try {
      const includeArchived = req.query.archived === 'true';
      const agents = await aiStrategyService.listAgents(includeArchived);
      res.json({ success: true, data: agents });
    } catch (err) {
      console.error(`[Agents List Error] ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  r.post('/', async (req, res) => {
    try {
      if (!req.body.name) return res.status(400).json({ success: false, error: 'Missing name' });
      const result = await aiStrategyService.createAgent(req.body);
      res.json({ success: true, data: result });
    } catch (err) {
      console.error(`[Agent Create Error] ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  r.get('/risk-templates', async (req, res) => {
    try {
      const templates = await aiStrategyService.listRiskTemplates();
      res.json({ success: true, data: templates });
    } catch (err) {
      console.error(`[Risk Templates Error] ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  r.post('/start', async (req, res) => {
    const { http, body } = await manager.start(req.body.agent_id);
    res.status(http).json(body);
  });

  r.post('/stop', async (req, res) => {
    const { http, body } = await manager.stop(req.body.agent_id);
    res.status(http).json(body);
  });

  r.get('/trades', async (req, res) => {
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
      const rows = await db.all(sql, params);
      const trades = rows.map((t) => ({ ...t, pricePrecision: assetService.getPrecision(t.symbol) }));
      res.json({ success: true, data: { trades } });
    } catch (err) {
      console.error(`[AI Trades Error] ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  r.get('/summary', async (req, res) => {
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
          activeBots: String(manager.size()),
          totalAgents: allAgents.length,
          runningAgents: manager.size(),
          totalTrades: stats?.totalTrades ?? 0,
        }
      });
    } catch (err) {
      console.error(`[AI Summary Error] ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  r.post('/config', async (req, res) => {
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

  r.get('/config/:agent_id', async (req, res) => {
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

  // ── Parameterized /:id routes (MUST be after all static routes) ───

  r.get('/:id', async (req, res) => {
    try {
      const agent = await aiStrategyService.getAgent(Number(req.params.id));
      if (!agent) return res.status(404).json({ success: false, error: 'Agent not found' });
      res.json({ success: true, data: agent });
    } catch (err) {
      console.error(`[Agent Get Error] ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  r.get('/:id/equity', async (req, res) => {
    try {
      const interval = ['day', 'week', 'month'].includes(req.query.interval) ? req.query.interval : 'day';
      const snapshots = await aiStrategyService.getEquitySnapshots(Number(req.params.id), interval);
      res.json({ success: true, data: { snapshots } });
    } catch (err) {
      console.error(`[Agent Equity Error] ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  r.get('/:id/positions', async (req, res) => {
    try {
      const agentId = Number(req.params.id);
      // Server-side mid + unrealized PnL (math stays on the server).
      const priceFn = async (symbol) => {
        const out = await toolRegistry.executeTool('get_candles', { symbol, interval: '1m', limit: 1 });
        return out.success && out.data.length ? out.data[0].close : 0;
      };
      const enriched = await aiStrategyService.getOpenPositionsEnriched(agentId, priceFn);
      const positions = enriched.map((p) => ({ ...p, pricePrecision: assetService.getPrecision(p.symbol) }));
      res.json({ success: true, data: { positions } });
    } catch (err) {
      console.error(`[AI Positions Error] ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  r.get('/:id/closed-trades', async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const rows = await aiStrategyService.listClosedTrades(Number(req.params.id), limit);
      const trades = rows.map((t) => ({ ...t, pricePrecision: assetService.getPrecision(t.symbol) }));
      res.json({ success: true, data: { trades } });
    } catch (err) {
      console.error(`[AI Closed Trades Error] ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  r.put('/:id', async (req, res) => {
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

  r.post('/:id/archive', async (req, res) => {
    const { http, body } = await manager.archive(req.params.id);
    res.status(http).json(body);
  });

  return r;
}
