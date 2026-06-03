// tests/test_risk_profile_to_guardrails.js
import assert from 'node:assert';
import { riskProfileToGuardrails } from '../src/agents/riskProfileToGuardrails.js';
import { resolveAgentParams } from '../src/agents/paramResolver.js';

let passed = 0;
const ok = (name) => { console.log(`  ok - ${name}`); passed++; };

// 1. percent (whole-number) inputs normalize to fractions
{
  const g = riskProfileToGuardrails({
    riskPerTradePercent: 5, stopLossPercent: 5, takeProfitPercent: 15,
    maxTradeSizeUSD: 500, maxOpenPositions: 8, maxPortfolioHeatPercent: 15,
    dailyLossLimitPercent: 5, dailyProfitTargetPercent: 10,
    maxTradesPerDay: 10, minRiskRewardRatio: 1.5, portfolioValue: 1000,
  });
  assert.strictEqual(g.riskPerTrade, 0.05);
  assert.strictEqual(g.stopLossPct, 0.05);
  assert.strictEqual(g.takeProfitPct, 0.15);
  assert.strictEqual(g.maxPortfolioHeatPct, 0.15);
  assert.strictEqual(g.dailyLossLimitPct, 0.05);
  assert.strictEqual(g.dailyProfitTargetPct, 0.10);
  assert.strictEqual(g.maxTradeSizeUSD, 500);
  assert.strictEqual(g.maxOpenPositions, 8);
  assert.strictEqual(g.maxTradesPerDay, 10);
  assert.strictEqual(g.minRiskRewardRatio, 1.5);
  assert.strictEqual(g.portfolioValue, 1000);
  assert.strictEqual(g.leverage, 1);
  assert.strictEqual(g.mmr, null);
  ok('whole-number percents normalize to fractions');
}

// 2. already-fractional inputs pass through unchanged
{
  const g = riskProfileToGuardrails({
    riskPerTradePercent: 0.01, stopLossPercent: 0.02, takeProfitPercent: 0.04,
    maxPortfolioHeatPercent: 0.5, dailyLossLimitPercent: 0.03,
  });
  assert.strictEqual(g.riskPerTrade, 0.01);
  assert.strictEqual(g.stopLossPct, 0.02);
  assert.strictEqual(g.takeProfitPct, 0.04);
  assert.strictEqual(g.maxPortfolioHeatPct, 0.5);
  assert.strictEqual(g.dailyLossLimitPct, 0.03);
  ok('fractional inputs pass through');
}

// 3. missing optional gates default to Infinity / sane fallbacks
{
  const g = riskProfileToGuardrails({ riskPerTradePercent: 1 });
  assert.strictEqual(g.maxTradeSizeUSD, Infinity);
  assert.strictEqual(g.maxOpenPositions, Infinity);
  assert.strictEqual(g.maxPortfolioHeatPct, Infinity);
  assert.strictEqual(g.dailyLossLimitPct, Infinity);
  assert.strictEqual(g.maxTradesPerDay, Infinity);
  assert.strictEqual(g.minRiskRewardRatio, 0);
  assert.strictEqual(g.portfolioValue, 10000);
  ok('missing gates default to Infinity / fallbacks');
}

// 4. leverage + mmr flow through
{
  const g = riskProfileToGuardrails({ riskPerTradePercent: 1 }, { leverage: 10, mmr: 0.005 });
  assert.strictEqual(g.leverage, 10);
  assert.strictEqual(g.mmr, 0.005);
  ok('leverage and mmr flow through');
}

// 5. EQUIVALENCE: same logical profile via the live AI path produces identical guardrails.
//    snake_case DB profile + agent ; camelCase file-template settings.
{
  const snakeProfile = {
    risk_per_trade_percent: 5, stop_loss_percent: 5, take_profit_percent: 15,
    max_trade_size_usd: 500, max_open_positions: 8, max_portfolio_heat_percent: 15,
    daily_loss_limit_percent: 5, daily_profit_target_percent: 10,
    max_trades_per_day: 10, min_risk_reward_ratio: 1.5,
  };
  const agent = { id: 1, portfolio_value: 1000, watchlist: 'BTCUSDT', timeframe: '1H', trade_mode: 'spot' };
  const live = resolveAgentParams(agent, snakeProfile).guardrails;

  const camelSettings = {
    riskPerTradePercent: 5, stopLossPercent: 5, takeProfitPercent: 15,
    maxTradeSizeUSD: 500, maxOpenPositions: 8, maxPortfolioHeatPercent: 15,
    dailyLossLimitPercent: 5, dailyProfitTargetPercent: 10,
    maxTradesPerDay: 10, minRiskRewardRatio: 1.5, portfolioValue: 1000,
  };
  const bridged = riskProfileToGuardrails(camelSettings);

  // Compare only the keys the live path produces (it has no leverage/mmr).
  for (const k of Object.keys(live)) {
    assert.strictEqual(bridged[k], live[k], `mismatch on guardrails.${k}: bridge=${bridged[k]} live=${live[k]}`);
  }
  ok('bridge guardrails == resolveAgentParams guardrails (parity lock)');
}

// 6. EQUIVALENCE on the ABSENT-key path: a profile WITHOUT a daily profit target must
//    produce the same dailyProfitTargetPct from both paths (undefined, no Infinity default),
//    locking the gate's absent-key behaviour against future divergence.
{
  const agent = { id: 2, portfolio_value: 1000, watchlist: 'BTCUSDT', timeframe: '1H', trade_mode: 'spot' };
  const live = resolveAgentParams(agent, { risk_per_trade_percent: 1 }).guardrails;
  const bridged = riskProfileToGuardrails({ riskPerTradePercent: 1 });
  assert.strictEqual(bridged.dailyProfitTargetPct, live.dailyProfitTargetPct, 'absent daily profit target matches live');
  assert.strictEqual(bridged.dailyProfitTargetPct, undefined, 'absent gate is undefined, not Infinity');
  ok('absent dailyProfitTargetPct parity (undefined)');
}

console.log(`\n${passed} checks passed`);
