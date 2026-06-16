// tests/test_range_filter_signal.mjs
import assert from 'node:assert';
import { deriveSignal } from '../src/core/SignalAdapter.js';
import { SIDE } from '../src/core/contracts.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

// --- BUY raw → BUY signal; fresh flip lifts conviction; invalidation = loBand ---
{
  const raw = { side: 'BUY', state: 1, freshFlip: true, loBand: 95, hiBand: 105 };
  const sig = deriveSignal('RangeFilter', raw, { price: 101, candles: [] });
  assert.strictEqual(sig.side, SIDE.BUY, 'BUY raw → BUY signal');
  assert.ok(sig.conviction > 0.6, 'fresh flip raises conviction above base');
  assert.strictEqual(sig.invalidation, 95, 'BUY invalidation = loBand');
  ok('fromRangeFilter maps BUY with fresh flip');
}

// --- HOLD raw → HOLD ---
{
  const sig = deriveSignal('RangeFilter', { side: 'HOLD', state: 0 }, { price: 100, candles: [] });
  assert.strictEqual(sig.side, SIDE.HOLD, 'HOLD raw → HOLD');
  ok('fromRangeFilter maps HOLD');
}

// --- SELL raw → SELL; invalidation = hiBand ---
{
  const raw = { side: 'SELL', state: -1, freshFlip: false, loBand: 95, hiBand: 105 };
  const sig = deriveSignal('RangeFilter', raw, { price: 99, candles: [] });
  assert.strictEqual(sig.side, SIDE.SELL, 'SELL raw → SELL signal');
  assert.strictEqual(sig.invalidation, 105, 'SELL invalidation = hiBand');
  ok('fromRangeFilter maps SELL');
}

console.log(`\n${passed} passed`);
