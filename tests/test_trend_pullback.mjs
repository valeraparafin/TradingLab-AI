// tests/test_trend_pullback.mjs
import assert from 'node:assert';
import TrendPullback from '../src/indicators/trendPullback.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

// Candle helper with an explicit time step (aggregateHTF infers the step from times).
const STEP = 3600_000; // 1h
const mk = (o, h, l, cl, i) => ({ time: i * STEP, open: o, high: h, low: l, close: cl, volume: 1 });

// Build a long uptrend, then a brief pullback that tags the fast EMA, then a reclaim bar.
// Single-TF (htfRatio=1) keeps bias/regime on the working series so the test is deterministic.
// Candle shape tuned so: (a) HTF close stays above EMA(50) even at pullback bottom (bias=1),
// (b) RSI drops below 45 on the last pullback bar (rsiPrev<=45), and (c) the reclaim bar
// pushes close back above EMA(20) and RSI above 45 (trigger=1).
function uptrendThenPullback() {
  const candles = [];
  let price = 100, i = 0;
  for (; i < 320; i++) { price += 0.5; candles.push(mk(price - 0.5, price + 0.3, price - 0.3, price, i)); } // strong trend
  // pullback: five down bars driving RSI below 45 and tagging the fast EMA
  for (let k = 0; k < 5; k++, i++) { price -= 1.5; candles.push(mk(price + 1.5, price + 1.6, price - 0.2, price, i)); }
  // reclaim bar: a strong up close pushes RSI back up through 45 (the trigger)
  price += 5.5; candles.push(mk(price - 5.5, price + 0.2, price - 5.6, price, i)); i++;
  return candles;
}

// --- aligned uptrend pullback → BUY ---
{
  const candles = uptrendThenPullback();
  const raw = TrendPullback.execute(candles, { indicators: { htfRatio: 1, emaBias: 50, adxMin: 15 } });
  assert.strictEqual(raw.side, 'BUY', `aligned long setup → BUY (got ${raw.side}; bias=${raw.bias} regime=${raw.regimeOK} trig=${raw.trigger})`);
  assert.ok(raw.invalidation != null && raw.invalidation < raw.price, 'BUY invalidation is a swing low below price');
  ok('aligned uptrend pullback → BUY');
}

// --- chop (low ADX) → HOLD even if other layers flicker ---
{
  const candles = [];
  for (let i = 0; i < 200; i++) candles.push(mk(100, 100.5, 99.5, i % 2 ? 100.2 : 99.8, i));
  const raw = TrendPullback.execute(candles, { indicators: { htfRatio: 1, emaBias: 50, adxMin: 25 } });
  assert.strictEqual(raw.side, 'HOLD', `chop → HOLD (regimeOK=${raw.regimeOK})`);
  assert.strictEqual(raw.regimeOK, false, 'regime gate closed in chop');
  ok('chop → HOLD');
}

// --- mirrored downtrend pullback → SELL ---
{
  const candles = [];
  let price = 300, i = 0;
  for (; i < 320; i++) { price -= 0.5; candles.push(mk(price + 0.5, price + 0.3, price - 0.3, price, i)); }
  for (let k = 0; k < 5; k++, i++) { price += 1.5; candles.push(mk(price - 1.5, price + 0.2, price - 1.6, price, i)); }
  price -= 5.5; candles.push(mk(price + 5.5, price + 5.6, price - 0.2, price, i)); i++;
  const raw = TrendPullback.execute(candles, { indicators: { htfRatio: 1, emaBias: 50, adxMin: 15 } });
  assert.strictEqual(raw.side, 'SELL', `aligned short setup → SELL (got ${raw.side}; bias=${raw.bias} regime=${raw.regimeOK} trig=${raw.trigger})`);
  assert.ok(raw.invalidation != null && raw.invalidation > raw.price, 'SELL invalidation is a swing high above price');
  ok('aligned downtrend pullback → SELL');
}

// --- htfRatio toggle changes the aggregation (2-TF path runs without throwing and yields a defined side) ---
{
  const candles = uptrendThenPullback();
  const raw = TrendPullback.execute(candles, { indicators: { htfRatio: 4, emaBias: 20, adxMin: 15 } });
  assert.ok(['BUY', 'SELL', 'HOLD'].includes(raw.side), 'dual-TF path returns a valid side');
  ok('htfRatio=4 dual-TF path runs');
}

// --- insufficient data → HOLD, no throw ---
{
  const candles = Array.from({ length: 10 }, (_, i) => mk(100, 101, 99, 100, i));
  const raw = TrendPullback.execute(candles, { indicators: {} });
  assert.strictEqual(raw.side, 'HOLD', 'short input → HOLD');
  ok('insufficient data → HOLD');
}

console.log(`\n${passed} checks passed`);
