import assert from 'assert';
import { simulate } from '../src/backtest/simulator.js';
import { computeMetrics } from '../src/backtest/metrics.js';

// Deterministic synthetic series: a rising leg then a falling leg. pivot_length is set
// LOW (2) so the REAL SMC indicator forms pivots and emits PERMIT decisions on this
// series — exercising the real decision.order → entry → fill → exit → trade-record seam
// end-to-end. We assert the pipeline RUNS, books at least one trade, is byte-for-byte
// deterministic, and produces well-formed metrics — but NOT a specific trade count
// (the exact numbers are the Task 8 manual-smoke's qualitative check on real data).
const TF = 3600000;
function synth() {
  const out = [];
  let price = 100;
  for (let i = 0; i < 400; i++) {
    // up for 200 bars, down for 200 bars, with small deterministic wiggle
    const drift = i < 200 ? 0.4 : -0.4;
    const wiggle = ((i * 7919) % 13 - 6) / 10; // deterministic pseudo-noise in [-0.6,0.6]
    const open = price;
    const close = price + drift + wiggle;
    const high = Math.max(open, close) + 0.8;
    const low = Math.min(open, close) - 0.8;
    out.push({ time: i * TF, open, high, low, close, volume: 100 });
    price = close;
  }
  return out;
}

const run = () => {
  const candles = synth();
  const params = {
    candles,
    config: { logicType: 'SMC', logic: { indicators: { pivot_length: 2 } } },
    guardrails: { portfolioValue: 10000, riskPerTrade: 0.1, maxTradeSizeUSD: Infinity, stopLossPct: 0.02, takeProfitPct: 0.04, minRiskRewardRatio: 1.5, maxOpenPositions: 1, maxPortfolioHeatPct: 100, dailyLossLimitPct: 1, dailyProfitTargetPct: null, maxTradesPerDay: 999999 },
    costs: { takerFee: 0.0006, makerFee: 0.0002, slippageBps: 5 },
    symbol: 'BTCUSDT', timeframe: '1H', lookback: 100, startEquity: 10000,
  };

  // 1) Runs end-to-end through the REAL evaluateBar (default decide) without throwing.
  const a = simulate(params);
  assert.ok(Array.isArray(a.trades), 'trades is an array');
  assert.strictEqual(a.equityCurve.length, candles.length - 100, 'one equity point per iterated bar');
  assert.ok(Number.isFinite(a.finalEquity), 'finalEquity finite');
  assert.ok(a.trades.length >= 1, `real pipeline must book >=1 trade — 0 means the PERMIT->fill seam is unexercised (got ${a.trades.length})`);

  // 2) Deterministic: a second identical run yields identical output.
  const b = simulate(params);
  assert.deepStrictEqual(a, b, 'real-pipeline run is deterministic');

  // 3) Metrics are well-formed.
  const m = computeMetrics({ trades: a.trades, equityCurve: a.equityCurve, startEquity: 10000, slippageCost: a.slippageCost, timeframe: '1H' });
  assert.ok(Number.isFinite(m.return.netPnl), 'netPnl finite');
  assert.ok(m.risk.maxDrawdownPct >= 0, 'maxDD non-negative');
  assert.strictEqual(m.costs.totalFunding, 0, 'spot: no funding');
  assert.strictEqual(m.trades.count, a.trades.length, 'metrics trade count matches');

  console.log(`✅ backtest integration tests passed (real pipeline produced ${a.trades.length} trades, finalEquity ${a.finalEquity.toFixed(2)})`);
};

try { run(); } catch (e) { console.error('❌', e); process.exit(1); }
