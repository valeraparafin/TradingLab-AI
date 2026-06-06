// tests/test_analyze_htf_filter.mjs
import assert from 'node:assert';
import { analyzeTrades } from '../scripts/analyze-htf-filter.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

const HOUR = 3600000;
const mk = (t, c) => ({ time: t, open: c, high: c + 1, low: c - 1, close: c, volume: 1 });

// 80 rising HTF bars (closes 100,102,...) → emaBand at the last bar = UP.
const htf = Array.from({ length: 80 }, (_, i) => mk(i * 4 * HOUR, 100 + i * 2));
const lastTime = htf[htf.length - 1].time;

// Two trades at the last bar's time: a BUY (+5) and a SELL (-3).
const trades = [
  { side: 'BUY', entryTime: lastTime, pnl: 5 },
  { side: 'SELL', entryTime: lastTime, pnl: -3 },
];

const res = analyzeTrades(trades, htf, { emaPeriod: 50, band: 0.005, adxPeriod: 14, adxThreshold: 25 });

// Every definition must conserve trade count and PnL.
for (const def of ['emaBand', 'emaSlope', 'adxRegime']) {
  const b = res[def];
  const count = b.with.count + b.against.count + b.neutral.count;
  const pnl = b.with.pnl + b.against.pnl + b.neutral.pnl;
  assert.strictEqual(count, 2, `${def}: counts sum to trades`);
  assert.ok(Math.abs(pnl - 2) < 1e-9, `${def}: pnl conserved (5 + -3 = 2)`);
}
ok('count and PnL conserved across all definitions');

// emaBand is the reliable one for a rising series: BUY=with, SELL=against.
assert.strictEqual(res.emaBand.with.count, 1, 'emaBand: BUY in UP → with');
assert.strictEqual(res.emaBand.with.pnl, 5);
assert.strictEqual(res.emaBand.with.wins, 1, 'BUY +5 counts as a win');
assert.strictEqual(res.emaBand.against.count, 1, 'emaBand: SELL in UP → against');
assert.strictEqual(res.emaBand.against.pnl, -3);
assert.strictEqual(res.emaBand.against.wins, 0);
ok('emaBand buckets BUY=with / SELL=against in an uptrend');

// A trade before the first HTF bar → neutral (no closed HTF bar yet).
const early = analyzeTrades([{ side: 'BUY', entryTime: -1, pnl: 1 }], htf, {});
assert.strictEqual(early.emaBand.neutral.count, 1, 'pre-history trade → neutral');
ok('trade before first HTF bar → neutral');

console.log(`\n${passed} checks passed`);
