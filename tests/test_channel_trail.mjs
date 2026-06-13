// tests/test_channel_trail.mjs
import assert from 'node:assert';
import { channelTrailStop } from '../src/backtest/exitPolicy.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };
const bar = (h, l) => ({ time: 0, open: l, high: h, low: l, close: (h + l) / 2, volume: 1 });

// --- BUY: ratchet UP to the M-bar lowest low; never lowers ---
{
  const pos = { side: 'BUY', entryPrice: 100, slPrice: 90 }; // initial 2ATR stop at 90
  // recent lows 96, 97, 98 → lowest 96 > 90 → stop ratchets up to 96
  const moved = channelTrailStop(pos, [bar(101, 96), bar(102, 97), bar(103, 98)]);
  assert.strictEqual(moved, 96, 'BUY stop ratchets up to M-bar low');
  ok('channelTrailStop BUY ratchets up');
}

// --- BUY: never lowers below current stop ---
{
  const pos = { side: 'BUY', entryPrice: 100, slPrice: 98 };
  const moved = channelTrailStop(pos, [bar(101, 95), bar(102, 94)]); // lowest 94 < 98 → keep 98
  assert.strictEqual(moved, 98, 'BUY stop never lowers');
  ok('channelTrailStop BUY ratchet-only');
}

// --- SELL: ratchet DOWN to the M-bar highest high; never raises ---
{
  const pos = { side: 'SELL', entryPrice: 100, slPrice: 110 };
  const moved = channelTrailStop(pos, [bar(104, 99), bar(103, 98)]); // highest 104 < 110 → 104
  assert.strictEqual(moved, 104, 'SELL stop ratchets down to M-bar high');
  ok('channelTrailStop SELL ratchets down');
}

// --- empty window → unchanged ---
{
  const pos = { side: 'BUY', entryPrice: 100, slPrice: 90 };
  assert.strictEqual(channelTrailStop(pos, []), 90, 'empty window keeps stop');
  ok('channelTrailStop empty window unchanged');
}

console.log(`\n${passed} passed`);
