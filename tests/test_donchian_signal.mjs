// tests/test_donchian_signal.mjs
import assert from 'node:assert';
import { deriveSignal } from '../src/core/SignalAdapter.js';
import { IndicatorManager } from '../src/indicators/index.js';
import { SIDE } from '../src/core/contracts.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };
const bar = (h, l, c) => ({ time: 0, open: c, high: h, low: l, close: c, volume: 1 });

// --- mapper: BUY raw → BUY signal, no fixed invalidation (SL is ATR-based) ---
{
  const sig = deriveSignal('DonchianTrend', { side: 'BUY', invalidation: null }, { price: 101, candles: [] });
  assert.strictEqual(sig.side, SIDE.BUY, 'BUY raw maps to BUY signal');
  assert.strictEqual(sig.invalidation, null, 'no structural invalidation (ATR stop)');
  ok('fromDonchianTrend maps BUY');
}

// --- mapper: HOLD raw → HOLD ---
{
  const sig = deriveSignal('DonchianTrend', { side: 'HOLD' }, { price: 100, candles: [] });
  assert.strictEqual(sig.side, SIDE.HOLD, 'HOLD raw maps to HOLD');
  ok('fromDonchianTrend maps HOLD');
}

// --- IndicatorManager dispatches DONCHIANTREND to execute ---
{
  const candles = [];
  for (let i = 0; i < 20; i++) candles.push(bar(100, 95, 98));
  candles.push(bar(102, 99, 101));
  const raw = new IndicatorManager({ indicators: { entryLookback: 20 } }).calculate('DonchianTrend', candles);
  assert.strictEqual(raw.side, 'BUY', 'IndicatorManager routes DonchianTrend → execute');
  ok('IndicatorManager dispatches DonchianTrend');
}

console.log(`\n${passed} passed`);
