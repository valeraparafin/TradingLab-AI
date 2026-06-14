import assert from 'node:assert';
import { LocalOrderBook, VENUE } from '../src/marketdata/orderbook/LocalOrderBook.js';
import { computeBookFeatures } from '../src/marketdata/orderbook/obFeatures.js';
import { replayEvents } from '../src/marketdata/orderbook/replay.js';
let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

// Recorded events (as parsed JSONL frames) for one spot book.
const events = [
  { k: 'snapshot', lastUpdateId: 100, bids: [['10.0', '2'], ['9.9', '3']], asks: [['10.1', '1']] },
  { k: 'depth', U: 101, u: 102, b: [['10.0', '5']], a: [] },
  { k: 'trade', p: '10.05', q: '1', m: false }, // ignored by book replay
];

const stream = replayEvents(events, { venue: VENUE.SPOT, depthLimit: 5, bookOpts: { depthBps: 100 } });
assert.strictEqual(stream.length, 2, 'one feature row per book event (snapshot + depth)'); ok('row count');

// Determinism: hand-driving the same core must reproduce the final feature row.
const b = new LocalOrderBook({ venue: VENUE.SPOT, depthLimit: 5 });
b.applySnapshot({ lastUpdateId: 100, bids: [['10.0', '2'], ['9.9', '3']], asks: [['10.1', '1']] });
b.applyDiff({ U: 101, u: 102, b: [['10.0', '5']], a: [] });
const expected = computeBookFeatures(b.snapshotBook(), { depthBps: 100 });
assert.deepStrictEqual(stream[stream.length - 1], expected, 'replay reproduces hand-driven features'); ok('determinism');

console.log(`\n${p} checks passed`);
