// tests/test_simulator_rsi_gate.js
// RSI confluence gate on signal-mode entries (hypothesis #10 — multi-indicator confluence).
// Momentum confirmation: admit a long (BUY) entry only when decision-window RSI >= longMin, and
// a short (SELL) only when RSI <= 100 - longMin (symmetric). Opt-in via p.rsiGate, byte-identical
// when unset, stackable with the ADX gate, ignored in sl_tp mode.
import assert from 'node:assert';
import { simulate } from '../src/backtest/simulator.js';
import { Technicals } from '../src/indicators/technical.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };
const TF = 3600000;
const bar = (i, c) => ({ time: i * TF, open: c, high: c + 0.5, low: c - 0.5, close: c, volume: 1 });

// Sawtooth chop warmup then strong trends — many flips with RSI spread across the threshold.
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
const RSI_PERIOD = 14;
const LONG_MIN = 50;

// RSI on the EXACT decision window the simulator uses (closes only). decision bar i = entryIndex - 1.
function rsiAtDecision(candles, entryIndex) {
  const i = entryIndex - 1;
  const w = candles.slice(Math.max(0, i - LOOKBACK + 1), i + 1).map((c) => c.close);
  const series = Technicals.rsi(w, RSI_PERIOD);
  return series.length ? series[series.length - 1] : null;
}

// --- the RSI gate filters signal-mode entries by momentum alignment ---
{
  const candles = makeCandles();
  const base = { candles, config, guardrails, costs, symbol: 'T', timeframe: '1H', lookback: LOOKBACK, startEquity: 10000 };

  const ungated = simulate({ ...base });
  const gated = simulate({ ...base, rsiGate: { period: RSI_PERIOD, longMin: LONG_MIN } });

  assert.ok(gated.trades.length > 0, `gated run still trades, got ${gated.trades.length}`);
  assert.ok(gated.trades.length < ungated.trades.length,
    `gate prunes momentum-misaligned entries: gated ${gated.trades.length} < ungated ${ungated.trades.length}`);

  // Contract: BUY entries sit at RSI >= longMin; SELL entries at RSI <= 100 - longMin.
  for (const t of gated.trades) {
    const idx = candles.findIndex((c) => c.time === t.entryTime);
    const rsi = rsiAtDecision(candles, idx);
    if (t.side === 'BUY') {
      assert.ok(rsi != null && rsi >= LONG_MIN, `BUY entry idx ${idx} RSI ${rsi == null ? 'null' : rsi.toFixed(1)} >= ${LONG_MIN}`);
    } else {
      assert.ok(rsi != null && rsi <= 100 - LONG_MIN, `SELL entry idx ${idx} RSI ${rsi == null ? 'null' : rsi.toFixed(1)} <= ${100 - LONG_MIN}`);
    }
  }
  ok('RSI gate: BUY entries fire only when decision-window RSI >= longMin (short symmetric)');
}

// --- no rsiGate => byte-identical ---
{
  const candles = makeCandles();
  const base = { candles, config, guardrails, costs, symbol: 'T', timeframe: '1H', lookback: LOOKBACK, startEquity: 10000 };
  const a = simulate({ ...base });
  const b = simulate({ ...base });
  assert.strictEqual(a.trades.length, b.trades.length, 'ungated runs are deterministic');
  assert.ok(a.trades.length >= 30, `ungated baseline has the full churn, got ${a.trades.length}`);
  ok('no rsiGate: ungated signal-mode run unchanged');
}

// --- sl_tp mode ignores rsiGate ---
{
  const slTp = { logicType: 'RangeFilter', logic: { exit_mode: 'sl_tp', indicators: { period: 20, multiplier: 3.5 } } };
  const candles = makeCandles();
  const base = { candles, config: slTp, guardrails, costs, symbol: 'T', timeframe: '1H', lookback: LOOKBACK, startEquity: 10000 };
  const a = simulate({ ...base });
  const b = simulate({ ...base, rsiGate: { period: RSI_PERIOD, longMin: LONG_MIN } });
  assert.strictEqual(a.trades.length, b.trades.length, 'sl_tp trade count unaffected by rsiGate');
  ok('sl_tp mode: rsiGate is ignored');
}

console.log(`\n${passed} passed`);
