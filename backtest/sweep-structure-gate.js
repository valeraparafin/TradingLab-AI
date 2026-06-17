// backtest/sweep-structure-gate.js
// Research harness (not production): tests Phase 2 — does an SMC structural (pivot) gate add edge
// ON TOP OF the established ADX regime gate? Chart obs: SELL fires into support / BUY into
// resistance. The gate denies an entry within minDistPct of the level it heads into (nearest
// pivot-low below for a SELL, pivot-high above for a BUY). Holds ADX fixed, sweeps minDistPct, and
// reports a temporal train/test split per level. minDist 0 = the ADX-only baseline. We watch two
// things: (1) does a minDist that lifts train PF also lift test PF? (2) does it cut trade count
// (turnover) — which the slippage stress (Phase 1b) showed is the real killer on volatile names.
// Usage: node backtest/sweep-structure-gate.js --tf 1H --mult 6 --adx 30 --sl 0.12 --pivot 20 --dists 0,0.005,0.01,0.02,0.03
import path from 'path';
import { openMarketDb } from '../src/data/marketDataSchema.js';
import { MarketDataRepo } from '../src/data/MarketDataRepo.js';
import { simulate } from '../src/backtest/simulator.js';
import { computeMetrics } from '../src/backtest/metrics.js';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const tf = arg('tf', '1H');
const mult = Number(arg('mult', '6'));
const period = Number(arg('period', '20'));
const sl = Number(arg('sl', '0.12'));
const lookback = Number(arg('lookback', '250'));
const split = Number(arg('split', '0.6'));
const adxMin = Number(arg('adx', '30'));
const pivotLength = Number(arg('pivot', '20'));
const dists = String(arg('dists', '0,0.005,0.01,0.02,0.03')).split(',').map(Number);
const symbolsArg = arg('symbols', null);

const guardrails = {
  portfolioValue: 200, riskPerTrade: 0.1, sizingMode: 'fixed',
  stopLossPct: sl, takeProfitPct: 0.04, minRiskRewardRatio: 1.5,
  maxOpenPositions: 1, maxTradesPerDay: 999999, dailyLossLimitPct: 1,
  maxPortfolioHeatPct: 100, leverage: 1,
};
const costs = { takerFee: 0.0006, makerFee: 0.0002, slippageBps: 5 };
const config = { logicType: 'RangeFilter', logic: { exit_mode: 'signal', indicators: { period, multiplier: mult } } };
const regimeGate = adxMin > 0 ? { adxMin, adxPeriod: 14 } : undefined;

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function runSegment(segments, minDistPct) {
  const structureGate = minDistPct > 0 ? { minDistPct, pivotLength } : undefined;
  const nets = [], pfs = []; let totalTrades = 0, positive = 0, used = 0;
  for (const candles of segments) {
    if (candles.length < lookback + 2) continue;
    const sim = simulate({ candles, config, guardrails, costs, symbol: 'X', timeframe: tf, lookback, startEquity: guardrails.portfolioValue, regimeGate, structureGate });
    if (sim.trades.length === 0) continue;
    const m = computeMetrics({ trades: sim.trades, equityCurve: sim.equityCurve, startEquity: guardrails.portfolioValue, slippageCost: sim.slippageCost, timeframe: tf, totalFunding: sim.totalFunding, liquidationCount: sim.liquidationCount });
    used++;
    nets.push(m.return.netPnlPct * 100);
    pfs.push(isFinite(m.trades.profitFactor) ? m.trades.profitFactor : 3);
    totalTrades += sim.trades.length;
    if (m.return.netPnlPct > 0) positive++;
  }
  return { used, avgNet: avg(nets), medPF: median(pfs), totalTrades, pctPos: used ? (positive / used) * 100 : 0 };
}

(async () => {
  const db = await openMarketDb(path.join(process.cwd(), 'market_data.db'));
  const repo = new MarketDataRepo(db);
  const symbols = symbolsArg
    ? symbolsArg.split(',')
    : (await db.all('SELECT DISTINCT symbol FROM candles WHERE timeframe = ? ORDER BY symbol', tf)).map((r) => r.symbol);

  const trainSegs = [], testSegs = [];
  for (const sym of symbols) {
    const candles = await repo.getCandles(sym, tf, 0, Number.MAX_SAFE_INTEGER);
    if (candles.length < 2 * (lookback + 2)) continue;
    const cut = Math.floor(candles.length * split);
    trainSegs.push(candles.slice(0, cut));
    testSegs.push(candles.slice(cut));
  }
  await db.close();
  console.log(`Phase 2 structure-gate OOS ${tf}: ${trainSegs.length} symbols, ADX>=${adxMin}, mult ${mult}, pivot ${pivotLength}, sl ${sl}, split ${split}\n`);

  console.log('minDist |        TRAIN net% / PF / %pos / trades        |        TEST net% / PF / %pos / trades');
  console.log('--------|----------------------------------------------|--------------------------------------------');
  for (const v of dists) {
    const tr = runSegment(trainSegs, v);
    const te = runSegment(testSegs, v);
    const fmt = (r) => `${r.avgNet.toFixed(2).padStart(7)} / ${r.medPF.toFixed(2)} / ${r.pctPos.toFixed(0).padStart(3)}% / ${String(r.totalTrades).padStart(6)}`;
    console.log(`${String(v).padStart(7)} | ${fmt(tr)}   |  ${fmt(te)}`);
  }
})();
