// tests/test_feed_raw_books.mjs
import assert from 'node:assert';
import { OrderBookFeed } from '../src/marketdata/orderbook/OrderBookFeed.js';
import { LocalOrderBook, VENUE } from '../src/marketdata/orderbook/LocalOrderBook.js';

let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

const feed = new OrderBookFeed({ symbols: [{ futures: 'TESTUSDT', spot: 'TESTUSDT' }], record: false });

// Unknown symbol -> null (no crash).
assert.equal(feed.getRawBooks('NOPEUSDT'), null); ok('unknown symbol -> null');

// Seed a synced book directly (bypass network) and read it back.
const fut = new LocalOrderBook({ venue: VENUE.FUT, depthLimit: 20 });
fut.applySnapshot({ lastUpdateId: 1, bids: [['100', '5']], asks: [['101', '4']] });
feed.books.set('TESTUSDT', { fut, spot: null, trades: [{ t: 10, p: 100.5, q: 1, m: false }], clients: [], buffers: { fut: [], spot: [] }, synced: { fut: true, spot: false } });

const raw = feed.getRawBooks('TESTUSDT');
assert.ok(raw.fut && Array.isArray(raw.fut.bids), 'fut book present'); ok('fut book shape');
assert.equal(raw.spot, null); ok('spot null when absent');
assert.equal(raw.trades.length, 1); ok('trades passed through');

console.log(`\n${p} checks passed`);
