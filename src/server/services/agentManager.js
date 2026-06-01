// src/server/services/agentManager.js
import AgentOrchestrator from '../../agents/AgentOrchestrator.js';
import { aiStrategyService } from './aiStrategyService.js';

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
        const paperTrading = true; // real-mode safety until exchange accounts exist
        let indicators = ['SMC'];
        try {
          const resolved = await aiStrategyService.getLogicTemplateIndicators(agent.logic_template_id);
          if (resolved?.length) indicators = resolved;
        } catch (_) { /* keep default */ }

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
      const o = orchestrators.get(agentId);
      if (o) o.stop();
      orchestrators.delete(agentId);
      await aiStrategyService.archiveAgent(agentId);
      io.emit('agent:status', { agentId, status: 'stopped' });
      return { http: 200, body: { success: true } };
    },
  };
}
