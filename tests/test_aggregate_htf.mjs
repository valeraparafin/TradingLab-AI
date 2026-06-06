// tests/test_aggregate_htf.mjs
import assert from 'node:assert';
import { aggregateHTF } from '../src/core/aggregateHTF.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

// Helper: build hourly candles (time in ms) with given closes; OHLC derived from close.
const HOUR = 3600000;
const mk = (t, o, h, l, c, v = 1) => ({ time: t, open: o, high: h, low: l, close: c, volume: v });

// --- basic 4:1 aggregation, boundary-aligned, last (open) bucket dropped ---
{
  // 9 hourly candles at t=0..8h. Buckets [0,4h) and [4h,8h) are closed by a later
  // candle; the 3rd bucket (just t=8h) is open → dropped. Expect 2 HTF bars.
  const c = [];
  for (let i = 0; i <= 8; i++) c.push(mk(i * HOUR, 10 + i, 20 + i, i, 12 + i));
  const htf = aggregateHTF(c, 4);
  assert.strictEqual(htf.length, 2, 'two closed 4h buckets');
  assert.strictEqual(htf[0].time, 0, 'bucket0 starts at boundary 0');
  assert.strictEqual(htf[0].open, c[0].open, 'bucket0 open = first');
  assert.strictEqual(htf[0].close, c[3].close, 'bucket0 close = last of [0,4h)');
  assert.strictEqual(htf[0].high, Math.max(c[0].high, c[1].high, c[2].high, c[3].high), 'bucket0 high = max');
  assert.strictEqual(htf[0].low, Math.min(c[0].low, c[1].low, c[2].low, c[3].low), 'bucket0 low = min');
  assert.strictEqual(htf[0].volume, 4, 'bucket0 volume = sum');
  assert.strictEqual(htf[1].time, 4 * HOUR, 'bucket1 starts at 4h boundary');
  assert.strictEqual(htf[1].close, c[7].close, 'bucket1 close = last of [4h,8h)');
  ok('4:1 aggregation, closed-only, OHLCV');
}

// --- calendar alignment: candles NOT starting on a boundary ---
{
  // times 2h..10h. floor(t/4h)*4h → bucket0 key=0 holds {2h,3h}; bucket4h holds {4..7h};
  // bucket8h (8..10h) open → dropped. So bucket0 is a PARTIAL leading bucket but is still
  // closed (a later bucket exists). Proves alignment by calendar, not by array index.
  const c = [];
  for (let i = 2; i <= 10; i++) c.push(mk(i * HOUR, 10, 20, 5, 12));
  const htf = aggregateHTF(c, 4);
  assert.strictEqual(htf.length, 2, 'two closed buckets (0 and 4h)');
  assert.strictEqual(htf[0].time, 0, 'leading bucket aligned to boundary 0');
  assert.strictEqual(htf[0].volume, 2, 'leading bucket has only the 2 candles in [0,4h)');
  assert.strictEqual(htf[1].time, 4 * HOUR, 'second bucket aligned to 4h');
  ok('calendar alignment (partial leading bucket)');
}

// --- modal step inference survives a gap ---
{
  // hourly with one missing hour; modal delta is still 1h.
  const times = [0, 1, 2, 3, 5, 6, 7, 8].map(h => h * HOUR);
  const c = times.map(t => mk(t, 10, 20, 5, 12));
  const htf = aggregateHTF(c, 4);
  // buckets: [0,4h) = {0,1,2,3} closed by t=5h; [4h,8h) = {5,6,7} closed by t=8h; [8h,..) open.
  assert.strictEqual(htf.length, 2, 'gap does not break step inference');
  assert.strictEqual(htf[0].time, 0);
  assert.strictEqual(htf[1].time, 4 * HOUR);
  ok('modal step inference with gap');
}

// --- guards: too few candles / bad ratio → [] ---
{
  assert.deepStrictEqual(aggregateHTF([], 4), [], 'empty → []');
  assert.deepStrictEqual(aggregateHTF([mk(0, 1, 1, 1, 1)], 4), [], 'single candle → []');
  assert.deepStrictEqual(aggregateHTF([mk(0, 1, 1, 1, 1), mk(HOUR, 1, 1, 1, 1)], 0), [], 'ratio 0 → []');
  ok('guards → []');
}

// --- minimum productive case: 2 candles spanning a boundary, ratio 1 → 1 closed bar ---
{
  const two = [mk(0, 1, 2, 0.5, 1.5), mk(HOUR, 1, 2, 0.5, 1.5)];
  assert.strictEqual(aggregateHTF(two, 1).length, 1, 'minimum productive: 2 candles ratio=1 → 1 bar');
  ok('minimum productive case → 1 bar');
}

console.log(`\n${passed} checks passed`);
