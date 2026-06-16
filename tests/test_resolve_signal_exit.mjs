// tests/test_resolve_signal_exit.mjs
import assert from 'node:assert';
import { resolveSignalExit, signalStateSide } from '../src/manual/resolveSignalExit.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

// --- not signal mode → never exits by signal ---
{
  const r = resolveSignalExit({ exitMode: 'sl_tp', positionSide: 'BUY', strategyData: { state: -1 } });
  assert.strictEqual(r.exit, false, 'sl_tp mode → no signal exit');
  ok('resolveSignalExit: sl_tp mode never exits');
}

// --- signal mode, opposite state → exit ---
{
  const r = resolveSignalExit({ exitMode: 'signal', positionSide: 'BUY', strategyData: { state: -1 } });
  assert.strictEqual(r.exit, true, 'long position + short state → exit');
  ok('resolveSignalExit: opposite state exits');
}

// --- signal mode, aligned state → hold ---
{
  const r = resolveSignalExit({ exitMode: 'signal', positionSide: 'BUY', strategyData: { state: 1 } });
  assert.strictEqual(r.exit, false, 'long position + long state → hold');
  ok('resolveSignalExit: aligned state holds');
}

// --- signal mode, neutral state → hold (no flip yet) ---
{
  const r = resolveSignalExit({ exitMode: 'signal', positionSide: 'BUY', strategyData: { state: 0 } });
  assert.strictEqual(r.exit, false, 'neutral state → hold');
  ok('resolveSignalExit: neutral state holds');
}

// --- signalStateSide maps persistent state to a side ---
{
  assert.strictEqual(signalStateSide({ state: 1 }), 'BUY', 'state 1 → BUY');
  assert.strictEqual(signalStateSide({ state: -1 }), 'SELL', 'state -1 → SELL');
  assert.strictEqual(signalStateSide({ state: 0 }), 'HOLD', 'state 0 → HOLD');
  assert.strictEqual(signalStateSide({}), 'HOLD', 'missing state → HOLD');
  ok('signalStateSide maps state → side');
}

console.log(`\n${passed} passed`);
