// src/agents/riskState.js

/**
 * Classify an agent's overall risk posture from its current portfolio heat and
 * unrealized PnL relative to the configured guardrail limits. Pure + deterministic.
 *
 * @param {number} heatFrac  deployed exposure as a FRACTION of portfolio (0..1+)
 * @param {number} pnlFrac   unrealized PnL as a FRACTION of portfolio (negative = drawdown)
 * @param {{maxPortfolioHeatPct?:number, dailyLossLimitPct?:number}} guardrails  FRACTIONS
 * @returns {'NORMAL'|'CAUTION'|'PANIC'}
 */
export function deriveRiskState(heatFrac = 0, pnlFrac = 0, guardrails = {}) {
  const heatLimit = isFinite(guardrails.maxPortfolioHeatPct) ? guardrails.maxPortfolioHeatPct : Infinity;
  const lossLimit = isFinite(guardrails.dailyLossLimitPct) ? Math.abs(guardrails.dailyLossLimitPct) : Infinity;

  const heatRatio = isFinite(heatLimit) && heatLimit > 0 ? heatFrac / heatLimit : 0;
  const lossRatio = isFinite(lossLimit) && lossLimit > 0 ? Math.max(0, -pnlFrac) / lossLimit : 0;

  const severity = Math.max(heatRatio, lossRatio);
  if (severity >= 0.9) return 'PANIC';
  if (severity >= 0.6) return 'CAUTION';
  return 'NORMAL';
}
