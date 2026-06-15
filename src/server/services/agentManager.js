// src/server/services/agentManager.js
import AgentOrchestrator from '../../agents/AgentOrchestrator.js';
import { aiStrategyService } from './aiStrategyService.js';
import { resolveAgentParams } from '../../agents/paramResolver.js';

// Resolve OB thresholds: per-agent ob_config JSON (added later) if present, else the OrderBook
// logic template's `indicators` block, else the engine's built-in DEF.
async function _loadObParams(agent) {
  // Per-agent override column may not exist yet; tolerate absence/parse errors.
  if (agent.ob_config) {
    try { const j = JSON.parse(agent.ob_config); if (j && typeof j === 'object') return j; } catch (_) {}
  }
  try {
    const { templateService } = await import('./template.service.js');
    const tpl = await templateService.loadTemplate('logic', String(agent.logic_template_id));
    if (tpl?.indicators && typeof tpl.indicators === 'object') return tpl.indicators;
  } catch (_) {}
  return {}; // LiveObEngine DEF fills the rest
}

/**
 * Owns the live orchestrator registry and start/stop/archive lifecycle.
 * `io` is injected so this module never imports server.js (one-directional dep).
 */
export function createAgentManager(io) {
  const orchestrators = new Map(); // agent_id (Number) -> AgentOrchestrator | null(reserved)

  return {
    size: () => orchestrators.size,
    isRunning: (agentId) => orchestrators.has(Number(agentId)),

    async start(agentIdRaw) {
      const agentId = Number(agentIdRaw);
      if (!agentId) return { http: 400, body: { success: false, error: 'Missing agent_id' } };
      if (orchestrators.has(agentId)) return { http: 200, body: { status: 'already_running' } };
      orchestrators.set(agentId, null); // reserve
      try {
        const agent = await aiStrategyService.getAgent(agentId);
        if (!agent) {
          orchestrators.delete(agentId);
          return { http: 404, body: { success: false, error: 'Agent not found' } };
        }
        const riskProfile = agent.risk_profile_id
          ? await aiStrategyService.getRiskProfile(agent.risk_profile_id) : {};
        if (!agent.risk_profile_id || !riskProfile || Object.keys(riskProfile).length === 0) {
          console.warn(`[Agent Start] Agent ${agentId} starting WITHOUT risk constraints.`);
        }
        let indicators = ['SMC'];
        try {
          const resolved = await aiStrategyService.getLogicTemplateIndicators(agent.logic_template_id);
          if (resolved?.length) indicators = resolved;
        } catch (_) { /* keep default */ }

        const indicatorDescriptions = {}; // descriptions injected later when the LLM lands
        const { llmContext, guardrails, execution } =
          resolveAgentParams(agent, riskProfile, indicators, indicatorDescriptions);

        // ── Order-Book agents: build a persistent live engine + force structural stops ──
        const isOrderBook = indicators.map(String).includes('OrderBook');
        let obEngine = null, obConfig = null, finalGuardrails = guardrails;
        if (isOrderBook) {
          const { OrderBookFeed } = await import('../../marketdata/orderbook/OrderBookFeed.js');
          const { LiveObEngine } = await import('../../marketdata/orderbook/liveObEngine.js');
          const { applyOrderBookGuardrails } = await import('../../agents/obGuardrails.js');
          const { toolRegistry } = await import('../../registry/ToolRegistry.js');
          const symbols = execution.symbols;
          const obParams = await _loadObParams(agent);
          const feed = new OrderBookFeed({ symbols: symbols.map((s) => ({ futures: s, spot: s })), record: false });
          // ToolRegistry.get_candles takes { symbol, interval, limit } — NOT timeframe.
          const candlesProvider = async (sym, tf) => {
            const res = await toolRegistry.executeTool('get_candles', { symbol: sym, interval: tf, limit: 50 });
            return res.success ? res.data : [];
          };
          obEngine = new LiveObEngine({ feed, candlesProvider, symbols,
            opts: { baseTf: agent.timeframe || '5m', record: true, ...obParams } });
          obConfig = { drainIntervalMs: 10_000 };
          finalGuardrails = applyOrderBookGuardrails(guardrails);
        }

        const o = new AgentOrchestrator(io, {
          llmContext, guardrails: finalGuardrails, execution, indicators,
          obEngine, obConfig,
        });
        o.start();
        orchestrators.set(agentId, o);
        await aiStrategyService.updateAgent(agentId, { status: 'running', last_run: new Date().toISOString() });
        io.emit('agent:status', { agentId, status: 'running' });
        return { http: 200, body: { status: 'started' } };
      } catch (err) {
        orchestrators.delete(agentId);
        console.error(`[Agent Start Error] ${err.message}`);
        return { http: 500, body: { success: false, error: err.message } };
      }
    },

    async stop(agentIdRaw) {
      const agentId = Number(agentIdRaw);
      if (!agentId) return { http: 400, body: { success: false, error: 'Missing agent_id' } };
      try {
        const o = orchestrators.get(agentId);
        if (o) o.stop();
        orchestrators.delete(agentId);
        await aiStrategyService.updateAgent(agentId, { status: 'stopped' });
        io.emit('agent:status', { agentId, status: 'stopped' });
        return { http: 200, body: { status: 'stopped' } };
      } catch (err) {
        console.error(`[Agent Stop Error] ${err.message}`);
        return { http: 500, body: { success: false, error: err.message } };
      }
    },

    async archive(agentIdRaw) {
      const agentId = Number(agentIdRaw);
      if (!agentId) return { http: 400, body: { success: false, error: 'Missing agent_id' } };
      try {
        const o = orchestrators.get(agentId);
        if (o) o.stop();
        orchestrators.delete(agentId);
        await aiStrategyService.archiveAgent(agentId);
        io.emit('agent:status', { agentId, status: 'stopped' });
        return { http: 200, body: { success: true } };
      } catch (err) {
        console.error(`[Agent Archive Error] ${err.message}`);
        return { http: 500, body: { success: false, error: err.message } };
      }
    },
  };
}
