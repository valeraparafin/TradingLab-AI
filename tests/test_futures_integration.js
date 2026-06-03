import assert from 'node:assert';
import { simulate } from '../src/backtest/simulator.js';

const TF = 3600000, H8 = 8 * 3600000;

// Deterministic synthetic series: zigzag uptrend (3 bars up / 1 bar dip per 4-bar cycle)
// creates SMC pivot lows that the crash can break, then a sharp floored crash at bar 200.
// The floor at 20 keeps prices positive throughout.
const candles = Array.from({ length: 300 }, (_, i) => {
  let base;
  if (i < 200) {
    // Zigzag: cycle 0/1/2 rise, cycle 3 dips back — net uptrend with clear pivot lows for SMC.
    const cycle = i % 4;
    const era = Math.floor(i / 4);
    base = cycle < 3 ? 100 + era * 0.8 + cycle * 0.3 : 100 + era * 0.8 + 0.3;
  } else {
    base = Math.max(20, 140 - (i - 200) * 2); // rises 100→~140, then crashes to 20 floor
  }
  return { time: i * TF, open: base, high: base * 1.002, low: base * 0.998, close: base };
});

const config = { logicType: 'SMC', logic: { indicators: { pivot_length: 2 } } };
const guardrails = {
  portfolioValue: 10000, riskPerTrade: 0.2, maxTradeSizeUSD: Infinity,
  stopLossPct: 0.05, takeProfitPct: 0.10, minRiskRewardRatio: 1.5,
  maxOpenPositions: 1, maxPortfolioHeatPct: 100, dailyLossLimitPct: 1,
  dailyProfitTargetPct: null, maxTradesPerDay: 999999,
  leverage: 10, mmr: 0.005,
};
const costs = { takerFee: 0.0006, makerFee: 0.0002, slippageBps: 5, liqFeeRate: 0.0006 };
const funding = { rateAt: () => 0.0001, intervalMs: H8 };
const params = { candles, config, guardrails, costs, symbol: 'BTCUSDT', timeframe: '1H', lookback: 100, funding };

// Runs the REAL pipeline (default decide = evaluateBar).
const a = simulate(params);
const b = simulate(params);

assert.ok(Array.isArray(a.trades), 'trades is an array');
assert.strictEqual(a.equityCurve.length, candles.length - 100, 'equity curve covers post-warmup bars');
assert.ok(Number.isFinite(a.finalEquity), 'finalEquity finite');
assert.ok(a.trades.length >= 1, 'real pipeline booked at least one futures trade (PERMIT->fill seam)');
assert.ok(a.totalFunding !== 0, 'funding accrued on held positions');
assert.deepStrictEqual(a, b, 'futures run is deterministic');

// SMC on this series fires SELL signals during the crash (bearish BOS), not BUY near the top,
// so real-pipeline longs never enter → liquidationCount === 0 for the real-pipeline run.
// Per spec: do NOT weaken — instead add a deterministic forced-decider sub-case that proves
// simulate() can liquidate a leveraged long via the crash.
const forcedLong = () => ({ signal: { side: 'BUY', conviction: 1 }, decision: { decision: 'PERMIT', order: { side: 'BUY', sizeUSD: 2000, slPrice: null, tpPrice: null } } });
const forced = simulate(params, forcedLong);
assert.ok(forced.liquidationCount >= 1, 'forced 10x long is liquidated by the crash');
const liqTrade = forced.trades.find(t => t.reason === 'LIQUIDATION' || t.reason === 'LIQ_GAP');
assert.ok(liqTrade && liqTrade.pnl < 0, 'liquidated trade has a capped negative pnl');

// Parity: same inputs at leverage=1, no funding → spot path, no funding/liq leakage.
const spot = simulate({ ...params, guardrails: { ...guardrails, leverage: 1, mmr: undefined }, funding: null });
assert.strictEqual(spot.totalFunding, 0, 'spot totalFunding 0');
assert.strictEqual(spot.liquidationCount, 0, 'spot has no liquidations');
assert.ok(spot.trades.every(t => t.funding === 0), 'spot trades funding 0');

console.log(`test_futures_integration.js OK — trades=${a.trades.length}, liq=${a.liquidationCount} (forced liq=${forced.liquidationCount}), funding=${a.totalFunding.toFixed(2)}, finalEquity=${a.finalEquity.toFixed(2)}`);
