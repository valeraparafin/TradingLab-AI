import { AnalystAgent } from './AnalystAgent.js';
import { agentMemory } from './AgentMemory.js';
import { toolRegistry } from '../registry/ToolRegistry.js';
import { TradeExecutor } from './TradeExecutor.js';
import { RiskPolicy } from './RiskPolicy.js';
import { deriveRiskState } from './riskState.js';
import { checkExits } from './PositionLedger.js';
import { aiStrategyService } from '../server/services/aiStrategyService.js';

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

    // ── Order-Book mode ─────────────────────────────────────────────
    // When an obEngine is injected (agentManager builds it for OrderBook agents) the
    // orchestrator drains live book signals on a fast loop instead of the candle analyst.
    this.obEngine = config.obEngine || null;
    this.obConfig = config.obConfig || {};
    this.isObMode = !!this.obEngine;
    this._obDrainTimer = null;
    this._lastObProposal = null; // feeds the cockpit council in OB mode
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
   * OB mode: pull buffered book signals, map → proposal, gate via RiskPolicy (structural),
   * execute PAPER at the signal's own entryMid. Sparse by design — most ticks drain nothing.
   */
  async _obDrainTick() {
    if (!this.isRunning || !this.obEngine) return;
    const { proposalFromSignal } = await import('./ObAnalyst.js');
    const portfolioState = await this._getPortfolioState();
    for (const symbol of this.symbolsToWatch) {
      let records;
      try { records = this.obEngine.drainSignals(symbol) || []; }
      catch (e) { console.error(`[OB] drain ${symbol}: ${e.message}`); continue; }
      for (const rec of records) {
        try {
          const proposal = proposalFromSignal(rec);
          if (proposal.side === 'HOLD' || proposal.entryMid == null) continue;
          const entryPrice = proposal.entryMid;
          const verdict = this.riskPolicy.evaluate(proposal, {
            entryPrice, ...portfolioState,
            invalidation: (typeof proposal.invalidationIdea === 'number' && isFinite(proposal.invalidationIdea))
              ? proposal.invalidationIdea : null,
          });
          this._lastObProposal = proposal;
          if (verdict.decision !== 'PERMIT') {
            this.broadcastDecision({ symbol, decision: 'VETOED',
              reasoning: `${proposal.side} (OB); policy denied: ${verdict.reason}` });
            continue;
          }
          const order = verdict.order;
          const tradeParams = { symbol, side: order.side.toLowerCase(), sizeUSD: order.sizeUSD,
            price: order.entryPrice, marketType: this.execution.tradeMode };
          this.broadcastDecision({ symbol, decision: 'EXECUTE',
            reasoning: `${proposal.side} (OB conviction ${proposal.conviction.toFixed(2)}); SL ${order.slPrice}, TP ${order.tpPrice}`,
            details: tradeParams });
          const r = await this.tradeExecutor.executeTrade(tradeParams);
          this.broadcastThought({ agent: 'orchestrator',
            thought: `OB trade ${r.success ? 'Executed' : 'Failed'} (${order.side} ${symbol})` });
          if (r.success) await this._openPosition(symbol, order, r.executedPrice ?? order.entryPrice);
        } catch (e) {
          console.error(`[OB] execute ${symbol}: ${e.message}`);
        }
      }
    }
    // Monitor open positions for SL/TP breach (structural exits).
    const mids = {};
    for (const symbol of this.symbolsToWatch) mids[symbol] = await this._midFor(symbol);
    await this._sweepExits(mids);
  }

  /**
   * Main Adversarial Loop: Analyst -> Risk -> Execution.
   */
  async runCycle() {
    if (!this.isRunning) return;
    // Portfolio state is per-agent, not per-symbol — compute once per cycle.
    const portfolioState = await this._getPortfolioState();

    // OB mode: trades are driven by the fast drain loop; the cycle only records telemetry.
    if (this.isObMode) {
      await this._recordTelemetry(portfolioState, this._lastObProposal);
      return;
    }

    // Candle path also monitors open positions each cycle.
    {
      const mids = {};
      for (const symbol of this.symbolsToWatch) mids[symbol] = await this._getCurrentPrice(symbol);
      await this._sweepExits(mids);
    }

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
        if (executionResult.success) await this._openPosition(symbol, order, executionResult.executedPrice ?? order.entryPrice);
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
   * Records an opened position from an executed order. One position per
   * (agent, symbol) — the service's INSERT OR IGNORE is the lock. `executedPrice`
   * is the fill price returned by the executor (includes paper slippage).
   */
  async _openPosition(symbol, order, executedPrice) {
    if (!(executedPrice > 0) || !(order.sizeUSD > 0)) return;
    const qty = order.sizeUSD / executedPrice;
    if (!isFinite(qty) || qty <= 0) {
      this.broadcastThought({ agent: 'orchestrator', thought: `skip open ${symbol}: bad qty` });
      return;
    }
    const { opened } = await aiStrategyService.openPosition(this.agentId, {
      symbol, side: order.side, entryPrice: executedPrice, qty,
      slPrice: order.slPrice, tpPrice: order.tpPrice,
    });
    if (opened) {
      this.io.emit('position:opened', {
        agentId: this.agentId, symbol, side: order.side,
        entryPrice: executedPrice, qty, slPrice: order.slPrice, tpPrice: order.tpPrice,
      });
    }
  }

  /**
   * Closes any open positions whose mid breached SL/TP. `midBySymbol` is supplied
   * by the caller (OB: engine futures mid; candle: latest close). Records each
   * close in ai_closed_trades ONLY (never ai_paper_trades — keeps tradesToday=opens).
   * Record-then-delete order means a crash leaves the position open, never double-closed.
   */
  async _sweepExits(midBySymbol) {
    let positions;
    try { positions = await aiStrategyService.listOpenPositions(this.agentId); }
    catch (e) { console.error(`[Positions] list: ${e.message}`); return; }
    if (!positions.length) return;
    const { closed } = checkExits(positions, midBySymbol);
    for (const c of closed) {
      try {
        await aiStrategyService.recordClosedTrade({
          strategy_id: this.agentId, symbol: c.symbol, side: c.side,
          entry_price: c.entryPrice, exit_price: c.exitPrice, qty: c.qty,
          size_usd: c.qty * c.entryPrice, pnl_usd: c.pnlUsd, exit_reason: c.exitReason,
          opened_at: c.openedAt, closed_at: new Date().toISOString(),
        });
        await aiStrategyService.closePosition(this.agentId, c.symbol);
        this.io.emit('position:closed', {
          agentId: this.agentId, symbol: c.symbol, side: c.side,
          exitPrice: c.exitPrice, pnlUsd: c.pnlUsd, exitReason: c.exitReason,
        });
        this.broadcastThought({ agent: 'orchestrator',
          thought: `Closed ${c.side} ${c.symbol} @ ${c.exitPrice} (${c.exitReason}) PnL ${c.pnlUsd.toFixed(2)}` });
      } catch (e) { console.error(`[Positions] close ${c.symbol}: ${e.message}`); }
    }
  }

  /** Current mid for exit checks: OB engine futures mid, else latest candle close. */
  async _midFor(symbol) {
    if (this.isObMode) {
      const m = this.obEngine.getLatestFeatures?.(symbol)?.futures?.mid;
      if (typeof m === 'number' && isFinite(m) && m > 0) return m;
    }
    return await this._getCurrentPrice(symbol);
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
    if (this.isObMode) {
      this.obEngine.start?.();
      const drainMs = this.obConfig.drainIntervalMs || 10_000;
      this._obDrainTimer = setInterval(() => this._obDrainTick(), drainMs);
    }
    this.loopInterval = setInterval(() => this.runCycle(), this.config.cycleInterval || 300000);
    this.runCycle();
  }

  stop() {
    this.isRunning = false;
    if (this.loopInterval) {
      clearInterval(this.loopInterval);
      this.loopInterval = null;
    }
    if (this._obDrainTimer) { clearInterval(this._obDrainTimer); this._obDrainTimer = null; }
    if (this.obEngine) { try { this.obEngine.stop?.(); } catch (e) { console.error(`[OB] stop: ${e.message}`); } }
    console.log('AgentOrchestrator: Stopped.');
  }
}
