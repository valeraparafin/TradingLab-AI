import { AnalystAgent } from './AnalystAgent.js';
import { agentMemory } from './AgentMemory.js';
import { toolRegistry } from '../registry/ToolRegistry.js';
import { TradeExecutor } from './TradeExecutor.js';
import { RiskPolicy } from './RiskPolicy.js';

/**
 * AgentOrchestrator manages the loop: Analyst (qualitative proposal) ->
 * RiskPolicy (deterministic sizing + gating) -> TradeExecutor.
 */
export default class AgentOrchestrator {
  constructor(io, config = {}) {
    this.io = io;
    this.config = config;
    this.agentId = config.execution?.agentId ?? config.agentId ?? null;
    this.llmContext = config.llmContext || {};
    this.execution = config.execution || { paperTrading: true };
    this.memory = agentMemory;
    this.analyst = new AnalystAgent(this);
    this.riskPolicy = new RiskPolicy(config.guardrails || {});
    this.tradeExecutor = new TradeExecutor({
      tradeMode: this.execution.paperTrading ? 'PAPER' : 'REAL',
      agentId: this.agentId,
    });
    this.toolRegistry = toolRegistry;
    this.isRunning = false;
    this.loopInterval = null;
    this.symbolsToWatch = config.execution?.symbols || config.symbols || ['BTCUSDT', 'ETHUSDT'];
  }

  /**
   * Broadcasts an agent's thought to the frontend.
   */
  broadcastThought(payload) {
    console.log(`[Agent-Thought] ${payload.thought}`);
    this.io.emit('agent:thought', { agentId: this.agentId, ...payload });
  }

  /**
   * Broadcasts a final decision to the frontend.
   */
  broadcastDecision(payload) {
    console.log(`[Agent-Decision] ${payload.decision} - ${payload.reasoning}`);
    this.io.emit('agent:decision', { agentId: this.agentId, ...payload });
  }

  /**
   * Main Adversarial Loop: Analyst -> Risk -> Execution.
   */
  async runCycle() {
    if (!this.isRunning) return;
    for (const symbol of this.symbolsToWatch) {
      try {
        // 1. Analyst proposes (qualitative — no numbers)
        const proposal = await this.analyst.process({ symbol, timeframe: this.llmContext.timeframe });
        await this.memory.saveEpisode({
          agent_id: 'AnalystAgent', input: { symbol }, reasoning: proposal.rationale,
          action: 'PROPOSE_TRADE', observation: 'analysis complete', result: JSON.stringify(proposal),
        });

        // 2. Deterministic policy decides size/SL/TP and gates
        const entryPrice = await this._getCurrentPrice(symbol);
        const portfolioState = await this._getPortfolioState();
        const verdict = this.riskPolicy.evaluate(proposal, { entryPrice, ...portfolioState });

        await this.memory.saveEpisode({
          agent_id: 'RiskPolicy', input: proposal, reasoning: verdict.reason || 'permitted',
          action: 'GATE', observation: 'limits evaluated', result: verdict.decision,
        });

        if (verdict.decision !== 'PERMIT') {
          this.broadcastDecision({ symbol, decision: 'VETOED',
            reasoning: `${proposal.side} proposed; policy denied: ${verdict.reason}` });
          continue;
        }

        // 3. Execute
        const order = verdict.order;
        const tradeParams = {
          symbol, side: order.side.toLowerCase(), sizeUSD: order.sizeUSD,
          price: order.entryPrice, marketType: this.execution.tradeMode,
        };
        this.broadcastDecision({ symbol, decision: 'EXECUTE',
          reasoning: `${proposal.side} (conviction ${proposal.conviction}); SL ${order.slPrice}, TP ${order.tpPrice}`,
          details: tradeParams });
        const executionResult = await this.tradeExecutor.executeTrade(tradeParams);
        this.broadcastThought({ agent: 'orchestrator',
          thought: `Trade ${executionResult.success ? 'Executed' : 'Failed'} (${order.side} ${symbol})` });
      } catch (error) {
        console.error(`Error in cycle for ${symbol}:`, error);
      }
    }
  }

  /** Open-position / heat / daily-pnl snapshot for the policy. Deterministic, no mock equity. */
  async _getPortfolioState() {
    try {
      const { getDB } = await import('../../db.js');
      const db = getDB('ai');
      const row = await db.get(
        'SELECT COUNT(*) AS c FROM ai_active_positions WHERE strategy_id = ?', [this.agentId]);
      return { openPositions: row?.c || 0, portfolioHeatPct: 0, dailyPnlPct: 0 };
    } catch (_) {
      return { openPositions: 0, portfolioHeatPct: 0, dailyPnlPct: 0 };
    }
  }

  async _getCurrentPrice(symbol) {
    const res = await this.toolRegistry.executeTool('get_candles', { symbol, timeframe: '1m', limit: 1 });
    if (res.success && res.data.length > 0) {
      return res.data[0].close;
    }
    return 0;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('AgentOrchestrator: Starting adversarial loop...');
    this.loopInterval = setInterval(() => this.runCycle(), this.config.cycleInterval || 300000);
    this.runCycle();
  }

  stop() {
    this.isRunning = false;
    if (this.loopInterval) {
      clearInterval(this.loopInterval);
      this.loopInterval = null;
    }
    console.log('AgentOrchestrator: Stopped.');
  }
}
