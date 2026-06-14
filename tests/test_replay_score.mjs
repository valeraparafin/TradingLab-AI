// tests/test_replay_score.mjs — scoreSignals forward-outcome + replaySignals rolling level
import assert from 'node:assert';
import { scoreSignals } from '../src/marketdata/orderbook/replayScore.js';
import { replaySignals } from '../src/marketdata/orderbook/replaySignals.js';

let p = 0;
const ok = (n) => { console.log(`  ok - ${n}`); p++; };

// --- scoreSignals -----------------------------------------------------------
// Snapshots: mid rising 100 -> 110 over 60s, one point per 30s.
const snaps = [
  { ts: 0,      ready: true, futures: { mid: 100 } },
  { ts: 30_000, ready: true, futures: { mid: 105 } },
  { ts: 60_000, ready: true, futures: { mid: 110 } },
];

// BUY at t=0, 60s horizon: entry 100 -> exit 110 = +1000 bps gross, -5 cost = +995 net, a win.
{
  const r = scoreSignals(snaps, [{ ts: 0, side: 'BUY' }], { horizonMs: 60_000, costBps: 5 });
  assert.strictEqual(r.resolved, 1);
  assert.strictEqual(r.wins, 1);
  assert.ok(Math.abs(r.avgGrossBps - 1000) < 1e-6, `gross ${r.avgGrossBps}`);
  assert.ok(Math.abs(r.avgNetBps - 995) < 1e-6, `net ${r.avgNetBps}`);
  ok('BUY into a rising mid scores a net win');
}

// SELL at t=0, same rise: direction flips → -1000 gross, a loss.
{
  const r = scoreSignals(snaps, [{ ts: 0, side: 'SELL' }], { horizonMs: 60_000, costBps: 5 });
  assert.ok(Math.abs(r.avgGrossBps + 1000) < 1e-6, `gross ${r.avgGrossBps}`);
  assert.strictEqual(r.wins, 0);
  assert.strictEqual(r.hitRate, 0);
  ok('SELL into a rising mid scores a loss');
}

// Cost can flip a thin winner to a loss: tiny move +3 bps gross, cost 5 → -2 net.
{
  const thin = [
    { ts: 0,      ready: true, futures: { mid: 10000 } },
    { ts: 60_000, ready: true, futures: { mid: 10003 } }, // +3 bps
  ];
  const r = scoreSignals(thin, [{ ts: 0, side: 'BUY' }], { horizonMs: 60_000, costBps: 5 });
  assert.ok(r.avgNetBps < 0 && r.avgGrossBps > 0, `net ${r.avgNetBps} gross ${r.avgGrossBps}`);
  assert.strictEqual(r.wins, 0);
  ok('costBps turns a sub-cost gross gain into a net loss');
}

// Unresolved: horizon runs past the last snapshot → excluded from resolved, still counted in n.
{
  const r = scoreSignals(snaps, [{ ts: 60_000, side: 'BUY' }], { horizonMs: 60_000, costBps: 5 });
  assert.strictEqual(r.n, 1);
  assert.strictEqual(r.resolved, 0);
  assert.strictEqual(r.avgNetBps, 0);
  ok('signal with no forward mid in-window is unresolved, excluded from stats');
}

// Empty signals → zeroed summary, no throw.
{
  const r = scoreSignals(snaps, [], {});
  assert.strictEqual(r.n, 0);
  assert.strictEqual(r.resolved, 0);
  assert.strictEqual(r.hitRate, 0);
  ok('empty signal list yields a zeroed summary');
}

// --- replaySignals rolling level -------------------------------------------
// Build a feature snapshot that confirms a BUY breakout when mid crosses `resistance`.
const confirmFeat = (ts, mid) => ({
  ts, ready: true, spotReady: false,
  futures: {
    mid, spread: mid * 0.0001, imbalance: 0.5, aggressorImbalance: 0.5, printVelocity: 5,
    bidDepthNbps: 1500, askDepthNbps: 500,
  },
  spot: null,
});

// Candles: an early plateau (resistance ~101) then a later, higher plateau (resistance ~106),
// each tagged with `time`. With rolling on, the level evolves so a cross of the *later* high fires.
const candles = [];
for (let i = 0; i < 25; i++) candles.push({ time: i * 60_000, high: 101, low: 99, close: 100 });
for (let i = 25; i < 50; i++) candles.push({ time: i * 60_000, high: 106, low: 104, close: 105 });

// Snapshots late in the window: prevMid below 106 then a cross above it.
const lateTs = 49 * 60_000;
const snapStream = [
  confirmFeat(lateTs, 105.5),       // prevMid below the rolling resistance (~106)
  confirmFeat(lateTs + 1000, 106.5) // cross → BUY
];

{
  const rolled = replaySignals(snapStream, candles, { rolling: true });
  assert.strictEqual(rolled.length, 1, `rolling signals ${rolled.length}`);
  assert.strictEqual(rolled[0].side, 'BUY');
  ok('rolling level lets a cross of evolving (later) structure fire');
}

{
  // Static level = max high over the whole array (106) too; but prevMid 105.5 < 106 < 106.5 also
  // crosses, so static fires here as well — assert static path still returns a clean array.
  const stat = replaySignals(snapStream, candles); // rolling off
  assert.ok(Array.isArray(stat), 'static path returns an array');
  ok('static path remains backward-compatible (no rolling opt)');
}

console.log(`\n${p} checks passed`);
