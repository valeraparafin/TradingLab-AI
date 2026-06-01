// tests/test_param_resolver.mjs
import assert from 'node:assert';
import { resolveAgentParams, posturePhrase } from '../src/agents/paramResolver.js';

// posture phrase boundaries
assert.ok(posturePhrase(0.005).startsWith('conservative'));
assert.ok(posturePhrase(0.02).startsWith('balanced'));
assert.ok(posturePhrase(0.05).startsWith('aggressive'));

const agent = {
  id: 7, watchlist: 'BTCUSDT, ETHUSDT', timeframe: '4H',
  trade_mode: 'spot', portfolio_value: 1000, cycle_interval_ms: 60000,
};
const profile = {
  risk_per_trade_percent: 0.02, stop_loss_percent: 0.05, take_profit_percent: 0.1,
  max_trade_size_usd: 250, max_open_positions: 3, max_portfolio_heat_percent: 10,
  daily_loss_limit_percent: 5, daily_profit_target_percent: 8,
};
const out = resolveAgentParams(agent, profile, ['SMC', 'FVG'], { SMC: 'd1', FVG: 'd2' });

// llmContext = qualitative only, no raw risk numbers
assert.deepEqual(out.llmContext.indicators, ['SMC', 'FVG']);
assert.equal(out.llmContext.timeframe, '4H');
assert.deepEqual(out.llmContext.watchlist, ['BTCUSDT', 'ETHUSDT']);
assert.ok(out.llmContext.posture.startsWith('balanced'));
assert.equal(out.llmContext.riskPerTrade, undefined, 'no raw money number leaks into llmContext');

// guardrails normalized to FRACTIONS (5 -> 0.05, 0.05 stays 0.05)
assert.equal(out.guardrails.riskPerTrade, 0.02);
assert.equal(out.guardrails.stopLossPct, 0.05);
assert.equal(out.guardrails.maxPortfolioHeatPct, 0.10);
assert.equal(out.guardrails.dailyLossLimitPct, 0.05);
assert.equal(out.guardrails.maxTradeSizeUSD, 250);
assert.equal(out.guardrails.portfolioValue, 1000);

// execution
assert.equal(out.execution.agentId, 7);
assert.equal(out.execution.paperTrading, true);
assert.deepEqual(out.execution.symbols, ['BTCUSDT', 'ETHUSDT']);

console.log('OK test_param_resolver');
