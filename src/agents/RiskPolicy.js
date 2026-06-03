// src/agents/RiskPolicy.js
import { liqPrice } from '../core/liquidation.js';

/**
 * Deterministic risk policy. Constructed from resolved guardrails (all *Pct are FRACTIONS).
 * The LLM gets no vote here: this computes size + SL/TP and gates the order.
 */
export class RiskPolicy {
  constructor(guardrails = {}) {
    this.g = guardrails;
  }

  /**
   * @param {{side:'BUY'|'SELL'|'HOLD', conviction:number}} proposal
   * @param {{entryPrice:number, openPositions:number, portfolioHeatPct:number, dailyPnlPct:number, tradesToday:number}} ctx
   * @returns {{decision:'PERMIT'|'DENY', reason?:string, order?:object}}
   */
  evaluate(proposal, ctx) {
    const g = this.g;
    const { entryPrice, openPositions = 0, portfolioHeatPct = 0, dailyPnlPct = 0, tradesToday = 0 } = ctx || {};

    if (!proposal || proposal.side === 'HOLD' || !proposal.side) {
      return { decision: 'DENY', reason: 'Proposal is HOLD/empty (no-op)' };
    }
    // Circuit breakers
    if (isFinite(g.dailyLossLimitPct) && dailyPnlPct <= -Math.abs(g.dailyLossLimitPct)) {
      return { decision: 'DENY', reason: 'Daily loss limit reached' };
    }
    if (g.dailyProfitTargetPct != null && isFinite(g.dailyProfitTargetPct) && dailyPnlPct >= g.dailyProfitTargetPct) {
      return { decision: 'DENY', reason: 'Daily profit target reached' };
    }
    // Trade-frequency circuit breaker
    if (isFinite(g.maxTradesPerDay) && tradesToday >= g.maxTradesPerDay) {
      return { decision: 'DENY', reason: `Max trades per day (${g.maxTradesPerDay}) reached` };
    }
    // Hard caps
    if (openPositions >= (g.maxOpenPositions ?? Infinity)) {
      return { decision: 'DENY', reason: `Max open positions (${g.maxOpenPositions}) reached` };
    }
    if (isFinite(g.maxPortfolioHeatPct) && portfolioHeatPct >= g.maxPortfolioHeatPct) {
      return { decision: 'DENY', reason: `Portfolio heat ${portfolioHeatPct} >= limit ${g.maxPortfolioHeatPct}` };
    }
    // Minimum risk/reward: TP distance vs SL distance (both fractions from the profile).
    if (g.minRiskRewardRatio > 0 && g.stopLossPct > 0 && isFinite(g.takeProfitPct)) {
      const rr = g.takeProfitPct / g.stopLossPct;
      if (rr < g.minRiskRewardRatio) {
        return { decision: 'DENY', reason: `Risk/reward ${rr.toFixed(2)} below minimum ${g.minRiskRewardRatio}` };
      }
    }

    // Sizing — single unit (USD)
    const sizeUSD = Math.min((g.portfolioValue || 0) * (g.riskPerTrade || 0), g.maxTradeSizeUSD ?? Infinity);

    // SL/TP prices mirrored by side (round to 8 dp to avoid FP artifacts)
    const round = (n) => n == null ? null : Math.round(n * 1e8) / 1e8;
    const sl = g.stopLossPct, tp = g.takeProfitPct;
    const slPrice = sl == null ? null : round(proposal.side === 'BUY' ? entryPrice * (1 - sl) : entryPrice * (1 + sl));
    const tpPrice = tp == null ? null : round(proposal.side === 'BUY' ? entryPrice * (1 + tp) : entryPrice * (1 - tp));

    const leverage = g.leverage || 1;
    if (leverage <= 1) {
      // SPOT — byte-identical to pre-Phase-4 behavior (futures additions dormant).
      return {
        decision: 'PERMIT',
        order: { side: proposal.side, sizeUSD, entryPrice, slPrice, tpPrice },
      };
    }

    // FUTURES (leverage > 1) — isolated margin.
    const marginUSD = Math.round((sizeUSD / leverage) * 1e8) / 1e8;
    const free = ctx.freeEquity != null ? ctx.freeEquity : (g.portfolioValue || 0);
    if (marginUSD > free) {
      return { decision: 'DENY', reason: `Margin ${marginUSD.toFixed(2)} exceeds free equity ${free.toFixed(2)}` };
    }

    // "SL beyond liquidation" → PERMIT + warning (never DENY); honest liquidation cost surfaces in metrics.
    let warning;
    const liq = liqPrice(entryPrice, proposal.side, leverage, g.mmr);
    if (liq != null && slPrice != null) {
      const slBeyondLiq = proposal.side === 'BUY' ? slPrice <= liq : slPrice >= liq;
      if (slBeyondLiq) {
        warning = `SL ${slPrice} is at/beyond liquidation ${liq.toFixed(2)} at ${leverage}x — liquidation may trigger first`;
      }
    }

    const result = {
      decision: 'PERMIT',
      order: { side: proposal.side, sizeUSD, marginUSD, entryPrice, slPrice, tpPrice, leverage },
    };
    if (warning) result.warning = warning;
    return result;
  }
}
