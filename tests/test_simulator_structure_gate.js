// tests/test_simulator_structure_gate.js
// Structural (SMC pivot) gate on signal-mode entries (Phase 2 — orthogonal-axis confluence).
// Chart observation: SELL signals fire right into support (about to bounce) and BUY into resistance.
// This gate denies an entry whose direction runs INTO a nearby structural level: a SELL too close
// to the nearest pivot-low below price, a BUY too close to the nearest pivot-high above price.
// Levels come from SMC.findPivots on the SAME decision window the indicator state used (no
// look-ahead). Opt-in via p.structureGate { minDistPct, pivotLength }, byte-identical when unset,
// stackable with the ADX gate, ignored in sl_tp mode.
import assert from 'node:assert';
import { simulate } from '../src/backtest/simulator.js';
import { findPivots } from '../src/indicators/pivots.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };
const TF = 3600000;
const bar = (i, c) => ({ time: i * TF, open: c, high: c + 0.5, low: c - 0.5, close: c, volume: 1 });

// Sawtooth chop warmup then strong trends — flips occur near recently-printed pivots so some
// entries sit close to a structural level (the gate should prune those).
function makeCandles() {
  const cs = []; let i = 0;
  for (let k = 0; k < 80; k++) cs.push(bar(i++, 100 + (k % 2 ? 1.2 : -1.2)));
  for (let k = 1; k <= 60; k++) cs.push(bar(i++, 100 + k));
  for (let k = 1; k <= 120; k++) cs.push(bar(i++, 160 - k));
  for (let k = 1; k <= 120; k++) cs.push(bar(i++, 40 + k));
  for (let k = 1; k <= 60; k++) cs.push(bar(i++, 160 - k));
  return cs;
}

const guardrails = {
  portfolioValue: 10000, riskPerTrade: 0.1, sizingMode: 'fixed',
  stopLossPct: 0.5, takeProfitPct: 0.04, minRiskRewardRatio: 1.5,
  maxOpenPositions: 1, maxTradesPerDay: 999999, dailyLossLimitPct: 1,
  maxPortfolioHeatPct: 100, leverage: 1,
};
const costs = { takerFee: 0, makerFee: 0, slippageBps: 0 };
const config = { logicType: 'RangeFilter', logic: { exit_mode: 'signal', indicators: { period: 20, multiplier: 3.5 } } };
const LOOKBACK = 50;
const PIVOT_LEN = 5;
const MIN_DIST = 0.02; // 2%

// Distance from the decision-bar close to the level the trade is heading INTO, on the EXACT
// decision window the simulator uses. decision bar i = entryIndex - 1. Returns null if no
// relevant level exists (a SELL with no pivot-low below, a BUY with no pivot-high above).
function distToLevel(candles, entryIndex, side) {
  const i = entryIndex - 1;
  const w = candles.slice(Math.max(0, i - LOOKBACK + 1), i + 1);
  const price = w[w.length - 1].close;
  const piv = findPivots(w, PIVOT_LEN);
  if (side === 'SELL') {
    const lows = piv.low.map((p) => p.price).filter((pr) => pr < price);
    if (!lows.length) return null;
    return (price - Math.max(...lows)) / price; // nearest support below
  }
  const highs = piv.high.map((p) => p.price).filter((pr) => pr > price);
  if (!highs.length) return null;
  return (Math.min(...highs) - price) / price; // nearest resistance above
}

// --- the structure gate prunes entries firing into a nearby level ---
{
  const candles = makeCandles();
  const base = { candles, config, guardrails, costs, symbol: 'T', timeframe: '1H', lookback: LOOKBACK, startEquity: 10000 };

  const ungated = simulate({ ...base });
  const gated = simulate({ ...base, structureGate: { minDistPct: MIN_DIST, pivotLength: PIVOT_LEN } });

  assert.ok(gated.trades.length > 0, `gated run still trades, got ${gated.trades.length}`);
  assert.ok(gated.trades.length < ungated.trades.length,
    `gate prunes entries near a level: gated ${gated.trades.length} < ungated ${ungated.trades.length}`);

  // Contract: every admitted entry has >= minDistPct room to the level it heads into
  // (or no such level exists at all).
  for (const t of gated.trades) {
    const idx = candles.findIndex((c) => c.time === t.entryTime);
    const d = distToLevel(candles, idx, t.side);
    assert.ok(d == null || d >= MIN_DIST,
      `${t.side} entry idx ${idx} dist ${d == null ? 'null' : d.toFixed(4)} >= ${MIN_DIST}`);
  }
  ok('structure gate: admits only entries with room to the level they head into');
}

// --- no structureGate => byte-identical ---
{
  const candles = makeCandles();
  const base = { candles, config, guardrails, costs, symbol: 'T', timeframe: '1H', lookback: LOOKBACK, startEquity: 10000 };
  const a = simulate({ ...base });
  const b = simulate({ ...base });
  assert.strictEqual(a.trades.length, b.trades.length, 'ungated runs are deterministic');
  assert.ok(a.trades.length >= 30, `ungated baseline has the full churn, got ${a.trades.length}`);
  ok('no structureGate: ungated signal-mode run unchanged');
}

// --- sl_tp mode ignores structureGate ---
{
  const slTp = { logicType: 'RangeFilter', logic: { exit_mode: 'sl_tp', indicators: { period: 20, multiplier: 3.5 } } };
  const candles = makeCandles();
  const base = { candles, config: slTp, guardrails, costs, symbol: 'T', timeframe: '1H', lookback: LOOKBACK, startEquity: 10000 };
  const a = simulate({ ...base });
  const b = simulate({ ...base, structureGate: { minDistPct: MIN_DIST, pivotLength: PIVOT_LEN } });
  assert.strictEqual(a.trades.length, b.trades.length, 'sl_tp trade count unaffected by structureGate');
  ok('sl_tp mode: structureGate is ignored');
}

console.log(`\n${passed} passed`);
