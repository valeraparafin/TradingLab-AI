import assert from 'assert';
import { findLatestBreak, buildZone, mitigated } from '../src/indicators/smcZone.js';
import SmcZone from '../src/indicators/smcZone.js';

const tests = [];
const add = (name, fn) => tests.push({ name, fn });

function fromCloses(closes) {
  return closes.map((close, i) => ({
    open: i === 0 ? close : closes[i - 1],
    high: close + 0.1,
    low: close - 0.1,
    close,
    volume: 1000,
  }));
}

const BULL = fromCloses([100.0, 100.6, 101.0, 100.5, 100.2, 100.4, 100.6, 100.2, 100.8, 101.6, 101.0, 100.2]);

add('finds the latest bullish break (BOS) with pivotLength 2', () => {
  const e = findLatestBreak(BULL, 2, 'bos_choch');
  assert.ok(e, 'expected a break event');
  assert.strictEqual(e.direction, 'bullish');
  assert.strictEqual(e.barIndex, 9);
  assert.strictEqual(e.type, 'BOS');
});

add('biasSource=choch rejects a pure BOS', () => {
  const e = findLatestBreak(BULL, 2, 'choch');
  assert.strictEqual(e, null);
});

add('buildZone(ob) returns the last opposite-color candle before a bullish impulse', () => {
  const z = buildZone(BULL, { direction: 'bullish', barIndex: 9 }, 'ob');
  assert.ok(z, 'expected an OB zone');
  assert.ok(Math.abs(z.top - 100.3) < 1e-9 && Math.abs(z.bottom - 100.1) < 1e-9,
    `OB zone should be idx7 [100.1,100.3], got [${z.bottom},${z.top}]`);
});

add('mitigated=false when price never closes through the far edge before entry', () => {
  const z = buildZone(BULL, { direction: 'bullish', barIndex: 9 }, 'ob');
  assert.strictEqual(mitigated(BULL, { direction: 'bullish', barIndex: 9 }, z), false);
});

add('mitigated=true when a bar closes below the zone bottom (bullish)', () => {
  const dipped = BULL.slice(0, 10)
    .concat([{ open: 101.0, high: 99.1, low: 98.9, close: 99.0, volume: 1000 }])
    .concat(BULL.slice(11));
  const z = buildZone(dipped, { direction: 'bullish', barIndex: 9 }, 'ob');
  assert.strictEqual(mitigated(dipped, { direction: 'bullish', barIndex: 9 }, z), true);
});

const cfg = (o) => ({ indicators: { pivotLength: 2, zoneType: 'ob', biasSource: 'bos_choch', ...o } });

// Mirror of BULL around 100 → bearish break + up-candle OB + retracement.
const BEAR = fromCloses([100.0, 99.4, 99.0, 99.5, 99.8, 99.6, 99.4, 99.8, 99.2, 98.4, 99.0, 99.8]);

add('execute → BUY when close retraces into the OB after a bullish break', () => {
  const r = SmcZone.execute(BULL, cfg());
  assert.strictEqual(r.side, 'BUY');
  assert.ok(Math.abs(r.invalidation - 100.1) < 1e-9, `invalidation should be OB bottom 100.1, got ${r.invalidation}`);
});

add('execute → HOLD when price has not yet returned to the zone', () => {
  const r = SmcZone.execute(BULL.slice(0, 11), cfg());
  assert.strictEqual(r.side, 'HOLD');
});

add('execute → HOLD under biasSource=choch (the break is a BOS)', () => {
  const r = SmcZone.execute(BULL, cfg({ biasSource: 'choch' }));
  assert.strictEqual(r.side, 'HOLD');
});

add('execute → SELL on the mirrored bearish setup', () => {
  const r = SmcZone.execute(BEAR, cfg());
  assert.strictEqual(r.side, 'SELL');
});

add('execute → HOLD on a bearish setup when longOnly=true', () => {
  const r = SmcZone.execute(BEAR, cfg({ longOnly: true }));
  assert.strictEqual(r.side, 'HOLD');
});

let failed = 0;
for (const t of tests) {
  try { t.fn(); console.log(`PASS ${t.name}`); }
  catch (e) { failed++; console.error(`FAIL ${t.name}\n   ${e.message}`); }
}
if (failed) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
console.log('\nAll smcZone tests passed!');
