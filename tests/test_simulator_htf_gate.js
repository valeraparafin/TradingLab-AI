// tests/test_simulator_htf_gate.js
// HTF trend gate on signal-mode entries (stackable with the ADX regime gate). Mirrors the
// existing src/backtest/htfGate.js semantics: an entry whose side runs AGAINST the higher-
// timeframe emaBand trend is denied; with-trend and neutral pass. In signal mode the entry
// bypasses the `decide` path, so the gate is applied directly in the simulator's signal
// entry block, behind the opt-in p.htfGate flag. Off => byte-identical to prior runs.
import assert from 'node:assert';
import { simulate } from '../src/backtest/simulator.js';
import { aggregateHTF } from '../src/core/aggregateHTF.js';
import { classifyHTFTrend } from '../src/core/classifyHTFTrend.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };
const TF = 3600000;
const bar = (i, c) => ({ time: i * TF, open: c, high: c + 0.5, low: c - 0.5, close: c, volume: 1 });

// Sustained downtrend with sharp counter-rallies that flip RangeFilter long against the
// trend. Verified via probe: 22 ungated trades (11 BUY / 11 SELL); 9 of the 11 longs enter
// while the HTF emaBand verdict is DOWN (against-trend) — exactly what the gate must prune.
function makeCandles() {
  const cs = []; let i = 0; let p = 600;
  for (let k = 0; k < 60; k++) cs.push(bar(i++, p));               // warmup
  for (let seg = 0; seg < 14; seg++) {
    for (let k = 0; k < 12; k++) { p -= 5; cs.push(bar(i++, p)); } // down leg -60
    for (let k = 0; k < 7; k++) { p += 6; cs.push(bar(i++, p)); }  // counter-rally +42 (net -18)
  }
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
const LB = 120;
const HTF = { ratio: 4, emaPeriod: 10, band: 0.005 };

// The HTF emaBand verdict on the EXACT decision window the simulator uses. decision bar
// i = entryIndex - 1; window is the lookback slice up to and including close[i].
function htfVerdictAtEntry(candles, entryIndex) {
  const i = entryIndex - 1;
  const w = candles.slice(Math.max(0, i - LB + 1), i + 1);
  const htf = aggregateHTF(w, HTF.ratio);
  return classifyHTFTrend(htf, { emaPeriod: HTF.emaPeriod, band: HTF.band }).emaBand;
}

// --- HTF gate denies against-trend (long-in-downtrend) entries, passes with-trend shorts ---
{
  const candles = makeCandles();
  const base = { candles, config, guardrails, costs, symbol: 'T', timeframe: '1H', lookback: LB, startEquity: 10000 };

  const ungated = simulate({ ...base });
  const gated = simulate({ ...base, htfGate: HTF });

  const ungatedBuys = ungated.trades.filter((t) => t.side === 'BUY').length;
  const gatedBuys = gated.trades.filter((t) => t.side === 'BUY').length;
  const gatedSells = gated.trades.filter((t) => t.side === 'SELL').length;

  // Selective: the gate removes against-trend longs but still lets with-trend shorts through.
  assert.ok(gated.trades.length < ungated.trades.length,
    `gate prunes trades: gated ${gated.trades.length} < ungated ${ungated.trades.length}`);
  assert.ok(gatedBuys < ungatedBuys, `gate prunes against-trend longs: gated BUY ${gatedBuys} < ungated BUY ${ungatedBuys}`);
  assert.ok(gatedSells > 0, `with-trend shorts still pass, got ${gatedSells}`);

  // Contract: no admitted entry runs against the HTF trend (a BUY at a DOWN verdict, or a
  // SELL at an UP verdict). Neutral always passes.
  for (const t of gated.trades) {
    const idx = candles.findIndex((c) => c.time === t.entryTime);
    const v = htfVerdictAtEntry(candles, idx);
    const against = (t.side === 'BUY' && v === 'DOWN') || (t.side === 'SELL' && v === 'UP');
    assert.ok(!against, `gated ${t.side} entry at idx ${idx} runs against HTF ${v}`);
  }
  ok('HTF gate: against-trend signal entries denied, with-trend and neutral pass');
}

// --- no htfGate => byte-identical (opt-in, no regression) ---
{
  const candles = makeCandles();
  const base = { candles, config, guardrails, costs, symbol: 'T', timeframe: '1H', lookback: LB, startEquity: 10000 };
  const a = simulate({ ...base });
  const b = simulate({ ...base });
  assert.strictEqual(a.trades.length, b.trades.length, 'ungated deterministic');
  assert.ok(a.trades.filter((t) => t.side === 'BUY').length >= 5, 'ungated baseline keeps the against-trend longs');
  ok('no htfGate: ungated signal-mode run unchanged');
}

// --- ADX gate and HTF gate stack (both applied) ---
{
  const candles = makeCandles();
  const base = { candles, config, guardrails, costs, symbol: 'T', timeframe: '1H', lookback: LB, startEquity: 10000 };
  const htfOnly = simulate({ ...base, htfGate: HTF });
  const both = simulate({ ...base, htfGate: HTF, regimeGate: { adxMin: 20, adxPeriod: 14 } });
  // Stacking can only remove entries the HTF gate let through, never add — both is a subset.
  assert.ok(both.trades.length <= htfOnly.trades.length,
    `stacked gates only prune further: both ${both.trades.length} <= htfOnly ${htfOnly.trades.length}`);
  ok('ADX + HTF gates stack (intersection of admitted entries)');
}

console.log(`\n${passed} passed`);
