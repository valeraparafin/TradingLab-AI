// tests/test_breakout_signal.mjs
import assert from 'node:assert';
import { breakoutSignal } from '../src/marketdata/orderbook/breakoutSignal.js';
let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

const LEVEL = { resistance: 100, support: 90, coiled: true };

// build a futures-primary snapshot; spotImb!=null adds a spot confirm book
const feat = ({ imb = 0.5, agg = 0.5, vel = 5, ask = 100, bid = 200, mid = 105, spread = 0.1, spotImb = null } = {}) => ({
  ready: true, spotReady: spotImb != null, ts: 1000,
  futures: {
    mid, spread, microprice: mid, bidDepthNbps: bid, askDepthNbps: ask,
    imbalance: imb, aggressorImbalance: agg, printVelocity: vel,
    nearWallBid: null, nearWallAsk: null, lastPrice: mid, buyVolUsd: 0, sellVolUsd: 0,
  },
  spot: spotImb != null ? { mid, spread, imbalance: spotImb, bidDepthNbps: bid, askDepthNbps: ask } : null,
});

// BUY confirm: cross above resistance, bid-heavy, buyers aggressing, thin asks, live tape
let s = breakoutSignal({ level: LEVEL, feat: feat(), prevMid: 99 });
assert.ok(s && s.side === 'BUY' && s.setup === 'breakout'); ok('BUY confirm fires');
assert.deepStrictEqual(s.invalidation, { backInsideRange: 100 }); ok('invalidation = broken level');

// SELL confirm: cross below support (mid 85), ask-heavy, sellers aggressing, thin bids
const fsell = feat({ imb: -0.5, agg: -0.5, mid: 85, bid: 100, ask: 200 });
s = breakoutSignal({ level: LEVEL, feat: fsell, prevMid: 91 });
assert.ok(s && s.side === 'SELL'); ok('SELL confirm fires');

// trigger but book contradicts (imbalance negative on a BUY cross) → null
s = breakoutSignal({ level: LEVEL, feat: feat({ imb: -0.5 }), prevMid: 99 });
assert.strictEqual(s, null); ok('trigger but book contradicts → null');

// dead tape (printVelocity below floor) → null
s = breakoutSignal({ level: LEVEL, feat: feat({ vel: 0.1 }), prevMid: 99 });
assert.strictEqual(s, null); ok('dead tape → null');

// no prevMid (first tick) → null
s = breakoutSignal({ level: LEVEL, feat: feat(), prevMid: null });
assert.strictEqual(s, null); ok('no prevMid → null');

// not ready → null
s = breakoutSignal({ level: LEVEL, feat: { ready: false, futures: null }, prevMid: 99 });
assert.strictEqual(s, null); ok('not ready → null');

// conviction: spot agree boosts, spot disagree penalizes, spot missing still fires
const base = breakoutSignal({ level: LEVEL, feat: feat(), prevMid: 99 });
const boosted = breakoutSignal({ level: LEVEL, feat: feat({ spotImb: 0.5 }), prevMid: 99 });
const penalized = breakoutSignal({ level: LEVEL, feat: feat({ spotImb: -0.5 }), prevMid: 99 });
assert.ok(base && base.conviction > 0); ok('spot missing → futures-only signal fires');
assert.ok(boosted.conviction > base.conviction); ok('spot agree boosts conviction');
assert.ok(penalized.conviction < base.conviction); ok('spot disagree penalizes conviction');

console.log(`\n${p} checks passed`);
