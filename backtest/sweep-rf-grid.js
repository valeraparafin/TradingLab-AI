// backtest/sweep-rf-grid.js
// Research harness (not production): full factorial grid over the RangeFilter indicator's three
// inputs — multiplier x swing-period x swing-source — with a temporal train/test split per cell.
// Holds the ADX gate fixed at the operating point. Answers "can ANY parameter combination beat
// the current operating config?" Prints:
//   1) main-effect marginal means (avg test PF per parameter level) = the regression decomposition
//      on a balanced factorial design (equivalent to OLS main effects, but readable),
//   2) the top cells ranked by a robustness score = min(trainPF, testPF) (rewards configs that
//      hold up in BOTH windows, not in-sample-only curve-fits),
//   3) the current baseline cell for reference.
// Usage: node backtest/sweep-rf-grid.js --tf 1H --adx 30 --sl 0.12 --split 0.6 \
//          --mults 3,3.5,4,5,6,7 --periods 14,20,27,34 --sources open,low,close,hl2,hlc3,ohlc4,hlcc4
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
const sl = Number(arg('sl', '0.12'));
const lookback = Number(arg('lookback', '250'));
const split = Number(arg('split', '0.6'));
const adxMin = Number(arg('adx', '30'));
const mults = String(arg('mults', '3,3.5,4,5,6,7')).split(',').map(Number);
const periods = String(arg('periods', '14,20,27,34')).split(',').map(Number);
const sources = String(arg('sources', 'open,low,close,hl2,hlc3,ohlc4,hlcc4')).split(',');
const topN = Number(arg('top', '15'));
const baseMult = Number(arg('baseMult', '5'));
const basePeriod = Number(arg('basePeriod', '20'));
const baseSource = arg('baseSource', 'close');
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

function runSegment(segments, mult, period, source) {
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

  const cells = [];
  for (const mult of mults) {
    for (const period of periods) {
      for (const source of sources) {
        const tr = runSegment(trainSegs, mult, period, source);
        const te = runSegment(testSegs, mult, period, source);
        cells.push({ mult, period, source, trainPF: tr.medPF, testPF: te.medPF, testNet: te.avgNet, trades: te.totalTrades, pctPos: te.pctPos, score: Math.min(tr.medPF, te.medPF) });
      }
    }
  }

  console.log(`RF 3D grid ${tf}: ${trainSegs.length} symbols, ADX${adxMin > 0 ? `>=${adxMin}` : '=off'}, sl ${sl}, split ${split} | ${cells.length} cells (${mults.length}x${periods.length}x${sources.length})\n`);

  // (1) Main-effect marginal means: average TEST PF holding one parameter level fixed.
  const marg = (key) => {
    const levels = [...new Set(cells.map((c) => c[key]))];
    return levels.map((lv) => {
      const sub = cells.filter((c) => c[key] === lv);
      return { lv, testPF: avg(sub.map((c) => c.testPF)), trainPF: avg(sub.map((c) => c.trainPF)), net: avg(sub.map((c) => c.testNet)) };
    }).sort((a, b) => b.testPF - a.testPF);
  };
  for (const key of ['source', 'mult', 'period']) {
    console.log(`-- main effect: ${key} (avg over all other params) --`);
    console.log(`   ${key.padEnd(7)} | mean TEST PF | mean TRAIN PF | mean TEST net%`);
    for (const r of marg(key)) {
      console.log(`   ${String(r.lv).padEnd(7)} |     ${r.testPF.toFixed(3)}   |     ${r.trainPF.toFixed(3)}   |   ${r.net.toFixed(2)}`);
    }
    console.log('');
  }

  // (2) Top cells by robustness score = min(trainPF, testPF).
  cells.sort((a, b) => b.score - a.score);
  console.log(`-- top ${topN} cells by robustness score min(trainPF,testPF) --`);
  console.log('mult | per | source | trainPF | testPF | testNet% | testTrades | %pos | score');
  for (const c of cells.slice(0, topN)) {
    console.log(`${String(c.mult).padStart(4)} | ${String(c.period).padStart(3)} | ${c.source.padStart(6)} | ${c.trainPF.toFixed(2).padStart(7)} | ${c.testPF.toFixed(2).padStart(6)} | ${c.testNet.toFixed(2).padStart(8)} | ${String(c.trades).padStart(10)} | ${c.pctPos.toFixed(0).padStart(3)}% | ${c.score.toFixed(2)}`);
  }

  // (3) Baseline reference.
  const base = cells.find((c) => c.mult === baseMult && c.period === basePeriod && c.source === baseSource);
  if (base) {
    console.log(`\n-- baseline (mult ${baseMult}, period ${basePeriod}, ${baseSource}) --`);
    console.log(`     trainPF ${base.trainPF.toFixed(2)} | testPF ${base.testPF.toFixed(2)} | testNet ${base.testNet.toFixed(2)}% | score ${base.score.toFixed(2)} | rank ${cells.indexOf(base) + 1}/${cells.length}`);
  }
})();
