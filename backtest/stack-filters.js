// backtest/stack-filters.js
// Research harness (not production): compares entry-filter stacks for RangeFilter signal mode
// on a temporal train/test split — none / ADX-only / HTF-only / ADX+HTF — to see whether
// stacking the two gates beats either alone out-of-sample. Built on the already-tested
// simulate(); no new production logic. Usage:
//   node backtest/stack-filters.js --tf 1H --mult 5 --adx 30 --split 0.6
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
const mult = Number(arg('mult', '5'));
const period = Number(arg('period', '20'));
const sl = Number(arg('sl', '0.08'));
const lookback = Number(arg('lookback', '250'));
const split = Number(arg('split', '0.6'));
const adxMin = Number(arg('adx', '30'));
const htfRatio = Number(arg('htfRatio', '4'));
const htfEma = Number(arg('htfEma', '50'));
const htfBand = Number(arg('htfBand', '0.005'));
const symbolsArg = arg('symbols', null);

const guardrails = {
  portfolioValue: 200, riskPerTrade: 0.1, sizingMode: 'fixed',
  stopLossPct: sl, takeProfitPct: 0.04, minRiskRewardRatio: 1.5,
  maxOpenPositions: 1, maxTradesPerDay: 999999, dailyLossLimitPct: 1,
  maxPortfolioHeatPct: 100, leverage: 1,
};
const costs = { takerFee: 0.0006, makerFee: 0.0002, slippageBps: 5 };
const config = { logicType: 'RangeFilter', logic: { exit_mode: 'signal', indicators: { period, multiplier: mult } } };

const regimeGate = { adxMin, adxPeriod: 14 };
const htfGate = { ratio: htfRatio, emaPeriod: htfEma, band: htfBand };
const STACKS = [
  ['none', {}],
  [`adx>=${adxMin}`, { regimeGate }],
  [`htf(${htfRatio})`, { htfGate }],
  ['adx+htf', { regimeGate, htfGate }],
];

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function runSegment(segments, gates) {
  const nets = [], pfs = []; let totalTrades = 0, positive = 0, used = 0;
  for (const candles of segments) {
    if (candles.length < lookback + 2) continue;
    const sim = simulate({ candles, config, guardrails, costs, symbol: 'X', timeframe: tf, lookback, startEquity: guardrails.portfolioValue, ...gates });
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
  console.log(`Stack ${tf}: ${trainSegs.length} symbols, split ${split}, mult ${mult}, adx>=${adxMin}, htf(ratio ${htfRatio}, ema ${htfEma})\n`);

  console.log('filter      |        TRAIN net% / PF / %pos / trades        |        TEST net% / PF / %pos / trades');
  console.log('------------|-----------------------------------------------|--------------------------------------------');
  for (const [name, gates] of STACKS) {
    const tr = runSegment(trainSegs, gates);
    const te = runSegment(testSegs, gates);
    const fmt = (r) => `${r.avgNet.toFixed(2).padStart(7)} / ${r.medPF.toFixed(2)} / ${r.pctPos.toFixed(0).padStart(3)}% / ${String(r.totalTrades).padStart(6)}`;
    console.log(`${name.padEnd(11)} | ${fmt(tr)}    |  ${fmt(te)}`);
  }
})();
