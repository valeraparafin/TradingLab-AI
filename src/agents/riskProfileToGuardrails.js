// src/agents/riskProfileToGuardrails.js

/**
 * Normalize a stored percent that may already be a fraction (0.05) or a whole
 * percent (5) into a FRACTION. Intentional copy of paramResolver.js's normFraction
 * so this module is self-contained; a later phase unifies the two (resolveAgentParams
 * will delegate here). The equivalence test in tests/test_risk_profile_to_guardrails.js
 * guarantees the two copies stay identical.
 */
function normFraction(v) {
  if (v == null || !isFinite(v)) return v;
  return v > 1 ? v / 100 : v;
}

/**
 * Canonical risk-config → guardrails bridge. Consumes the camelCase-with-`Percent`
 * settings shape produced by file risk templates (templates/risk/*.json after toCamel,
 * validated by config_resolver.js's RiskSchema) and produces the exact `guardrails`
 * object that simulate()/RiskPolicy consume. This is the single source of truth for the
 * percent→fraction mapping shared by the backtest matrix and (later) the live path.
 *
 * @param {object} s    risk settings (camelCase, *Percent keys)
 * @param {{leverage?: number, mmr?: number|null}} [opts]
 * @returns {object} guardrails (camelCase, *Pct fractions) + leverage + mmr
 */
export function riskProfileToGuardrails(s = {}, { leverage = 1, mmr = null } = {}) {
  return {
    riskPerTrade: normFraction(s.riskPerTradePercent ?? 0.01),
    stopLossPct: normFraction(s.stopLossPercent),
    takeProfitPct: normFraction(s.takeProfitPercent),
    maxTradeSizeUSD: s.maxTradeSizeUSD ?? Infinity,
    maxOpenPositions: s.maxOpenPositions ?? Infinity,
    maxPortfolioHeatPct: normFraction(s.maxPortfolioHeatPercent) ?? Infinity,
    dailyLossLimitPct: normFraction(s.dailyLossLimitPercent) ?? Infinity,
    dailyProfitTargetPct: normFraction(s.dailyProfitTargetPercent),
    // Counts/ratios are NOT percents — never normalize.
    maxTradesPerDay: s.maxTradesPerDay ?? Infinity,
    minRiskRewardRatio: s.minRiskRewardRatio ?? 0,
    portfolioValue: s.portfolioValue ?? 10000,
    leverage,
    mmr,
  };
}
