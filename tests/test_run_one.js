// tests/test_run_one.js
import assert from 'node:assert';
import { runOne } from '../backtest/run-backtest.js';
import { openBacktestDb } from '../src/backtest/backtestSchema.js';
import { BacktestRepo } from '../src/backtest/BacktestRepo.js';

// Synthetic zig-zag candles so a forced decider produces trades deterministically.
function candles(n) {
  const out = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    const base = 100 + (i % 2 === 0 ? 0 : 5);
    out.push({ time: t, open: base, high: base + 2, low: base - 2, close: base + (i % 2 === 0 ? 1 : -1), volume: 10 });
    t += 3600000;
  }
  return out;
}

// Forced decider matching the real simulate() contract: decide(ctx, account) where
// ctx = { candles: window, config, symbol, timeframe }, returning { decision }.
// The simulator only calls decide when flat, then fills order at the NEXT bar's open
// (entryPrice is ignored). Always-PERMIT a spot BUY -> deterministic trades.
function makeDecider() {
  return (ctx) => {
    const w = ctx.candles;
    const last = w[w.length - 1];
    return { decision: { decision: 'PERMIT', order: { side: 'BUY', sizeUSD: 100, slPrice: last.close * 0.98, tpPrice: last.close * 1.04 } } };
  };
}

const guardrails = {
  portfolioValue: 10000, riskPerTrade: 0.1, maxTradeSizeUSD: Infinity,
  stopLossPct: 0.02, takeProfitPct: 0.04, minRiskRewardRatio: 1.5,
  maxOpenPositions: 1, maxPortfolioHeatPct: 100, dailyLossLimitPct: 1,
  dailyProfitTargetPct: null, maxTradesPerDay: 999999, leverage: 1, mmr: null,
};
const costs = { takerFee: 0.0006, makerFee: 0.0002, slippageBps: 5, liqFeeRate: 0.0006 };

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

const db = await openBacktestDb(':memory:');
const repo = new BacktestRepo(db);
const cs = candles(60);
const lookback = 20;

// 1. runOne returns runId + metrics and persists a run + trades
{
  const { runId, metrics } = await runOne(repo, {
    label: 'unit', logicType: 'SMC', symbol: 'BTCUSDT', tf: '1H',
    lookback, leverage: 1, candles: cs, spec: null, realRows: [],
    guardrails, costs, fundingMode: 'real-mean', fundingRate: 0,
    group: 'm_unit', decide: makeDecider(),
  });
  assert.ok(runId > 0, 'runId assigned');
  assert.ok(metrics && metrics.trades, 'metrics returned');
  const row = await repo.getRun(runId);
  assert.strictEqual(row.run_group, 'm_unit', 'group tagged');
  assert.strictEqual(row.leverage, 1);
  ok('runOne persists run with group + returns metrics');
}

// 2. spot run records zero funding (parity: futures dormant at leverage 1)
{
  const { metrics } = await runOne(repo, {
    label: 'unit2', logicType: 'SMC', symbol: 'BTCUSDT', tf: '1H',
    lookback, leverage: 1, candles: cs, spec: null, realRows: [],
    guardrails, costs, fundingMode: 'real-mean', fundingRate: 0,
    group: null, decide: makeDecider(),
  });
  assert.strictEqual(metrics.costs.totalFunding, 0, 'spot funding is zero');
  ok('spot run has zero funding');
}

// 3. default decider path: omitting `decide` falls back to simulate's evaluateBar
//    (the path the single-run CLI uses) — must run and return well-formed metrics.
{
  const { runId, metrics } = await runOne(repo, {
    label: 'unit3', logicType: 'SMC', symbol: 'BTCUSDT', tf: '1H',
    lookback, leverage: 1, candles: cs, spec: null, realRows: [],
    guardrails, costs, fundingMode: 'real-mean', fundingRate: 0,
    group: null,
  });
  assert.ok(runId > 0, 'runId assigned (default decider)');
  assert.ok(metrics && metrics.trades && typeof metrics.trades.count === 'number', 'well-formed metrics from default path');
  ok('default evaluateBar path runs');
}

await db.close();
console.log(`\n${passed} checks passed`);
