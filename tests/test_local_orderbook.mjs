// tests/test_local_orderbook.mjs
import assert from 'node:assert';
import { LocalOrderBook, VENUE } from '../src/marketdata/orderbook/LocalOrderBook.js';
let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

// --- spot: snapshot then in-order diffs ---
const spot = new LocalOrderBook({ venue: VENUE.SPOT, depthLimit: 5 });
spot.applySnapshot({ lastUpdateId: 100, bids: [['10.0', '2'], ['9.9', '3']], asks: [['10.1', '1'], ['10.2', '4']] });
assert.strictEqual(spot.state, 'READY', 'snapshot → READY'); ok('snapshot ready');

let b = spot.snapshotBook();
assert.deepStrictEqual(b.bids[0], [10.0, 2], 'best bid is highest price'); ok('best bid sorted');
assert.deepStrictEqual(b.asks[0], [10.1, 1], 'best ask is lowest price'); ok('best ask sorted');

// in-order diff (U <= lastUpdateId+1 <= u): update 10.0 size, add 9.8, remove 10.2
spot.applyDiff({ U: 101, u: 103, b: [['10.0', '5'], ['9.8', '7']], a: [['10.2', '0']] });
assert.strictEqual(spot.state, 'READY', 'in-order diff keeps READY'); ok('diff ready');
assert.strictEqual(spot.lastUpdateId, 103, 'lastUpdateId advances to u'); ok('seq advances');
b = spot.snapshotBook();
assert.deepStrictEqual(b.bids[0], [10.0, 5], 'bid size updated'); ok('bid updated');
assert.ok(!b.asks.some(([px]) => px === 10.2), 'level removed on size 0'); ok('level removed');

// --- spot: sequence gap → STALE ---
const gap = new LocalOrderBook({ venue: VENUE.SPOT });
gap.applySnapshot({ lastUpdateId: 50, bids: [['1.0', '1']], asks: [['1.1', '1']] });
gap.applyDiff({ U: 60, u: 65, b: [['1.0', '2']], a: [] }); // U(60) > lastUpdateId+1(51)
assert.strictEqual(gap.state, 'STALE', 'seq gap → STALE'); ok('spot seq gap stale');
assert.strictEqual(gap.staleReason, 'seq_gap', 'reason recorded'); ok('stale reason');

// --- spot: stale diff (u <= lastUpdateId) ignored, stays READY ---
const old = new LocalOrderBook({ venue: VENUE.SPOT });
old.applySnapshot({ lastUpdateId: 50, bids: [['1.0', '1']], asks: [['1.1', '1']] });
old.applyDiff({ U: 40, u: 49, b: [['1.0', '9']], a: [] });
assert.strictEqual(old.state, 'READY', 'old diff ignored, stays READY'); ok('stale diff ignored');
assert.strictEqual(old.snapshotBook().bids[0][1], 1, 'old diff did not mutate book'); ok('old diff no-op');

// --- crossed book → STALE ---
const cross = new LocalOrderBook({ venue: VENUE.SPOT });
cross.applySnapshot({ lastUpdateId: 50, bids: [['1.0', '1']], asks: [['1.1', '1']] });
cross.applyDiff({ U: 51, u: 52, b: [['1.2', '1']], a: [] }); // bid 1.2 >= ask 1.1
assert.strictEqual(cross.state, 'STALE', 'crossed book → STALE'); ok('crossed stale');

// --- futures: pu must chain to previous u ---
const fut = new LocalOrderBook({ venue: VENUE.FUT });
fut.applySnapshot({ lastUpdateId: 200, bids: [['5.0', '1']], asks: [['5.1', '1']] });
fut.applyDiff({ pu: 200, U: 201, u: 205, b: [['5.0', '3']], a: [] }); // pu == lastUpdateId
assert.strictEqual(fut.state, 'READY', 'fut chained diff READY'); ok('fut chain ok');
assert.strictEqual(fut.lastUpdateId, 205, 'fut seq advances to u'); ok('fut seq advances');
fut.applyDiff({ pu: 999, U: 206, u: 210, b: [['5.0', '4']], a: [] }); // pu != lastUpdateId(205)
assert.strictEqual(fut.state, 'STALE', 'fut broken chain → STALE'); ok('fut chain break stale');

console.log(`\n${p} checks passed`);
