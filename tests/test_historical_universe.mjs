// tests/test_historical_universe.mjs
import assert from 'node:assert';
import { dayKey, dailyStats, buildPicksByDay } from '../src/backtest/historicalUniverse.js';
let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

const D1 = Date.UTC(2025, 0, 1, 0, 0), DAY = 86400000;
// helper: one candle
const c = (t, o, h, l, cl, v) => ({ time: t, open: o, high: h, low: l, close: cl, volume: v });

assert.strictEqual(dayKey(D1), '2025-01-01', 'dayKey UTC'); ok('dayKey');

const candles = [
  c(D1, 10, 12, 9, 11, 100),         // day 1
  c(D1 + 3600000, 11, 13, 10, 12, 50),
  c(D1 + DAY, 12, 14, 11, 13, 200),  // day 2
];
const ds = dailyStats(candles);
assert.strictEqual(ds.length, 2, 'two days'); ok('dailyStats groups by day');
assert.ok(Math.abs(ds[0].volatility - (13 - 9) / 9) < 1e-9, 'day1 volatility = (hi-lo)/lo'); ok('volatility');

// buildPicksByDay: day D picks use D-1 stats only (no look-ahead)
const sym = {
  HOT: [c(D1, 1, 2, 1, 2, 1e6), c(D1 + DAY, 2, 2.1, 1.9, 2, 1e6)],   // big day-1 move
  FLAT: [c(D1, 1, 1.01, 0.99, 1, 1e6), c(D1 + DAY, 1, 1.01, 0.99, 1, 1e6)],
};
const picks = buildPicksByDay(sym, { minLiquidity: 0, topN: 1 });
assert.deepStrictEqual(picks['2025-01-02'], ['HOT'], 'day-2 picks from day-1 stats, HOT wins'); ok('rolling no-look-ahead pick');
assert.ok(picks['2025-01-01'] === undefined, 'first day has no prior → no picks'); ok('no pick on first day');

console.log(`\n${p} checks passed`);
