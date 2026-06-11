// tests/test_htf_gate.mjs
import assert from 'node:assert';
import { withHtfGate, bucketOf } from '../src/backtest/htfGate.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

const HOUR = 3600000;
const mk = (t, c) => ({ time: t, open: c, high: c + 1, low: c - 1, close: c, volume: 1 });
// ratio:1 → each LTF candle is its own HTF bucket; the final (forming) bucket is dropped.
const series = (n, fn) => Array.from({ length: n }, (_, i) => mk(i * HOUR, fn(i)));
const falling = series(40, (i) => 100 - i); // emaBand DOWN
const rising  = series(40, (i) => 60 + i);  // emaBand UP
const flat    = series(40, () => 100);      // emaBand NEUTRAL
const thin    = series(5, (i) => 100 - i);  // < emaPeriod HTF bars → NEUTRAL

const opts = { ratio: 1, emaPeriod: 10, band: 0.005 };
const ctx = (candles) => ({ candles, config: { logicType: 'SMC', logic: {} }, symbol: 'BTCUSDT', timeframe: '1H' });

// Fixed result objects so passthrough can be asserted by reference identity.
const permit = (side) => {
  const r = { signal: { side }, decision: { decision: 'PERMIT', order: { side, sizeUSD: 100, entryPrice: 50, slPrice: 49, tpPrice: 52 } } };
  return () => r;
};
const denyInner = () => {
  const r = { signal: {}, decision: { decision: 'DENY', reason: 'inner' } };
  return () => r;
};

// --- against → DENY (BUY while HTF is DOWN) ---
{
  const out = withHtfGate(permit('BUY'), opts)(ctx(falling), {});
  assert.strictEqual(out.decision.decision, 'DENY', 'BUY against DOWN → DENY');
  assert.match(out.decision.reason, /HTF gate/, 'reason names the HTF gate');
  ok('against → DENY');
}

// --- with → passthrough (SELL while HTF is DOWN), identical result object ---
{
  const inner = permit('SELL');
  const out = withHtfGate(inner, opts)(ctx(falling), {});
  assert.strictEqual(out, inner(), 'with-trend result passes through unchanged (same ref)');
  ok('with → passthrough');
}

// --- neutral → passthrough (flat HTF) ---
{
  const inner = permit('BUY');
  const out = withHtfGate(inner, opts)(ctx(flat), {});
  assert.strictEqual(out, inner(), 'NEUTRAL HTF → passthrough');
  ok('neutral → passthrough');
}

// --- rising HTF: SELL is against → DENY, BUY is with → pass (symmetry) ---
{
  const denied = withHtfGate(permit('SELL'), opts)(ctx(rising), {});
  assert.strictEqual(denied.decision.decision, 'DENY', 'SELL against UP → DENY');
  const innerBuy = permit('BUY');
  const passed2 = withHtfGate(innerBuy, opts)(ctx(rising), {});
  assert.strictEqual(passed2, innerBuy(), 'BUY with UP → passthrough');
  ok('rising-HTF symmetry');
}

// --- inner DENY → passthrough, no HTF reason injected ---
{
  const inner = denyInner();
  const out = withHtfGate(inner, opts)(ctx(falling), {});
  assert.strictEqual(out, inner(), 'inner DENY passes through');
  assert.strictEqual(out.decision.reason, 'inner', 'reason untouched');
  ok('inner DENY → passthrough');
}

// --- thin HTF history → NEUTRAL → passthrough ---
{
  const inner = permit('BUY');
  const out = withHtfGate(inner, opts)(ctx(thin), {});
  assert.strictEqual(out, inner(), 'insufficient HTF bars → passthrough');
  ok('thin history → passthrough');
}

// --- bucketOf truth table ---
{
  assert.strictEqual(bucketOf('BUY', 'UP'), 'with');
  assert.strictEqual(bucketOf('BUY', 'DOWN'), 'against');
  assert.strictEqual(bucketOf('SELL', 'UP'), 'against');
  assert.strictEqual(bucketOf('SELL', 'DOWN'), 'with');
  assert.strictEqual(bucketOf('BUY', 'NEUTRAL'), 'neutral');
  assert.strictEqual(bucketOf('SELL', 'NEUTRAL'), 'neutral');
  ok('bucketOf truth table');
}

console.log(`\n${passed} checks passed`);
