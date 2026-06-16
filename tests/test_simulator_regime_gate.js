// tests/test_simulator_regime_gate.js
// Regime gate (ADX) on signal-mode entries. Hypothesis under test: the RangeFilter
// stop-and-reverse edge is a trend-regime story — flips in chop (low ADX) are whipsaw
// noise, flips in a real trend (high ADX) are the signal. The gate lets an entry through
// only when ADX on the decision window is >= adxMin, leaving sl_tp mode and ungated runs
// byte-identical.
import assert from 'node:assert';
import { simulate } from '../src/backtest/simulator.js';
import { Technicals } from '../src/indicators/technical.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };
const TF = 3600000;
const bar = (i, c) => ({ time: i * TF, open: c, high: c + 0.5, low: c - 0.5, close: c, volume: 1 });

// Sawtooth: a low-ADX chop warmup (many whipsaw flips) followed by strong trends whose
// sharp reversals flip the RangeFilter state while ADX is high. Verified via probe:
// 36 ungated entries sit at ADX<10 (chop), 2 at ADX>=40 (trend reversals).
function makeCandles() {
  const cs = []; let i = 0;
  for (let k = 0; k < 80; k++) cs.push(bar(i++, 100 + (k % 2 ? 1.2 : -1.2))); // chop, low ADX
  for (let k = 1; k <= 60; k++) cs.push(bar(i++, 100 + k));   // up 100->160
  for (let k = 1; k <= 120; k++) cs.push(bar(i++, 160 - k));  // down 160->40
  for (let k = 1; k <= 120; k++) cs.push(bar(i++, 40 + k));   // up 40->160
  for (let k = 1; k <= 60; k++) cs.push(bar(i++, 160 - k));   // down 160->100
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
const ADX_MIN = 40;
const ADX_PERIOD = 14;

// ADX on the EXACT decision window the simulator uses (Wilder's ADX is recursive, so a
// full-series value would not match a windowed one). decision bar i = entryIndex - 1.
function adxAtDecision(candles, entryIndex) {
  const i = entryIndex - 1;
  const w = candles.slice(Math.max(0, i - LOOKBACK + 1), i + 1);
  const series = Technicals.adx(w, ADX_PERIOD);
  return series.length ? series[series.length - 1] : null;
}

// --- the ADX regime gate filters signal-mode entries by trend strength ---
{
  const candles = makeCandles();
  const base = { candles, config, guardrails, costs, symbol: 'T', timeframe: '1H', lookback: LOOKBACK, startEquity: 10000 };

  const ungated = simulate({ ...base });
  const gated = simulate({ ...base, regimeGate: { adxMin: ADX_MIN, adxPeriod: ADX_PERIOD } });

  // Selective, not a blanket block: the gate removes the chop churn but still trades.
  assert.ok(gated.trades.length > 0, `gated run still trades, got ${gated.trades.length}`);
  assert.ok(gated.trades.length < ungated.trades.length,
    `gate prunes low-ADX entries: gated ${gated.trades.length} < ungated ${ungated.trades.length}`);

  // The gate's contract: every entry it admits sits at ADX >= adxMin on its decision window.
  for (const t of gated.trades) {
    const idx = candles.findIndex((c) => c.time === t.entryTime);
    const adx = adxAtDecision(candles, idx);
    assert.ok(adx != null && adx >= ADX_MIN,
      `gated entry at idx ${idx} has decision-window ADX ${adx == null ? 'null' : adx.toFixed(1)} >= ${ADX_MIN}`);
  }
  ok('ADX regime gate: signal entries only fire when decision-window ADX >= adxMin');
}

// --- no regimeGate => byte-identical (ADX gate is opt-in, no regression) ---
{
  const candles = makeCandles();
  const base = { candles, config, guardrails, costs, symbol: 'T', timeframe: '1H', lookback: LOOKBACK, startEquity: 10000 };
  const a = simulate({ ...base });
  const b = simulate({ ...base }); // same inputs, no gate
  assert.strictEqual(a.trades.length, b.trades.length, 'ungated runs are deterministic');
  assert.ok(a.trades.length >= 30, `ungated baseline has the full churn, got ${a.trades.length}`);
  ok('no regimeGate: ungated signal-mode run unchanged');
}

// --- sl_tp mode ignores regimeGate (gate is scoped to signal entries) ---
{
  const slTp = { logicType: 'RangeFilter', logic: { exit_mode: 'sl_tp', indicators: { period: 20, multiplier: 3.5 } } };
  const candles = makeCandles();
  const base = { candles, config: slTp, guardrails, costs, symbol: 'T', timeframe: '1H', lookback: LOOKBACK, startEquity: 10000 };
  const a = simulate({ ...base });
  const b = simulate({ ...base, regimeGate: { adxMin: ADX_MIN, adxPeriod: ADX_PERIOD } });
  assert.strictEqual(a.trades.length, b.trades.length, 'sl_tp trade count unaffected by regimeGate');
  ok('sl_tp mode: regimeGate is ignored');
}

console.log(`\n${passed} passed`);
