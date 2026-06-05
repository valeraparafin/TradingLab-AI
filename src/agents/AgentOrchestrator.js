import { AnalystAgent } from './AnalystAgent.js';
import { agentMemory } from './AgentMemory.js';
import { toolRegistry } from '../registry/ToolRegistry.js';
import { TradeExecutor } from './TradeExecutor.js';
import { RiskPolicy } from './RiskPolicy.js';
import { deriveRiskState } from './riskState.js';

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
    this.guardrails = config.guardrails || {};
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
    // Portfolio state is per-agent, not per-symbol — compute once per cycle.
    const portfolioState = await this._getPortfolioState();
    let lastProposal = null;
    for (const symbol of this.symbolsToWatch) {
      try {
        // 1. Analyst proposes (qualitative — no numbers)
        const proposal = await this.analyst.process({ symbol, timeframe: this.llmContext.timeframe });
        lastProposal = proposal;
        await this.memory.saveEpisode({
          agent_id: 'AnalystAgent', input: { symbol }, reasoning: proposal.rationale,
          action: 'PROPOSE_TRADE', observation: 'analysis complete', result: JSON.stringify(proposal),
        });

        // 2. Deterministic policy decides size/SL/TP and gates
        const entryPrice = await this._getCurrentPrice(symbol);
        const verdict = this.riskPolicy.evaluate(proposal, {
          entryPrice,
          ...portfolioState,
          invalidation: (typeof proposal.invalidationIdea === 'number' && isFinite(proposal.invalidationIdea))
            ? proposal.invalidationIdea
            : null,
        });

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
    // One telemetry tick + equity snapshot per cycle (drives the live cockpit).
    await this._recordTelemetry(portfolioState, lastProposal);
  }

  /**
   * Persists one equity snapshot and pushes a live telemetry tick to the UI.
   * History lives in ai_equity_snapshots (source of truth); the socket event is
   * just the instant pulse so the cockpit updates without waiting for a poll.
   */
  async _recordTelemetry(portfolioState, lastProposal) {
    try {
      const { getDB } = await import('../../db.js');
      const db = getDB('ai');
      const portfolioValue = this.guardrails.portfolioValue || 10000;
      const { openPositions = 0, portfolioHeatPct = 0, dailyPnlPct = 0, tradesToday = 0 } = portfolioState || {};

      const equityUsd = portfolioValue * (1 + dailyPnlPct);
      const heatPct = portfolioHeatPct * 100;
      const pnlPct = dailyPnlPct * 100;
      const riskState = deriveRiskState(portfolioHeatPct, dailyPnlPct, this.guardrails);

      await db.run(
        `INSERT INTO ai_equity_snapshots
           (strategy_id, equity_usd, heat_pct, daily_pnl_pct, open_positions, trades_today)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [this.agentId, equityUsd, heatPct, pnlPct, openPositions, tradesToday]
      );

      this.io.emit('agent:telemetry', {
        agentId: this.agentId,
        heatPct, dailyPnlPct: pnlPct, equityUsd, riskState,
        openPositions, tradesToday,
        analystConviction: lastProposal?.conviction ?? null,
        council: this._buildCouncil(lastProposal),
      });
    } catch (e) {
      console.error(`[Telemetry] ${e.message}`);
    }
  }

  /**
   * Derives the "Expert Council" view from the latest qualitative proposal.
   * Simulated (mirrors the Analyst's simulated council) until a real LLM supplies
   * per-lens detail; sentiment + consensus track the agent's actual output.
   */
  _buildCouncil(proposal) {
    const conviction = proposal?.conviction ?? 0;
    const side = proposal?.side ?? 'HOLD';
    const sentiment = side === 'BUY' ? 'bullish' : side === 'SELL' ? 'bearish' : 'neutral';
    const clamp = (n) => Math.max(0, Math.min(1, n));
    const lens = (name, weight) => ({ lens: name, sentiment, confidence: clamp(conviction * (0.7 + weight)) });
    return {
      consensus: conviction,
      lenses: [lens('Macro', 0.3), lens('Quant', 0.4), lens('Order Flow', 0.3)],
    };
  }

  /**
   * Real portfolio snapshot for the policy — no mock equity.
   *  - openPositions: count of open rows in ai_active_positions
   *  - portfolioHeatPct: deployed exposure (Σ total_cost) / portfolioValue  → FRACTION
   *  - dailyPnlPct: unrealized mark-to-market PnL (current price vs avg entry) / portfolioValue → FRACTION
   *    (long-accumulation model; used as the drawdown / profit circuit-breaker proxy)
   *  - tradesToday: paper trades opened today (UTC date), for the maxTradesPerDay gate
   */
  async _getPortfolioState() {
    try {
      const { getDB } = await import('../../db.js');
      const db = getDB('ai');
      const portfolioValue = this.guardrails.portfolioValue || 10000;

      const positions = await db.all(
        'SELECT symbol, total_quantity, total_cost, avg_entry_price FROM ai_active_positions WHERE strategy_id = ?',
        [this.agentId]);

      const openPositions = positions.length;
      const exposure = positions.reduce((s, p) => s + (p.total_cost || 0), 0);
      const portfolioHeatPct = portfolioValue > 0 ? exposure / portfolioValue : 0;

      // Unrealized PnL: mark each open position to the latest price.
      let unrealized = 0;
      for (const p of positions) {
        const px = await this._getCurrentPrice(p.symbol);
        if (px > 0 && p.avg_entry_price > 0) {
          unrealized += (px - p.avg_entry_price) * (p.total_quantity || 0);
        }
      }
      const dailyPnlPct = portfolioValue > 0 ? unrealized / portfolioValue : 0;

      const tRow = await db.get(
        "SELECT COUNT(*) AS c FROM ai_paper_trades WHERE strategy_id = ? AND date(timestamp) = date('now')",
        [this.agentId]);
      const tradesToday = tRow?.c || 0;

      return { openPositions, portfolioHeatPct, dailyPnlPct, tradesToday };
    } catch (_) {
      return { openPositions: 0, portfolioHeatPct: 0, dailyPnlPct: 0, tradesToday: 0 };
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
