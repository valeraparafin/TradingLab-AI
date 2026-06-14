// tests/test_ob_snapshot.mjs
import assert from 'node:assert';
import { buildSnapshot } from '../src/marketdata/orderbook/snapshot.js';
let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

const futBook = { ready: true, bids: [[100.0, 10]], asks: [[100.1, 10]] };
const spotBook = { ready: true, bids: [[100.0, 99]], asks: [[100.1, 5]] };
const trades = [{ t: 9000, p: 100, q: 3, m: false }];
const opts = { book: { depthBps: 100 }, tape: { windowMs: 5000 } };

// both books ready
let s = buildSnapshot({ symbol: 'GPSUSDT', ts: 9000, now: 9000, futBook, futTrades: trades, spotBook, opts });
assert.strictEqual(s.ready, true, 'futures ready → ready'); ok('ready');
assert.strictEqual(s.spotReady, true, 'spot ready → spotReady'); ok('spotReady');
assert.strictEqual(s.symbol, 'GPSUSDT', 'symbol'); ok('symbol');
assert.ok(s.futures && typeof s.futures.mid === 'number', 'futures features present'); ok('futures present');
assert.ok('printVelocity' in s.futures, 'tape merged into futures'); ok('tape merged');
assert.ok(s.spot && typeof s.spot.mid === 'number', 'spot features present'); ok('spot present');

// spot absent → spotReady false, spot null, futures still primary
s = buildSnapshot({ symbol: 'GPSUSDT', ts: 9000, now: 9000, futBook, futTrades: trades, spotBook: null, opts });
assert.strictEqual(s.ready, true, 'futures still primary'); ok('fut primary w/o spot');
assert.strictEqual(s.spotReady, false, 'no spot → spotReady false'); ok('no spot');
assert.strictEqual(s.spot, null, 'no spot → spot null'); ok('spot null');

// futures stale → not ready, futures null
s = buildSnapshot({ symbol: 'GPSUSDT', ts: 9000, now: 9000, futBook: { ready: false, bids: [], asks: [] }, futTrades: trades, spotBook, opts });
assert.strictEqual(s.ready, false, 'stale futures → not ready'); ok('stale fut');
assert.strictEqual(s.futures, null, 'stale futures → futures null'); ok('fut null');

console.log(`\n${p} checks passed`);
