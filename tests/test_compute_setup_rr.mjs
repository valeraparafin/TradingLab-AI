// tests/test_compute_setup_rr.mjs
import assert from 'node:assert';
import { computeSetupRR } from '../src/agents/computeSetupRR.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

// BUY normal: entry 100, invalidation 98 → riskFrac 0.02; TP 0.06 → RR 3.0
assert.strictEqual(
  computeSetupRR({ entryPrice: 100, invalidation: 98, side: 'BUY', takeProfitPct: 0.06 }), 3.0);
ok('BUY normal → 3.0');

// SELL normal: entry 100, invalidation 103 → riskFrac 0.03; TP 0.06 → RR 2.0
assert.strictEqual(
  computeSetupRR({ entryPrice: 100, invalidation: 103, side: 'SELL', takeProfitPct: 0.06 }), 2.0);
ok('SELL normal → 2.0');

// Wrong side for BUY (invalidation above entry) → null
assert.strictEqual(
  computeSetupRR({ entryPrice: 100, invalidation: 102, side: 'BUY', takeProfitPct: 0.06 }), null);
ok('BUY wrong-side → null');

// Wrong side for SELL (invalidation below entry) → null
assert.strictEqual(
  computeSetupRR({ entryPrice: 100, invalidation: 98, side: 'SELL', takeProfitPct: 0.06 }), null);
ok('SELL wrong-side → null');

// Zero distance (invalidation == entry) → null
assert.strictEqual(
  computeSetupRR({ entryPrice: 100, invalidation: 100, side: 'BUY', takeProfitPct: 0.06 }), null);
ok('zero distance → null');

// null / NaN / non-numeric invalidation → null (LLM string path lands here)
assert.strictEqual(computeSetupRR({ entryPrice: 100, invalidation: null, side: 'BUY', takeProfitPct: 0.06 }), null);
assert.strictEqual(computeSetupRR({ entryPrice: 100, invalidation: NaN, side: 'BUY', takeProfitPct: 0.06 }), null);
assert.strictEqual(computeSetupRR({ entryPrice: 100, invalidation: 'Invalidate if structure flips', side: 'BUY', takeProfitPct: 0.06 }), null);
ok('null/NaN/string invalidation → null');

// HOLD or unknown side → null
assert.strictEqual(computeSetupRR({ entryPrice: 100, invalidation: 98, side: 'HOLD', takeProfitPct: 0.06 }), null);
ok('HOLD side → null');

// Missing/garbage/non-positive takeProfitPct → null
assert.strictEqual(computeSetupRR({ entryPrice: 100, invalidation: 98, side: 'BUY', takeProfitPct: null }), null);
assert.strictEqual(computeSetupRR({ entryPrice: 100, invalidation: 98, side: 'BUY', takeProfitPct: 0 }), null);
assert.strictEqual(computeSetupRR({ entryPrice: 100, invalidation: 98, side: 'BUY', takeProfitPct: -0.06 }), null);
ok('null/zero/negative takeProfitPct → null');

console.log(`\n${passed} checks passed`);
