// tests/test_ob_signal_replay.mjs
import assert from 'node:assert';
import { replaySignals } from '../src/marketdata/orderbook/replaySignals.js';
let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

const bar = (h, l) => ({ time: 0, open: (h + l) / 2, high: h, low: l, close: (h + l) / 2, volume: 1 });
const candles = Array.from({ length: 21 }, () => bar(100, 90)); // resistance 100, support 90

const snap = (mid) => ({
  ready: true, spotReady: false, ts: mid,
  futures: {
    mid, spread: 0.01, microprice: mid, bidDepthNbps: 200, askDepthNbps: 100,
    imbalance: 0.5, aggressorImbalance: 0.5, printVelocity: 5,
    nearWallBid: null, nearWallAsk: null, lastPrice: mid,
  },
  spot: null,
});

// below resistance, then cross above → exactly one BUY signal
const sigs = replaySignals([snap(99), snap(101)], candles);
assert.strictEqual(sigs.length, 1); ok('one breakout signal on the cross');
assert.strictEqual(sigs[0].side, 'BUY'); ok('signal is BUY');
assert.strictEqual(sigs[0].ts, 101); ok('signal carries snapshot ts');

// --- framesToSnapshots ---
import { framesToSnapshots } from '../src/marketdata/orderbook/replaySignals.js';

const frames = [
  { t: 1, sym: 'X', v: 'fut',  k: 'snapshot', lastUpdateId: 10, bids: [['100', '5']], asks: [['101', '5']] },
  { t: 2, sym: 'X', v: 'spot', k: 'snapshot', lastUpdateId: 20, bids: [['100', '9']], asks: [['101', '9']] },
  { t: 3, sym: 'X', v: 'fut',  k: 'trade', p: 100.5, q: 10, m: false },
  { t: 4, sym: 'X', v: 'fut',  k: 'depth', U: 11, u: 12, pu: 10, b: [['100', '6']], a: [['101', '4']] },
];
const snaps = framesToSnapshots(frames, { symbol: 'X' });
assert.strictEqual(snaps.length, 2); ok('snapshot emitted only on futures book events');
assert.strictEqual(snaps[1].ready, true); ok('futures ready after depth applied');
assert.strictEqual(snaps[1].spotReady, true); ok('spot confirmed after its snapshot');
assert.strictEqual(snaps[1].futures.lastPrice, 100.5); ok('futures tape merged into snapshot');

console.log(`\n${p} checks passed`);
