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

// --- Guard 1 (Spec 2): minRiskRewardRatio must be reachable by TP/SL ---
// snake_case (RiskSettingsSchema): min_risk_reward_ratio optional; present → Guard 1 active.
const rrBase = {
  risk_per_trade_percent: 1, stop_loss_percent: 2, take_profit_percent: 6,
  min_risk_reward_ratio: 3, max_portfolio_heat_percent: 5, max_open_positions: 2,
  max_trades_per_day: 5, daily_loss_limit_percent: 2, daily_profit_target_percent: 5,
};
assert.strictEqual(RiskSettingsSchema.safeParse(rrBase).success, true, 'TP/SL 6/2=3.0 >= minRR 3 passes');
assert.strictEqual(RiskSettingsSchema.safeParse({ ...rrBase, take_profit_percent: 5 }).success, false,
  'TP/SL 5/2=2.5 < minRR 3 rejected (Guard 1)');

// camelCase (RiskTemplateSchema): minRiskRewardRatio optional; absent → inert.
const tplBase = { name: 'X', settings: { riskPerTradePercent: 1, maxTradeSizeUSD: 100, stopLossPercent: 2, takeProfitPercent: 6, maxTradesPerDay: 5, minRiskRewardRatio: 3 } };
assert.strictEqual(RiskTemplateSchema.safeParse(tplBase).success, true, 'template 6/2=3.0 >= minRR 3 passes');
assert.strictEqual(RiskTemplateSchema.safeParse({ ...tplBase, settings: { ...tplBase.settings, takeProfitPercent: 5 } }).success, false,
  'template 5/2=2.5 < minRR 3 rejected (Guard 1)');
const tplNoRR = { name: 'X', settings: { riskPerTradePercent: 1, maxTradeSizeUSD: 100, stopLossPercent: 2, takeProfitPercent: 5, maxTradesPerDay: 5 } };
assert.strictEqual(RiskTemplateSchema.safeParse(tplNoRR).success, true, 'no minRR → Guard 1 inert');
// snake_case schema is also inert when min_risk_reward_ratio is omitted (now optional).
const snakeNoRR = { ...rrBase, take_profit_percent: 5 };
delete snakeNoRR.min_risk_reward_ratio;
assert.strictEqual(RiskSettingsSchema.safeParse(snakeNoRR).success, true, 'no min_risk_reward_ratio → Guard 1 inert (snake)');
console.log('  ok - Guard 1 rejects minRR unreachable by TP/SL (both schemas)');
