// tests/test_atr.mjs
import assert from 'node:assert';
import { Technicals } from '../src/indicators/technical.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };
const c = (h, l, cl) => ({ high: h, low: l, close: cl });

// --- constant true range → ATR equals that constant ---
{
  // every bar: high 105, low 95, close 100, prev close 100 → TR = max(10,5,5) = 10.
  const candles = Array.from({ length: 20 }, () => c(105, 95, 100));
  const atr = Technicals.atr(candles, 14);
  assert.strictEqual(atr.length, 20 - 14, 'series length = n - period');
  for (const v of atr) assert.ok(Math.abs(v - 10) < 1e-9, 'constant TR → ATR = 10');
  ok('constant true range → ATR constant');
}

// --- insufficient data → [] ---
{
  const candles = Array.from({ length: 14 }, () => c(105, 95, 100)); // need > period
  assert.deepStrictEqual(Technicals.atr(candles, 14), [], 'n <= period → []');
  assert.deepStrictEqual(Technicals.atr([], 14), [], 'empty → []');
  ok('insufficient data → []');
}

// --- gap widens TR via |low - prevClose| ---
{
  const candles = Array.from({ length: 16 }, () => c(105, 95, 100));
  candles[15] = c(105, 80, 100); // TR = max(25, |105-100|, |80-100|) = 25
  const atr = Technicals.atr(candles, 14);
  assert.ok(atr[atr.length - 1] > 10, 'gap bar lifts the latest ATR above the 10 baseline');
  ok('gap widens true range');
}

console.log(`\n${passed} checks passed`);
