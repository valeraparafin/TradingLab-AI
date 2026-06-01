// src/agents/paramResolver.js

/** Normalize a stored percent that may be a fraction (0.05) or a whole percent (5) to a FRACTION. */
function normFraction(v) {
  if (v == null || !isFinite(v)) return v;
  return v > 1 ? v / 100 : v;
}

export function posturePhrase(riskPerTradeFraction) {
  const r = normFraction(riskPerTradeFraction);
  if (r == null || !isFinite(r)) return 'balanced — moderate risk for steady growth';
  if (r <= 0.01) return 'conservative — prioritize capital preservation';
  if (r >= 0.04) return 'aggressive — pursue larger moves, accept higher risk';
  return 'balanced — moderate risk for steady growth';
}

/**
 * Split a flat agent config into three labeled blocks.
 * @param {object} agent       ai_strategies row (snake_case)
 * @param {object} riskProfile ai_risk_profiles row (snake_case) or {}
 * @param {string[]} indicators resolved indicator names
 * @param {object} indicatorDescriptions name -> description
 */
export function resolveAgentParams(agent, riskProfile = {}, indicators = ['SMC'], indicatorDescriptions = {}) {
  const rp = riskProfile || {};
  const symbols = (agent.watchlist || 'BTCUSDT,ETHUSDT').split(',').map(s => s.trim()).filter(Boolean);
  const riskPerTrade = normFraction(rp.risk_per_trade_percent ?? 0.01);

  return {
    llmContext: {
      timeframe: agent.timeframe || '1H',
      indicators,
      indicatorDescriptions,
      watchlist: symbols,
      tradeMode: agent.trade_mode || 'spot',
      posture: posturePhrase(riskPerTrade),
    },
    guardrails: {
      riskPerTrade,
      stopLossPct: normFraction(rp.stop_loss_percent),
      takeProfitPct: normFraction(rp.take_profit_percent),
      maxTradeSizeUSD: rp.max_trade_size_usd ?? Infinity,
      maxOpenPositions: rp.max_open_positions ?? Infinity,
      maxPortfolioHeatPct: normFraction(rp.max_portfolio_heat_percent) ?? Infinity,
      dailyLossLimitPct: normFraction(rp.daily_loss_limit_percent) ?? Infinity,
      dailyProfitTargetPct: normFraction(rp.daily_profit_target_percent),
      // Frequency + R:R gates are counts/ratios, NOT percents — never normalize to fractions.
      maxTradesPerDay: rp.max_trades_per_day ?? Infinity,
      minRiskRewardRatio: rp.min_risk_reward_ratio ?? 0,
      portfolioValue: agent.portfolio_value || 10000,
    },
    execution: {
      agentId: Number(agent.id),
      paperTrading: true, // real-mode safety until exchange accounts exist
      tradeMode: agent.trade_mode || 'spot',
      cycleInterval: agent.cycle_interval_ms || 300000,
      symbols,
    },
  };
}
