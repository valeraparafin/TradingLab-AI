// backtest/sweep-rf-matrix.js
// Research harness (not production): sweeps the RangeFilter indicator's own parameters
// (multiplier x period) on a timeframe, with a temporal train/test split per cell. Motivation:
// on coarse TFs a high multiplier flips rarely (tiny sample), so a lower multiplier may restore
// a usable trade count and possibly edge. Reports TRAIN and TEST median-PF / %pos / trades side
// by side so a cell that only shines in-sample is visible as a curve-fit.
// Usage: node backtest/sweep-rf-matrix.js --tf 1D --sl 0.12 --lookback 80 --split 0.6 \
//          --mults 2,2.5,3,3.5,4,5,6 --periods 14,20,27 [--adx 0]
import path from 'path';
import { openMarketDb } from '../src/data/marketDataSchema.js';
import { MarketDataRepo } from '../src/data/MarketDataRepo.js';
import { simulate } from '../src/backtest/simulator.js';
import { computeMetrics } from '../src/backtest/metrics.js';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const tf = arg('tf', '1D');
const sl = Number(arg('sl', '0.12'));
const lookback = Number(arg('lookback', '80'));
const split = Number(arg('split', '0.6'));
const adxMin = Number(arg('adx', '0'));
const mults = String(arg('mults', '2,2.5,3,3.5,4,5,6')).split(',').map(Number);
const periods = String(arg('periods', '14,20,27')).split(',').map(Number);
const source = arg('source', 'close');
const symbolsArg = arg('symbols', null);

const guardrails = {
  portfolioValue: 200, riskPerTrade: 0.1, sizingMode: 'fixed',
  stopLossPct: sl, takeProfitPct: 0.04, minRiskRewardRatio: 1.5,
  maxOpenPositions: 1, maxTradesPerDay: 999999, dailyLossLimitPct: 1,
  maxPortfolioHeatPct: 100, leverage: 1,
};
const costs = { takerFee: 0.0006, makerFee: 0.0002, slippageBps: 5 };
const regimeGate = adxMin > 0 ? { adxMin, adxPeriod: 14 } : undefined;

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function runSegment(segments, mult, period) {
  const config = { logicType: 'RangeFilter', logic: { exit_mode: 'signal', indicators: { period, multiplier: mult, source } } };
  const nets = [], pfs = []; let totalTrades = 0, positive = 0, used = 0;
  for (const candles of segments) {
    if (candles.length < lookback + 2) continue;
    const sim = simulate({ candles, config, guardrails, costs, symbol: 'X', timeframe: tf, lookback, startEquity: guardrails.portfolioValue, regimeGate });
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
  console.log(`RF param matrix ${tf}: ${trainSegs.length} symbols, source ${source}, sl ${sl}, lookback ${lookback}, ADX${adxMin > 0 ? `>=${adxMin}` : '=off'}, split ${split}\n`);
  console.log('mult | per |        TRAIN net% / PF / %pos / trades        |        TEST net% / PF / %pos / trades');
  console.log('-----|-----|----------------------------------------------|--------------------------------------------');
  for (const mult of mults) {
    for (const period of periods) {
      const tr = runSegment(trainSegs, mult, period);
      const te = runSegment(testSegs, mult, period);
      const fmt = (r) => `${r.avgNet.toFixed(2).padStart(7)} / ${r.medPF.toFixed(2)} / ${r.pctPos.toFixed(0).padStart(3)}% / ${String(r.totalTrades).padStart(6)}`;
      console.log(`${String(mult).padStart(4)} | ${String(period).padStart(3)} | ${fmt(tr)}   |  ${fmt(te)}`);
    }
  }
})();
