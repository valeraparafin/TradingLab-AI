// src/agents/paramResolver.js
import { riskProfileToGuardrails } from './riskProfileToGuardrails.js';

export function posturePhrase(riskPerTradeFraction) {
  const r = riskPerTradeFraction;
  if (r == null || !isFinite(r)) return 'balanced — moderate risk for steady growth';
  if (r <= 0.01) return 'conservative — prioritize capital preservation';
  if (r >= 0.04) return 'aggressive — pursue larger moves, accept higher risk';
  return 'balanced — moderate risk for steady growth';
}

/**
 * Split a flat agent config into three labeled blocks.
 * Guardrails are produced by the single canonical converter (riskProfileToGuardrails),
 * which expects camelCase *Percent whole-percent settings, so we map the snake_case DB row.
 * @param {object} agent       ai_strategies row (snake_case)
 * @param {object} riskProfile ai_risk_profiles row (snake_case) or {}
 * @param {string[]} indicators resolved indicator names
 * @param {object} indicatorDescriptions name -> description
 */
export function resolveAgentParams(agent, riskProfile = {}, indicators = ['SMC'], indicatorDescriptions = {}) {
  const rp = riskProfile || {};
  const symbols = (agent.watchlist || 'BTCUSDT,ETHUSDT').split(',').map(s => s.trim()).filter(Boolean);

  const guardrails = riskProfileToGuardrails({
    riskPerTradePercent: rp.risk_per_trade_percent ?? 1,
    stopLossPercent: rp.stop_loss_percent,
    takeProfitPercent: rp.take_profit_percent,
    maxTradeSizeUSD: rp.max_trade_size_usd,
    maxOpenPositions: rp.max_open_positions,
    maxPortfolioHeatPercent: rp.max_portfolio_heat_percent,
    dailyLossLimitPercent: rp.daily_loss_limit_percent,
    dailyProfitTargetPercent: rp.daily_profit_target_percent,
    maxTradesPerDay: rp.max_trades_per_day,
    minRiskRewardRatio: rp.min_risk_reward_ratio,
    portfolioValue: agent.portfolio_value || 10000,
  });

  return {
    llmContext: {
      timeframe: agent.timeframe || '1H',
      indicators,
      indicatorDescriptions,
      watchlist: symbols,
      tradeMode: agent.trade_mode || 'spot',
      posture: posturePhrase(guardrails.riskPerTrade),
    },
    guardrails,
    execution: {
      agentId: Number(agent.id),
      paperTrading: true, // real-mode safety until exchange accounts exist
      tradeMode: agent.trade_mode || 'spot',
      cycleInterval: agent.cycle_interval_ms || 300000,
      symbols,
    },
  };
}
