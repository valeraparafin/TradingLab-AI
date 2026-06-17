// backtest/sweep-volume-gate.js
// Research harness (not production): tests H7 — does a volume-confirmation entry gate add edge
// ON TOP OF the established ADX regime gate? Holds the ADX gate fixed at the operating point,
// sweeps volGate.mult, and reports a temporal train/test split per threshold. volMult 0 = the
// ADX-only baseline. If a volMult that lifts train PF also lifts test PF (vs baseline), the
// volume confirmation is a real, generalizing filter; if it only helps train, it's a curve-fit.
// Usage: node backtest/sweep-volume-gate.js --tf 1H --mult 5 --adx 30 --sl 0.12 --split 0.6 --vols 0,1.2,1.5,2
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
const sl = Number(arg('sl', '0.12'));
const lookback = Number(arg('lookback', '250'));
const split = Number(arg('split', '0.6'));
const adxMin = Number(arg('adx', '30'));
const volPeriod = Number(arg('volPeriod', '20'));
const vols = String(arg('vols', '0,1.2,1.5,2')).split(',').map(Number);
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

function runSegment(segments, volMult) {
  const volGate = volMult > 0 ? { mult: volMult, period: volPeriod } : undefined;
  const nets = [], pfs = []; let totalTrades = 0, positive = 0, used = 0;
  for (const candles of segments) {
    if (candles.length < lookback + 2) continue;
    const sim = simulate({ candles, config, guardrails, costs, symbol: 'X', timeframe: tf, lookback, startEquity: guardrails.portfolioValue, regimeGate, volGate });
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
  console.log(`H7 vol-gate OOS ${tf}: ${trainSegs.length} symbols, ADX>=${adxMin}, mult ${mult}, sl ${sl}, split ${split}\n`);

  console.log('volMult |        TRAIN net% / PF / %pos / trades        |        TEST net% / PF / %pos / trades');
  console.log('--------|----------------------------------------------|--------------------------------------------');
  for (const v of vols) {
    const tr = runSegment(trainSegs, v);
    const te = runSegment(testSegs, v);
    const fmt = (r) => `${r.avgNet.toFixed(2).padStart(7)} / ${r.medPF.toFixed(2)} / ${r.pctPos.toFixed(0).padStart(3)}% / ${String(r.totalTrades).padStart(6)}`;
    console.log(`${String(v).padStart(7)} | ${fmt(tr)}   |  ${fmt(te)}`);
  }
})();
