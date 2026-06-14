// tests/test_tape_features.mjs
import assert from 'node:assert';
import { computeTapeFeatures } from '../src/marketdata/orderbook/tapeFeatures.js';
let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// Binance aggTrade: m=true → buyer is maker → aggressor is the SELLER.
const now = 10000;
const trades = [
  { t: 2000, p: 10, q: 100, m: false }, // OLD (>5s) → dropped
  { t: 6000, p: 10, q: 50, m: false },  // buy aggressor, 500 usd
  { t: 7000, p: 11, q: 10, m: true },   // sell aggressor, 110 usd
  { t: 9000, p: 12, q: 5, m: false },   // buy aggressor, 60 usd
];
const f = computeTapeFeatures(trades, now, { windowMs: 5000 });
assert.ok(near(f.buyVolUsd, 560), 'buy usd = 500+60'); ok('buy vol');
assert.ok(near(f.sellVolUsd, 110), 'sell usd = 110'); ok('sell vol');
assert.ok(near(f.aggressorImbalance, (560 - 110) / 670), 'aggressor imbalance'); ok('imbalance');
assert.strictEqual(f.lastPrice, 12, 'last price is newest in window'); ok('last price');
assert.ok(near(f.printVelocity, 3 / 5), '3 prints over 5s'); ok('velocity');

// empty window → zeros, not NaN
const z = computeTapeFeatures([], now, { windowMs: 5000 });
assert.strictEqual(z.printVelocity, 0, 'empty velocity 0'); ok('empty velocity');
assert.strictEqual(z.aggressorImbalance, 0, 'empty imbalance 0'); ok('empty imbalance');
assert.strictEqual(z.lastPrice, null, 'empty last price null'); ok('empty last price');

console.log(`\n${p} checks passed`);
