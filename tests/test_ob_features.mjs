import assert from 'node:assert';
import { computeBookFeatures } from '../src/marketdata/orderbook/obFeatures.js';
let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// book within ±100 bps of mid=100: bids 99.9(size100)+99.0(size50), asks 100.1(size20)+101.0(size10)
const book = {
  ready: true,
  bids: [[99.9, 100], [99.0, 50], [90.0, 999]], // 90.0 is outside 100bps → excluded from depth
  asks: [[100.1, 20], [101.0, 10], [110.0, 999]],
};
const f = computeBookFeatures(book, { depthBps: 100 });
assert.ok(near(f.mid, 100.0), 'mid'); ok('mid');
assert.ok(near(f.spread, 0.2), 'spread = 100.1-99.9'); ok('spread');
// depth (USD = price*size) within window: bids 99.9*100 + 99.0*50 = 9990+4950 = 14940
assert.ok(near(f.bidDepthNbps, 14940), 'bid depth within bps'); ok('bid depth window');
// asks 100.1*20 + 101.0*10 = 2002+1010 = 3012
assert.ok(near(f.askDepthNbps, 3012), 'ask depth within bps'); ok('ask depth window');
assert.ok(f.imbalance > 0 && f.imbalance <= 1, 'imbalance positive (bid-heavy)'); ok('imbalance sign');
// near wall on bid: largest USD among bid levels = 90.0*999 (89910) — raw, not windowed
assert.ok(near(f.nearWallBid.px, 90.0), 'near wall bid is largest USD level'); ok('near wall bid');
assert.ok(f.nearWallBid.distBps > 0, 'wall distance in bps'); ok('wall dist');

// not ready / one-sided → null
assert.strictEqual(computeBookFeatures({ ready: false, bids: [], asks: [] }), null, 'not ready → null'); ok('not ready null');
assert.strictEqual(computeBookFeatures({ ready: true, bids: [[1, 1]], asks: [] }), null, 'one-sided → null'); ok('one-sided null');

console.log(`\n${p} checks passed`);
