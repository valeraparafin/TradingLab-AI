// tests/test_trend_pullback_signal.mjs
import assert from 'node:assert';
import { deriveSignal } from '../src/core/SignalAdapter.js';
import { IndicatorManager } from '../src/indicators/index.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

// --- mapper: HOLD raw → HOLD signal ---
{
  const sig = deriveSignal('TrendPullback', { side: 'HOLD', invalidation: null }, { price: 100, candles: [] });
  assert.strictEqual(sig.side, 'HOLD', 'HOLD passes through');
  assert.strictEqual(sig.conviction, 0, 'HOLD conviction 0');
  ok('HOLD raw → HOLD signal');
}

// --- mapper: BUY raw → BUY signal, invalidation preserved, conviction in (0,1] ---
{
  const sig = deriveSignal('TrendPullback', { side: 'BUY', adx: 35, invalidation: 95 }, { price: 100, candles: [] });
  assert.strictEqual(sig.side, 'BUY', 'BUY side');
  assert.strictEqual(sig.invalidation, 95, 'invalidation preserved');
  assert.ok(sig.conviction > 0 && sig.conviction <= 1, 'conviction in (0,1]');
  ok('BUY raw → BUY signal');
}

// --- strong ADX lifts conviction above weak ADX ---
{
  const strong = deriveSignal('TrendPullback', { side: 'BUY', adx: 40, invalidation: 95 }, { price: 100, candles: [] });
  const weak = deriveSignal('TrendPullback', { side: 'BUY', adx: 20, invalidation: 95 }, { price: 100, candles: [] });
  assert.ok(strong.conviction > weak.conviction, 'higher ADX → higher conviction');
  ok('ADX raises conviction');
}

// --- IndicatorManager dispatches TRENDPULLBACK without throwing ---
{
  const STEP = 3600_000;
  const candles = Array.from({ length: 60 }, (_, i) => ({ time: i * STEP, open: 100, high: 101, low: 99, close: 100, volume: 1 }));
  const raw = new IndicatorManager({}).calculate('TrendPullback', candles);
  assert.ok(raw && typeof raw.side === 'string', 'IndicatorManager returns raw with a side');
  ok('IndicatorManager dispatches TRENDPULLBACK');
}

console.log(`\n${passed} checks passed`);
