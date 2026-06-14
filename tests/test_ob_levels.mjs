// tests/test_ob_levels.mjs
import assert from 'node:assert';
import { levelFromCandles } from '../src/marketdata/orderbook/levels.js';
let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

const bar = (h, l) => ({ time: 0, open: (h + l) / 2, high: h, low: l, close: (h + l) / 2, volume: 1 });

// too few candles → nulls
let r = levelFromCandles([bar(10, 9)], { lookback: 20 });
assert.strictEqual(r.resistance, null); assert.strictEqual(r.support, null); assert.strictEqual(r.coiled, false);
ok('too few candles → nulls');

// resistance/support from the prior lookback bars (current bar excluded)
const flat = Array.from({ length: 21 }, () => bar(110, 90)); // every range = 20
r = levelFromCandles(flat, { lookback: 20, pinchBars: 6, pinchRatio: 0.7 });
assert.strictEqual(r.resistance, 110); assert.strictEqual(r.support, 90);
ok('resistance/support from prior bars');
// recent range (20) is NOT <= 0.7 * earlier range (20) → not coiled
assert.strictEqual(r.coiled, false);
ok('flat ranges → not coiled');

// coiled: first 14 bars wide (range 40), last 7 tight (range 10)
const wide = Array.from({ length: 14 }, () => bar(120, 80));
const tight = Array.from({ length: 7 }, () => bar(105, 95));
r = levelFromCandles([...wide, ...tight], { lookback: 20, pinchBars: 6, pinchRatio: 0.7 });
assert.strictEqual(r.resistance, 120); assert.strictEqual(r.support, 80);
assert.strictEqual(r.coiled, true);
ok('tightening range → coiled');

console.log(`\n${p} checks passed`);
