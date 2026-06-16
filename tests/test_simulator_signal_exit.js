// tests/test_simulator_signal_exit.js
// Signal-driven exit (stop-and-reverse) path in the backtest simulator.
// Mirrors the live engine: exit_mode==='signal' closes an open position when the
// RangeFilter persistent state flips against it, ignores take-profit, keeps the
// stop-loss as a protective floor, and re-enters on the current state.
import assert from 'node:assert';
import { simulate } from '../src/backtest/simulator.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };
const TF = 3600000;
const bar = (i, c) => ({ time: i * TF, open: c, high: c + 0.5, low: c - 0.5, close: c, volume: 1 });

// Candle script that drives RangeFilter through long → short → long (verified via the
// windowed indicator: state flips at i=60 (long), i=105 (short), i=146 (long)).
function makeCandles() {
  const candles = [];
  let i = 0;
  for (let k = 0; k < 60; k++) candles.push(bar(i++, 100));      // flat warmup
  for (let k = 1; k <= 40; k++) candles.push(bar(i++, 100 + k)); // rising to 140
  for (let k = 1; k <= 40; k++) candles.push(bar(i++, 140 - k)); // falling to 100
  for (let k = 1; k <= 40; k++) candles.push(bar(i++, 100 + k)); // rising to 140 again
  return candles;
}

// Wide SL (50%) so the protective floor never triggers — isolates the signal-flip exit.
// minRiskRewardRatio mirrors the CLI default (1.5): signal mode has no fixed TP, so the
// RR gate must NOT block entries (regression guard — a null TP must disable the gate).
const guardrails = {
  portfolioValue: 10000, riskPerTrade: 0.1, sizingMode: 'fixed',
  stopLossPct: 0.5, takeProfitPct: 0.04, minRiskRewardRatio: 1.5,
  maxOpenPositions: 1, maxTradesPerDay: 999999, dailyLossLimitPct: 1,
  maxPortfolioHeatPct: 100, leverage: 1,
};
const costs = { takerFee: 0, makerFee: 0, slippageBps: 0 };
const config = {
  logicType: 'RangeFilter',
  logic: { exit_mode: 'signal', indicators: { period: 20, multiplier: 3.5 } },
};

// --- stop-and-reverse: long opens, closes on flip, reverses short, then back to long ---
{
  const res = simulate({
    candles: makeCandles(), config, guardrails, costs,
    symbol: 'TEST', timeframe: '1H', lookback: 50, startEquity: 10000,
  });

  // No fixed take-profit exits in signal mode.
  assert.ok(res.trades.every((t) => t.reason !== 'TP'), 'no TP exits in signal mode');

  // The closed trades are signal flips, alternating side (stop-and-reverse).
  const flips = res.trades.filter((t) => t.reason === 'SIGNAL_FLIP');
  assert.ok(flips.length >= 2, `at least two signal-flip exits, got ${flips.length}`);
  assert.strictEqual(flips[0].side, 'BUY', 'first closed leg is the initial long');
  assert.strictEqual(flips[1].side, 'SELL', 'second closed leg is the reversed short');
  ok('signal mode: long → flip-exit → reverse short → flip-exit (stop-and-reverse)');
}

// --- protective stop-loss still fires in signal mode (uniform floor) ---
{
  // Long entry then a hard crash below a tight SL — the protective floor must close it,
  // not the signal flip.
  const candles = [];
  let i = 0;
  for (let k = 0; k < 60; k++) candles.push(bar(i++, 100));
  for (let k = 1; k <= 20; k++) candles.push(bar(i++, 100 + k)); // rising → long state
  // sharp gap-down crash on the next bars (low pierces a 5% SL well before any state flip)
  for (let k = 0; k < 10; k++) candles.push(bar(i++, 80));
  const tightSL = { ...guardrails, stopLossPct: 0.05 };
  const res = simulate({
    candles, config, guardrails: tightSL, costs,
    symbol: 'TEST', timeframe: '1H', lookback: 50, startEquity: 10000,
  });
  assert.ok(res.trades.some((t) => t.reason === 'SL' || t.reason === 'SL_GAP'),
    'protective stop-loss closes the long on the crash');
  ok('signal mode: stop-loss remains a protective floor');
}

// --- sl_tp mode is unaffected: no SIGNAL_FLIP exits ---
{
  const slTpConfig = { logicType: 'RangeFilter', logic: { exit_mode: 'sl_tp', indicators: { period: 20, multiplier: 3.5 } } };
  const res = simulate({
    candles: makeCandles(), config: slTpConfig, guardrails, costs,
    symbol: 'TEST', timeframe: '1H', lookback: 50, startEquity: 10000,
  });
  assert.ok(res.trades.every((t) => t.reason !== 'SIGNAL_FLIP'), 'sl_tp mode never emits SIGNAL_FLIP');
  ok('sl_tp mode: no signal-flip exits');
}

console.log(`\n${passed} passed`);
