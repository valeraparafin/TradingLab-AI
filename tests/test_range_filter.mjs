// tests/test_range_filter.mjs
import assert from 'node:assert';
import RangeFilter from '../src/indicators/rangeFilter.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };
const bar = (c) => ({ time: 0, open: c, high: c + 0.5, low: c - 0.5, close: c, volume: 1 });

// --- insufficient candles → HOLD / neutral state ---
{
  const r = RangeFilter.execute([bar(100)], { indicators: { period: 20, multiplier: 3.5 } });
  assert.strictEqual(r.side, 'HOLD', 'insufficient candles → HOLD');
  assert.strictEqual(r.state, 0, 'insufficient candles → neutral state');
  ok('insufficient candles → HOLD/neutral');
}

// --- sustained uptrend → filter rises, state long ---
{
  const candles = [];
  for (let i = 0; i < 60; i++) candles.push(bar(100));      // flat warmup
  for (let i = 1; i <= 40; i++) candles.push(bar(100 + i)); // strong rising leg
  const r = RangeFilter.execute(candles, { indicators: { period: 20, multiplier: 3.5 } });
  assert.strictEqual(r.dir, 1, 'rising filter → dir = 1');
  assert.strictEqual(r.state, 1, 'uptrend → long state');
  ok('uptrend → dir up, long state');
}

// --- uptrend then sharp reversal → flips to short state ---
{
  const candles = [];
  for (let i = 0; i < 60; i++) candles.push(bar(100));
  for (let i = 1; i <= 40; i++) candles.push(bar(100 + i)); // up to 140
  for (let i = 1; i <= 40; i++) candles.push(bar(140 - i)); // back down to 100
  const r = RangeFilter.execute(candles, { indicators: { period: 20, multiplier: 3.5 } });
  assert.strictEqual(r.state, -1, 'after reversal → short state');
  assert.strictEqual(r.dir, -1, 'falling filter → dir = -1');
  ok('reversal → short state');
}

// --- params read from snake_case too (casing policy) ---
{
  const candles = [];
  for (let i = 0; i < 40; i++) candles.push(bar(100));
  const r = RangeFilter.execute(candles, { indicators: { period: 10, multiplier: 2.5, source: 'hl2' } });
  assert.ok(['BUY', 'SELL', 'HOLD'].includes(r.side), 'side is a valid enum value');
  ok('reads alt params/source without throwing');
}

// --- flip on the final bar → freshFlip true + directional side ---
{
  const candles = [];
  for (let i = 0; i < 40; i++) candles.push(bar(100));      // flat warmup
  for (let i = 1; i <= 30; i++) candles.push(bar(100 - i)); // down leg → short state (to 70)
  for (let i = 1; i <= 3; i++) candles.push(bar(70 + i * 2)); // up leg; LAST bar is the BUY flip
  const r = RangeFilter.execute(candles, { indicators: { period: 20, multiplier: 3.5 } });
  assert.strictEqual(r.freshFlip, true, 'flip bar → freshFlip true');
  assert.strictEqual(r.side, 'BUY', 'flip to long → side BUY');
  ok('fresh BUY flip on final bar');
}

console.log(`\n${passed} passed`);
