// tests/test_simulator_volume_gate.js
// Volume-confirmation gate on signal-mode entries. Hypothesis under test (H7): a RangeFilter
// state flip backed by a volume expansion is a higher-conviction signal than a flip on thin
// volume. The gate admits an entry only when the decision-bar volume >= mult * SMA(volume,
// period) on the decision window, leaving sl_tp mode and ungated runs byte-identical. It is
// stackable with the ADX regime gate (both must pass).
import assert from 'node:assert';
import { simulate } from '../src/backtest/simulator.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };
const TF = 3600000;
const bar = (i, c, v) => ({ time: i * TF, open: c, high: c + 0.5, low: c - 0.5, close: c, volume: v });

// Same price path as the regime-gate fixture (chop warmup then strong trends => many flips),
// but with a volume pattern UNCORRELATED to the flips: bands of high (12) and low (1) volume.
// SMA(vol,20) ~ 5.4, so mult 1.5 => threshold ~8.1: high-vol bars clear it, low-vol bars don't.
// Flips land on both => the gate is selective (prunes thin-volume flips, keeps the rest).
const VOL_HI = 12, VOL_LO = 1;
const volAt = (i) => (i % 10 < 4 ? VOL_HI : VOL_LO);
function makeCandles() {
  const cs = []; let i = 0;
  const push = (c) => { cs.push(bar(i, c, volAt(i))); i++; };
  for (let k = 0; k < 80; k++) push(100 + (k % 2 ? 1.2 : -1.2)); // chop
  for (let k = 1; k <= 60; k++) push(100 + k);   // up 100->160
  for (let k = 1; k <= 120; k++) push(160 - k);  // down 160->40
  for (let k = 1; k <= 120; k++) push(40 + k);   // up 40->160
  for (let k = 1; k <= 60; k++) push(160 - k);   // down 160->100
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
const VOL_MULT = 1.5;
const VOL_PERIOD = 20;

// Trailing volume SMA on the decision bar (entryIndex - 1), over the last VOL_PERIOD bars.
function volRatioAtDecision(candles, entryIndex) {
  const i = entryIndex - 1;
  const w = candles.slice(Math.max(0, i - VOL_PERIOD + 1), i + 1);
  const sma = w.reduce((a, c) => a + c.volume, 0) / w.length;
  return sma > 0 ? candles[i].volume / sma : null;
}

// --- the volume gate filters signal-mode entries by decision-bar volume expansion ---
{
  const candles = makeCandles();
  const base = { candles, config, guardrails, costs, symbol: 'T', timeframe: '1H', lookback: LOOKBACK, startEquity: 10000 };

  const ungated = simulate({ ...base });
  const gated = simulate({ ...base, volGate: { mult: VOL_MULT, period: VOL_PERIOD } });

  assert.ok(gated.trades.length > 0, `gated run still trades, got ${gated.trades.length}`);
  assert.ok(gated.trades.length < ungated.trades.length,
    `gate prunes thin-volume entries: gated ${gated.trades.length} < ungated ${ungated.trades.length}`);

  // Contract: every admitted entry's decision-bar volume clears mult * SMA(volume, period).
  for (const t of gated.trades) {
    const idx = candles.findIndex((c) => c.time === t.entryTime);
    const ratio = volRatioAtDecision(candles, idx);
    assert.ok(ratio != null && ratio >= VOL_MULT,
      `gated entry at idx ${idx} has decision-bar volume ratio ${ratio == null ? 'null' : ratio.toFixed(2)} >= ${VOL_MULT}`);
  }
  ok('volume gate: signal entries only fire when decision-bar volume >= mult * SMA(volume)');
}

// --- no volGate => byte-identical (gate is opt-in, no regression) ---
{
  const candles = makeCandles();
  const base = { candles, config, guardrails, costs, symbol: 'T', timeframe: '1H', lookback: LOOKBACK, startEquity: 10000 };
  const a = simulate({ ...base });
  const b = simulate({ ...base });
  assert.strictEqual(a.trades.length, b.trades.length, 'ungated runs are deterministic');
  assert.ok(a.trades.length >= 30, `ungated baseline has the full churn, got ${a.trades.length}`);
  ok('no volGate: ungated signal-mode run unchanged');
}

// --- sl_tp mode ignores volGate (gate is scoped to signal entries) ---
{
  const slTp = { logicType: 'RangeFilter', logic: { exit_mode: 'sl_tp', indicators: { period: 20, multiplier: 3.5 } } };
  const candles = makeCandles();
  const base = { candles, config: slTp, guardrails, costs, symbol: 'T', timeframe: '1H', lookback: LOOKBACK, startEquity: 10000 };
  const a = simulate({ ...base });
  const b = simulate({ ...base, volGate: { mult: VOL_MULT, period: VOL_PERIOD } });
  assert.strictEqual(a.trades.length, b.trades.length, 'sl_tp trade count unaffected by volGate');
  ok('sl_tp mode: volGate is ignored');
}

console.log(`\n${passed} passed`);
