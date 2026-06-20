// tests/test_lot_sizing.js
// Lot quantization for the position sizer. MOEX equities trade in LOTS (e.g. MSNG lot=1000,
// BSPB lot=10), and within a lot you cannot hold a fractional quantity — the executable size is
// floor(notional / lotValue) lots. quantizeToLot turns a notional target into the realisable
// notional, or signals a skip when the target can't fund even one lot.
// Default (no lotSize) is byte-identical to the current fractional sizing, so existing crypto
// backtests are unaffected; the MOEX harness opts in per symbol.
import assert from 'node:assert';
import { quantizeToLot } from '../src/backtest/execution.js';
import { simulate } from '../src/backtest/simulator.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

// --- no lotSize => unchanged (byte-identical default) ---
{
  for (const ls of [undefined, null, 0]) {
    const r = quantizeToLot(10000, 285, ls);
    assert.strictEqual(r.sizeUSD, 10000, `lotSize ${ls} leaves notional untouched`);
    assert.strictEqual(r.skip, false, `lotSize ${ls} never skips`);
  }
  ok('no lotSize: notional passes through unchanged');
}

// --- rounds the notional DOWN to a whole number of lots ---
{
  // BSPB-like: price 285, lot 10 => lotValue 2850. 10000/2850 = 3.5 => 3 lots = 30 shares = 8550.
  const r = quantizeToLot(10000, 285, 10);
  assert.strictEqual(r.skip, false, 'fits at least one lot');
  assert.ok(Math.abs(r.sizeUSD - 8550) < 1e-9, `rounds down to 3 lots (8550), got ${r.sizeUSD}`);
  ok('rounds notional down to a whole-lot multiple');
}

// --- notional below one lot => skip the trade ---
{
  // price 285, lot 10 => lotValue 2850; a 1000 notional cannot fund a single lot.
  const r = quantizeToLot(1000, 285, 10);
  assert.strictEqual(r.skip, true, 'sub-one-lot notional is skipped');
  assert.strictEqual(r.sizeUSD, 0, 'skipped size is zero');
  ok('notional below one lot: trade skipped');
}

// --- lotSize 1 quantizes to whole shares ---
{
  // price 285, lot 1 => 1000/285 = 3.5 => 3 shares = 855.
  const r = quantizeToLot(1000, 285, 1);
  assert.strictEqual(r.skip, false, 'three whole shares fit');
  assert.ok(Math.abs(r.sizeUSD - 855) < 1e-9, `3 shares = 855, got ${r.sizeUSD}`);
  ok('lotSize 1: quantizes to whole shares');
}

// --- simulate(): every opened trade has a whole-lot quantity when lotSize is set ---
{
  const TF = 3600000;
  const bar = (i, c) => ({ time: i * TF, open: c, high: c + 0.5, low: c - 0.5, close: c, volume: 1 });
  const cs = []; let i = 0;
  for (let k = 0; k < 80; k++) cs.push(bar(i++, 100 + (k % 2 ? 1.2 : -1.2)));
  for (let k = 1; k <= 60; k++) cs.push(bar(i++, 100 + k));
  for (let k = 1; k <= 120; k++) cs.push(bar(i++, 160 - k));
  for (let k = 1; k <= 80; k++) cs.push(bar(i++, 40 + k));

  const guardrails = {
    portfolioValue: 1_000_000, riskPerTrade: 0.1, sizingMode: 'fixed',
    stopLossPct: 0.05, takeProfitPct: 0.1, minRiskRewardRatio: 1.5,
    maxOpenPositions: 1, maxTradesPerDay: 999999, dailyLossLimitPct: 1,
    maxPortfolioHeatPct: 100, leverage: 1,
  };
  const costs = { takerFee: 0, makerFee: 0, slippageBps: 0 };
  const config = { logicType: 'RangeFilter', logic: { exit_mode: 'sl_tp', indicators: { period: 20, multiplier: 3.5 } } };
  const base = { candles: cs, config, guardrails, costs, symbol: 'T', timeframe: '1H', lookback: 50, startEquity: 1_000_000 };

  const LOT = 10;
  const r = simulate({ ...base, lotSize: LOT });
  assert.ok(r.trades.length > 0, `lot-sized run still trades, got ${r.trades.length}`);
  for (const t of r.trades) {
    const qty = t.sizeUSD / t.entryPrice;
    const rem = qty / LOT - Math.round(qty / LOT);
    assert.ok(Math.abs(rem) < 1e-6, `qty ${qty} is a multiple of lot ${LOT} (rem ${rem})`);
  }
  ok('simulate: opened trades carry whole-lot quantities under lotSize');

  // and lotSize unset stays fractional (control: not every trade is a lot multiple)
  const ctrl = simulate({ ...base });
  assert.strictEqual(ctrl.trades.length > 0, true, 'control run trades');
  ok('simulate: control run (no lotSize) executes');
}

console.log(`\n${passed} passed`);
