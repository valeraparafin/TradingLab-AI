// tests/test_pipeline_invalidation.mjs
// Proves the pipeline forwards signal.invalidation into RiskPolicy via ctx.
import assert from 'node:assert';
import { evaluateBar } from '../src/core/pipeline.js';

// Proven bullish SMC fixture (mirrors tests/test_derive_agent_proposal.js): a lone pivot
// high (20) at index 55, then a final close (25) that breaks above it → SMC BUY with
// invalidation = 20. entry = 25 → riskFrac = |25-20|/25 = 0.20.
const candles = Array.from({ length: 110 }, (_, i) =>
  ({ time: i, open: 7, high: 10, low: 5, close: 7, volume: 10 }));
candles[55].high = 20;
candles[109].high = 25;
candles[109].close = 25;

const baseGuards = {
  riskPerTrade: 0.02, stopLossPct: 0.05, takeProfitPct: 0.10, portfolioValue: 1000,
  maxOpenPositions: Infinity, maxPortfolioHeatPct: Infinity, dailyLossLimitPct: Infinity,
  dailyProfitTargetPct: null, maxTradesPerDay: Infinity,
};
const barCtx = { candles, config: { logicType: 'SMC', logic: {} }, symbol: 'X', timeframe: '1H' };

// Sanity: signal is a bullish SMC with the expected numeric invalidation, and with the
// gate disabled (minRR 0) nothing else blocks it.
const probe = evaluateBar(barCtx, { guardrails: { ...baseGuards, minRiskRewardRatio: 0 }, portfolio: {} });
assert.strictEqual(probe.signal.side, 'BUY', 'fixture is bullish SMC');
assert.strictEqual(probe.signal.invalidation, 20, 'fixture invalidation = 20');
assert.strictEqual(probe.decision.decision, 'PERMIT', 'minRR 0 permits (no other gate blocks)');

// Discriminator: configRR (fallback) = 0.10/0.05 = 2.0; setupRR = 0.10/0.20 = 0.5.
// With minRR 1.9 the fallback would PERMIT (2.0 >= 1.9); only the structural path DENYs
// (0.5 < 1.9). A structural DENY proves signal.invalidation reached the policy via ctx.
const gated = evaluateBar(barCtx, { guardrails: { ...baseGuards, minRiskRewardRatio: 1.9 }, portfolio: {} });
assert.strictEqual(gated.decision.decision, 'DENY', 'structural setupRR 0.5 < 1.9 → DENY');
assert.ok(/structural/i.test(gated.decision.reason), 'DENY reason is structural (invalidation was plumbed)');

console.log('  ok - pipeline plumbs signal.invalidation into RiskPolicy (structural gate fires)');
