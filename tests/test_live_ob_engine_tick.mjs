// tests/test_live_ob_engine_tick.mjs
import assert from 'node:assert';
import { LiveObEngine } from '../src/marketdata/orderbook/liveObEngine.js';

let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

// A feature snapshot helper: bid-heavy book + buy-aggressed tape (confirms a BUY breakout).
const feat = (mid, ready = true) => ({
  ready, spotReady: false, ts: 1000, symbol: 'SUIUSDT',
  futures: { mid, spread: mid * 0.0001, imbalance: 0.5, microprice: mid, aggressorImbalance: 0.5, printVelocity: 3, nearWallBid: null, nearWallAsk: null },
  spot: null,
});

// Fake feed driven by a queue of feature snapshots.
function fakeFeed(seq) {
  let i = 0;
  return {
    started: false, stopped: false,
    start() { this.started = true; },
    stop() { this.stopped = true; },
    getFeatures() { return seq[Math.min(i, seq.length - 1)]; },
    getRawBooks() { return { fut: { bids: [], asks: [] }, spot: null, trades: [] }; },
    advance() { i++; },
  };
}

const feed = fakeFeed([feat(99.5), feat(100.5)]); // below level, then crosses above
const engine = new LiveObEngine({
  feed,
  candlesProvider: async () => [],
  symbols: ['SUIUSDT'],
  opts: { baseTf: '5m', htfStep: 1, imbThresh: 0.10, record: false },
});

// Level set directly (candle refresh is a later task).
engine.setLevel('SUIUSDT', { resistance: 100, support: 98, coiled: false });

// Tick 1: prevMid null -> no signal, prevMid seeded.
engine._evaluate('SUIUSDT');
assert.equal(engine.drainSignals('SUIUSDT').length, 0); ok('first tick seeds prevMid, no signal');

// Tick 2: mid crosses 100 with book+tape confirm -> one PERMITted signal.
feed.advance();
engine._evaluate('SUIUSDT');
const drained = engine.drainSignals('SUIUSDT');
assert.equal(drained.length, 1, 'one signal'); ok('cross emits a signal');
assert.equal(drained[0].side, 'BUY'); ok('signal side BUY');

// Drain clears the buffer.
assert.equal(engine.drainSignals('SUIUSDT').length, 0); ok('drain clears buffer');

// Stats reflect the emission.
assert.equal(engine.getStats().SUIUSDT.signals, 1); ok('stats count signals');

// Not-ready tick is skipped (no crash, no signal).
const feed2 = fakeFeed([feat(99.5, false)]);
const e2 = new LiveObEngine({ feed: feed2, candlesProvider: async () => [], symbols: ['SUIUSDT'], opts: { record: false } });
e2.setLevel('SUIUSDT', { resistance: 100, support: 98, coiled: false });
e2._evaluate('SUIUSDT');
assert.equal(e2.drainSignals('SUIUSDT').length, 0); ok('not-ready tick skipped');

console.log(`\n${p} checks passed`);
