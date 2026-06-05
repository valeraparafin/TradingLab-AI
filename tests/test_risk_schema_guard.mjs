// tests/test_risk_schema_guard.mjs
import assert from 'node:assert';
import { RiskSettingsSchema, RiskTemplateSchema } from '../src/server/schemas/strategy.schema.js';

// A leftover fraction (0.02 meaning "2%") must be REJECTED by the floor.
const badSnake = {
  risk_per_trade_percent: 1, stop_loss_percent: 0.02, take_profit_percent: 5,
  min_risk_reward_ratio: 2, max_portfolio_heat_percent: 5, max_open_positions: 2,
  max_trades_per_day: 5, daily_loss_limit_percent: 2, daily_profit_target_percent: 5,
};
assert.strictEqual(RiskSettingsSchema.safeParse(badSnake).success, false, 'SL 0.02 must be rejected');

// A whole-percent value (2 = 2%) must PASS.
assert.strictEqual(RiskSettingsSchema.safeParse({ ...badSnake, stop_loss_percent: 2 }).success, true, 'SL 2 must pass');

// A legit tight scalp stop (0.3 = 0.3%) must PASS (>= 0.1 floor).
assert.strictEqual(RiskSettingsSchema.safeParse({ ...badSnake, stop_loss_percent: 0.3 }).success, true, 'SL 0.3 must pass');

// Template schema (camelCase) floor too.
const okTemplate = { name: 'X', settings: { riskPerTradePercent: 1, maxTradeSizeUSD: 100, stopLossPercent: 2, takeProfitPercent: 5, maxTradesPerDay: 5 } };
assert.strictEqual(RiskTemplateSchema.safeParse(okTemplate).success, true, 'whole-percent template passes');
const badTemplate = { ...okTemplate, settings: { ...okTemplate.settings, stopLossPercent: 0.05 } };
assert.strictEqual(RiskTemplateSchema.safeParse(badTemplate).success, false, 'SL 0.05 template rejected');

console.log('  ok - schema Guard 2 floors SL/TP at 0.1 (rejects leftover fractions, passes scalp 0.3)');
