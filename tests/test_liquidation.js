import assert from 'node:assert';
import { liqPrice } from '../src/core/liquidation.js';

// Long 10x, mmr 0.005: liq ≈ entry × (1 − 1/10 + 0.005) = entry × 0.905
assert.ok(Math.abs(liqPrice(100, 'BUY', 10, 0.005) - 90.5) < 1e-9, 'long 10x liq');
// Short 10x: liq ≈ entry × (1 + 1/10 − 0.005) = entry × 1.095
assert.ok(Math.abs(liqPrice(100, 'SELL', 10, 0.005) - 109.5) < 1e-9, 'short 10x liq');
// Long 5x, mmr 0: liq = entry × 0.8
assert.ok(Math.abs(liqPrice(200, 'BUY', 5, 0) - 160) < 1e-9, 'long 5x liq no-mmr');
// Higher leverage → liq closer to entry (long)
assert.ok(liqPrice(100, 'BUY', 20, 0.005) > liqPrice(100, 'BUY', 5, 0.005), 'more leverage → closer liq (long)');
// Spot / no inputs → null (no liquidation concept)
assert.strictEqual(liqPrice(100, 'BUY', 1, 0.005), null, 'leverage 1 → null');
assert.strictEqual(liqPrice(100, 'BUY', 10, null), null, 'no mmr → null');
assert.strictEqual(liqPrice(100, 'HOLD', 10, 0.005), null, 'bad side → null');

console.log('test_liquidation.js OK');
