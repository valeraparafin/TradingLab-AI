// tests/test_scalp_breakout.mjs
import assert from 'node:assert';
import ScalpBreakout from '../src/indicators/scalpBreakout.js';
import { SIDE } from '../src/core/contracts.js';
let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

const bar = (h, l, c) => ({ time: 0, open: (h + l) / 2, high: h, low: l, close: c, volume: 1 });
// 30 prior bars hugging resistance ~100 (multiple touches, tight pinch), then a breakout bar.
const prior = [];
for (let i = 0; i < 30; i++) prior.push(bar(100, 99, 99.5)); // touches res=100 repeatedly, tight band
const cfg = { lookback: 30, minTouches: 2, touchTol: 0.0015, breakoutMargin: 0.0005, pinchBars: 6, pinchRatio: 2 };

const breakoutUp = [...prior, bar(101, 99.6, 100.8)]; // close 100.8 > 100*(1.0005)
let r = ScalpBreakout.execute(breakoutUp, cfg);
assert.strictEqual(r.side, SIDE.BUY, 'breakout up → BUY'); ok('BUY on upside breakout');
assert.strictEqual(r.invalidation, 100, 'invalidation = broken resistance'); ok('invalidation = level');

const inside = [...prior, bar(100, 99.5, 99.8)]; // no breakout
r = ScalpBreakout.execute(inside, cfg);
assert.strictEqual(r.side, SIDE.HOLD, 'inside channel → HOLD'); ok('HOLD inside');

// too few bars
assert.strictEqual(ScalpBreakout.execute([bar(1, 1, 1)], cfg).side, SIDE.HOLD, 'short input → HOLD'); ok('HOLD short input');

console.log(`\n${p} checks passed`);
