// tests/test_adx.mjs
import assert from 'node:assert';
import { Technicals } from '../src/indicators/technical.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };
const c = (h, l, cl) => ({ high: h, low: l, close: cl });

// --- strong steady uptrend → high ADX (> 40) ---
{
  const candles = Array.from({ length: 60 }, (_, i) => c(102 + i, 100 + i, 101 + i));
  const adx = Technicals.adx(candles, 14);
  assert.ok(adx.length > 0, 'produces a series');
  const last = adx[adx.length - 1];
  assert.ok(last > 40, `clean trend → high ADX (got ${last})`);
  for (const v of adx) assert.ok(v >= 0 && v <= 100, 'ADX within [0,100]');
  ok('strong trend → high ADX');
}

// --- flat/alternating chop → low ADX (< 25) ---
{
  const candles = Array.from({ length: 60 }, (_, i) =>
    (i % 2 === 0 ? c(101, 99, 100) : c(101.5, 99.5, 100.5)));
  const adx = Technicals.adx(candles, 14);
  const last = adx[adx.length - 1];
  assert.ok(last < 25, `chop → low ADX (got ${last})`);
  ok('chop → low ADX');
}

// --- insufficient data → [] ---
{
  const few = Array.from({ length: 20 }, () => c(101, 99, 100)); // < 2*period+1
  assert.deepStrictEqual(Technicals.adx(few, 14), [], 'too few candles → []');
  assert.deepStrictEqual(Technicals.adx([], 14), [], 'empty → []');
  ok('insufficient data → []');
}

console.log(`\n${passed} checks passed`);
