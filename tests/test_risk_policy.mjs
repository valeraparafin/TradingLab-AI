// tests/test_risk_policy.mjs
import assert from 'node:assert';
import { RiskPolicy } from '../src/agents/RiskPolicy.js';

const guardrails = {
  riskPerTrade: 0.02, stopLossPct: 0.05, takeProfitPct: 0.10,
  maxTradeSizeUSD: 250, maxOpenPositions: 3, maxPortfolioHeatPct: 0.10,
  dailyLossLimitPct: 0.05, dailyProfitTargetPct: 0.08, portfolioValue: 1000,
};
const policy = new RiskPolicy(guardrails);
const ctx = { entryPrice: 100, openPositions: 0, portfolioHeatPct: 0, dailyPnlPct: 0 };

// (a) sizing is USD, capped by maxTradeSizeUSD: 1000*0.02 = 20 (< 250)
let v = policy.evaluate({ side: 'BUY', conviction: 0.7 }, ctx);
assert.equal(v.decision, 'PERMIT');
assert.equal(v.order.sizeUSD, 20);
// mirrored SL/TP for BUY
assert.equal(v.order.slPrice, 95);   // 100*(1-0.05)
assert.equal(v.order.tpPrice, 110);  // 100*(1+0.10)

// cap applies
const capped = new RiskPolicy({ ...guardrails, riskPerTrade: 0.9 });
assert.equal(capped.evaluate({ side: 'BUY', conviction: 0.7 }, ctx).order.sizeUSD, 250);

// SELL mirrors SL/TP
const vs = policy.evaluate({ side: 'SELL', conviction: 0.7 }, ctx).order;
assert.equal(vs.slPrice, 105); // 100*(1+0.05)
assert.equal(vs.tpPrice, 90);  // 100*(1-0.10)

// (b) HOLD = no-op DENY
assert.equal(policy.evaluate({ side: 'HOLD' }, ctx).decision, 'DENY');

// (c) gates
assert.equal(policy.evaluate({ side: 'BUY', conviction: 1 }, { ...ctx, openPositions: 3 }).decision, 'DENY');
assert.equal(policy.evaluate({ side: 'BUY', conviction: 1 }, { ...ctx, portfolioHeatPct: 0.10 }).decision, 'DENY');
assert.equal(policy.evaluate({ side: 'BUY', conviction: 1 }, { ...ctx, dailyPnlPct: -0.05 }).decision, 'DENY');
assert.equal(policy.evaluate({ side: 'BUY', conviction: 1 }, { ...ctx, dailyPnlPct: 0.08 }).decision, 'DENY');

// (d) minRiskRewardRatio gate: rr = takeProfitPct/stopLossPct = 0.10/0.05 = 2.0
const rrStrict = new RiskPolicy({ ...guardrails, minRiskRewardRatio: 3 });
assert.equal(rrStrict.evaluate({ side: 'BUY', conviction: 1 }, ctx).decision, 'DENY', 'rr 2.0 < min 3 must DENY');
const rrOk = new RiskPolicy({ ...guardrails, minRiskRewardRatio: 1.5 });
assert.equal(rrOk.evaluate({ side: 'BUY', conviction: 1 }, ctx).decision, 'PERMIT', 'rr 2.0 >= min 1.5 must PERMIT');

// (e) maxTradesPerDay gate
const freq = new RiskPolicy({ ...guardrails, maxTradesPerDay: 5 });
assert.equal(freq.evaluate({ side: 'BUY', conviction: 1 }, { ...ctx, tradesToday: 5 }).decision, 'DENY', 'at cap must DENY');
assert.equal(freq.evaluate({ side: 'BUY', conviction: 1 }, { ...ctx, tradesToday: 4 }).decision, 'PERMIT', 'below cap must PERMIT');

// no-config defaults: absent maxTradesPerDay / minRiskRewardRatio never block
assert.equal(policy.evaluate({ side: 'BUY', conviction: 1 }, { ...ctx, tradesToday: 9999 }).decision, 'PERMIT', 'undefined cap is no-op');

console.log('OK test_risk_policy');

// ---- Phase 4: futures branch ----
import { RiskPolicy as RP4 } from '../src/agents/RiskPolicy.js';
import assert4 from 'node:assert';

const baseG = {
  portfolioValue: 10000, riskPerTrade: 0.1, maxTradeSizeUSD: Infinity,
  stopLossPct: 0.02, takeProfitPct: 0.04, minRiskRewardRatio: 1.5,
  maxOpenPositions: 1, maxPortfolioHeatPct: 100, dailyLossLimitPct: 1,
  dailyProfitTargetPct: null, maxTradesPerDay: 999999,
};

// Parity: leverage=1 (and absent) → Order has NO marginUSD/leverage, byte-identical to spot shape.
const spot = new RP4(baseG).evaluate({ side: 'BUY', conviction: 1 }, { entryPrice: 100 });
assert4.deepStrictEqual(spot, {
  decision: 'PERMIT',
  order: { side: 'BUY', sizeUSD: 1000, entryPrice: 100, slPrice: 98, tpPrice: 104 },
}, 'leverage=1 spot Order is byte-identical (no futures fields)');

// Futures: leverage=5 → marginUSD = sizeUSD/leverage, futures fields present.
const fut = new RP4({ ...baseG, leverage: 5, mmr: 0.005 }).evaluate({ side: 'BUY', conviction: 1 }, { entryPrice: 100, freeEquity: 10000 });
assert4.strictEqual(fut.decision, 'PERMIT', 'futures permits');
assert4.strictEqual(fut.order.marginUSD, 200, 'marginUSD = 1000/5');
assert4.strictEqual(fut.order.leverage, 5, 'leverage echoed in order');
assert4.strictEqual(fut.order.sizeUSD, 1000, 'sizeUSD stays the notional');
assert4.ok(!('warning' in fut) || fut.warning == null, 'tight SL → no liq warning');

// Margin gate: marginUSD must fit free equity.
const broke = new RP4({ ...baseG, riskPerTrade: 1, leverage: 2, mmr: 0.005 })
  .evaluate({ side: 'BUY', conviction: 1 }, { entryPrice: 100, freeEquity: 100 });
assert4.strictEqual(broke.decision, 'DENY', 'margin > free equity → DENY');
assert4.ok(/[Mm]argin/.test(broke.reason), 'deny reason mentions margin');

// SL-beyond-liquidation → PERMIT + warning (NOT deny). Wide SL (50%) sits past the 10x liq (~90.5).
const warn = new RP4({ ...baseG, stopLossPct: 0.5, takeProfitPct: 0.75, leverage: 10, mmr: 0.005 })
  .evaluate({ side: 'BUY', conviction: 1 }, { entryPrice: 100, freeEquity: 10000 });
assert4.strictEqual(warn.decision, 'PERMIT', 'wide SL still permits');
assert4.ok(warn.warning && /liquidat/i.test(warn.warning), 'warning flags liquidation risk');

console.log('test_risk_policy.mjs futures cases OK');
