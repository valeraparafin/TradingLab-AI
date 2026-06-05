// src/agents/riskProfileToGuardrails.js

/**
 * Convert a stored WHOLE-PERCENT value (e.g. 2 -> 2%) into a runtime FRACTION (0.02).
 * The canonical unit convention is whole percents everywhere (templates, DB, schema, UI);
 * this is the single ÷100 boundary. No heuristics: every percent field is divided by 100.
 * null/undefined/non-finite pass through unchanged (so absent optional gates stay absent).
 */
function toFraction(v) {
  if (v == null || !isFinite(v)) return v;
  return v / 100;
}

/**
 * Canonical risk-config → guardrails bridge. Consumes the camelCase-with-`Percent`
 * settings shape produced by file risk templates (templates/risk/*.json after toCamel,
 * validated by config_resolver.js's RiskSchema) and produces the exact `guardrails`
 * object that simulate()/RiskPolicy consume. This is the single source of truth for the
 * percent→fraction mapping, used by all three paths: the backtest matrix, the AI live
 * path (paramResolver delegates here), and the manual live engine (bot_engine routes here).
 *
 * @param {object} s    risk settings (camelCase, *Percent keys)
 * @param {{leverage?: number, mmr?: number|null}} [opts]
 * @returns {object} guardrails (camelCase, *Pct fractions) + leverage + mmr
 */
export function riskProfileToGuardrails(s = {}, { leverage = 1, mmr = null } = {}) {
  return {
    riskPerTrade: toFraction(s.riskPerTradePercent ?? 1),
    stopLossPct: toFraction(s.stopLossPercent),
    takeProfitPct: toFraction(s.takeProfitPercent),
    maxTradeSizeUSD: s.maxTradeSizeUSD ?? Infinity,
    maxOpenPositions: s.maxOpenPositions ?? Infinity,
    maxPortfolioHeatPct: toFraction(s.maxPortfolioHeatPercent) ?? Infinity,
    dailyLossLimitPct: toFraction(s.dailyLossLimitPercent) ?? Infinity,
    dailyProfitTargetPct: toFraction(s.dailyProfitTargetPercent),
    // Counts/ratios are NOT percents — never normalize.
    maxTradesPerDay: s.maxTradesPerDay ?? Infinity,
    minRiskRewardRatio: s.minRiskRewardRatio ?? 0,
    portfolioValue: s.portfolioValue ?? 10000,
    leverage,
    mmr,
  };
}
