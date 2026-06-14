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

console.log(`\n${p} checks passed`);
