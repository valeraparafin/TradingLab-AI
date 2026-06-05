// tests/test_bot_engine_sl.mjs
// Locks the SL/TP prices bot_engine should produce for a known whole-percent risk profile,
// computed through the single converter (no inline /100). Mirrors bot_engine's formula.
import assert from 'node:assert';
import { riskProfileToGuardrails } from '../src/agents/riskProfileToGuardrails.js';

// conservative.json AFTER migration: SL 2(%), TP 5(%), risk 1(%)
const g = riskProfileToGuardrails({
  riskPerTradePercent: 1, stopLossPercent: 2, takeProfitPercent: 5, portfolioValue: 1000,
});
const price = 100;

// BUY: SL below, TP above
const slBuy = price * (1 - g.stopLossPct);
const tpBuy = price * (1 + g.takeProfitPct);
assert.strictEqual(slBuy, 98, `BUY SL should be 2% below (98), got ${slBuy}`);
assert.strictEqual(tpBuy, 105, `BUY TP should be 5% above (105), got ${tpBuy}`);

// position sizing: portfolioValue * riskPerTrade (fraction), no /100
const baseRiskUSD = g.portfolioValue * g.riskPerTrade;
assert.strictEqual(baseRiskUSD, 10, `1% of 1000 should be 10, got ${baseRiskUSD}`);

console.log('  ok - bot_engine SL/TP/size math via converter (2% -> 98/105, 1% -> $10)');
