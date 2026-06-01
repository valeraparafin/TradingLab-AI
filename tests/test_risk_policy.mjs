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

console.log('OK test_risk_policy');
