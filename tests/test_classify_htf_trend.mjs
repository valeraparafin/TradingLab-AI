// tests/test_classify_htf_trend.mjs
import assert from 'node:assert';
import { classifyHTFTrend } from '../src/core/classifyHTFTrend.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

const mk = (c) => ({ time: 0, open: c, high: c + 1, low: c - 1, close: c, volume: 1 });

// --- insufficient data → all NEUTRAL ---
{
  const htf = Array.from({ length: 10 }, (_, i) => mk(100 + i));
  const v = classifyHTFTrend(htf, { emaPeriod: 50 });
  assert.strictEqual(v.emaBand, 'NEUTRAL');
  assert.strictEqual(v.emaSlope, 'NEUTRAL');
  assert.strictEqual(v.adxRegime, 'NEUTRAL');
  ok('insufficient data → all NEUTRAL');
}

// --- strong uptrend: close well above EMA, EMA rising, ADX high → UP across defs ---
{
  // 80 bars rising by 2 each → last close far above EMA50; steady positive slope.
  const htf = Array.from({ length: 80 }, (_, i) => mk(100 + i * 2));
  const v = classifyHTFTrend(htf, { emaPeriod: 50, band: 0.005, slopeLookback: 5, slopeThreshold: 0.002, adxPeriod: 14, adxThreshold: 25 });
  assert.strictEqual(v.emaBand, 'UP', 'emaBand UP');
  assert.strictEqual(v.emaSlope, 'UP', 'emaSlope UP');
  assert.strictEqual(v.adxRegime, 'UP', 'adxRegime UP (trend present)');
  ok('strong uptrend → UP across all three');
}

// --- strong downtrend → DOWN across defs ---
{
  const htf = Array.from({ length: 80 }, (_, i) => mk(300 - i * 2));
  const v = classifyHTFTrend(htf, { emaPeriod: 50, band: 0.005, slopeLookback: 5, slopeThreshold: 0.002, adxPeriod: 14, adxThreshold: 25 });
  assert.strictEqual(v.emaBand, 'DOWN', 'emaBand DOWN');
  assert.strictEqual(v.emaSlope, 'DOWN', 'emaSlope DOWN');
  assert.strictEqual(v.adxRegime, 'DOWN', 'adxRegime DOWN');
  ok('strong downtrend → DOWN across all three');
}

// --- flat market → all NEUTRAL (band + flat slope + low ADX) ---
{
  const htf = Array.from({ length: 80 }, () => mk(100));
  const v = classifyHTFTrend(htf, { emaPeriod: 50, band: 0.005, slopeLookback: 5, slopeThreshold: 0.002, adxPeriod: 14, adxThreshold: 25 });
  assert.strictEqual(v.emaBand, 'NEUTRAL', 'flat: close == EMA → NEUTRAL');
  assert.strictEqual(v.emaSlope, 'NEUTRAL', 'flat: zero slope → NEUTRAL');
  assert.strictEqual(v.adxRegime, 'NEUTRAL', 'flat: no trend → NEUTRAL');
  ok('flat market → all NEUTRAL');
}

// --- regime gate independence: low-ADX market → adxRegime NEUTRAL even while emaBand UP ---
{
  // 79 flat bars (no directional movement → ADX stays low), then one bar closing ~10% above EMA.
  const htf = Array.from({ length: 79 }, () => mk(100));
  htf.push({ time: 0, open: 100, high: 112, low: 99, close: 110, volume: 1 });
  const v = classifyHTFTrend(htf, { emaPeriod: 14, band: 0.005, adxPeriod: 14, adxThreshold: 25 });
  assert.strictEqual(v.emaBand, 'UP', 'price 10% above EMA → emaBand UP');
  assert.strictEqual(v.adxRegime, 'NEUTRAL', 'regime gate suppresses direction in low-ADX market');
  ok('regime gate: emaBand UP but adxRegime NEUTRAL');
}

console.log(`\n${passed} checks passed`);
