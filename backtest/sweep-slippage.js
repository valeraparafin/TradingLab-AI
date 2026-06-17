// backtest/sweep-slippage.js
// Research harness (not production): slippage stress test for the decorrelated basket.
// Phase 1 showed the edge survives/strengthens on the 14-symbol decorrelated basket
// (15m, mult 6, ADX>=40) — BUT that basket is mostly low-cap volatile alts where the
// 5 bps slippage assumed elsewhere is optimistic. Real fills on thin books can cost
// 20-50 bps. This sweeps slippageBps at the operating config and reports a temporal
// train/test split per level, so we can see at what cost the +10.5% test edge evaporates.
// Usage: node backtest/sweep-slippage.js --tf 15m --mult 6 --adx 40 --sl 0.12 --split 0.6 --bps 5,10,20,30,50
import path from 'path';
import { openMarketDb } from '../src/data/marketDataSchema.js';
import { MarketDataRepo } from '../src/data/MarketDataRepo.js';
import { simulate } from '../src/backtest/simulator.js';
import { computeMetrics } from '../src/backtest/metrics.js';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const tf = arg('tf', '15m');
const mult = Number(arg('mult', '6'));
const period = Number(arg('period', '20'));
const sl = Number(arg('sl', '0.12'));
const lookback = Number(arg('lookback', '250'));
const split = Number(arg('split', '0.6'));
const adxMin = Number(arg('adx', '40'));
const bpsList = String(arg('bps', '5,10,20,30,50')).split(',').map(Number);
// The Phase 1 decorrelated basket (pairwise |corr| <= 0.6 @ 15m). Override with --symbols.
const DECORR = 'BTCUSDT,SIRENUSDT,VELVETUSDT,ESPORTSUSDT,HUSDT,SKYAIUSDT,STGUSDT,RIFUSDT,ZECUSDT,VVVUSDT,HYPEUSDT,WLDUSDT,TRUMPUSDT,FILUSDT';
const symbolsArg = arg('symbols', DECORR);

const guardrails = {
  portfolioValue: 200, riskPerTrade: 0.1, sizingMode: 'fixed',
  stopLossPct: sl, takeProfitPct: 0.04, minRiskRewardRatio: 1.5,
  maxOpenPositions: 1, maxTradesPerDay: 999999, dailyLossLimitPct: 1,
  maxPortfolioHeatPct: 100, leverage: 1,
};
const config = { logicType: 'RangeFilter', logic: { exit_mode: 'signal', indicators: { period, multiplier: mult } } };
const regimeGate = adxMin > 0 ? { adxMin, adxPeriod: 14 } : undefined;

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function runSegment(segments, slippageBps) {
  const costs = { takerFee: 0.0006, makerFee: 0.0002, slippageBps };
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
  const symbols = symbolsArg.split(',');

  const trainSegs = [], testSegs = [];
  let kept = 0;
  for (const sym of symbols) {
    const candles = await repo.getCandles(sym, tf, 0, Number.MAX_SAFE_INTEGER);
    if (candles.length < 2 * (lookback + 2)) continue;
    const cut = Math.floor(candles.length * split);
    trainSegs.push(candles.slice(0, cut));
    testSegs.push(candles.slice(cut));
    kept++;
  }
  await db.close();
  console.log(`Slippage stress ${tf}: ${kept}/${symbols.length} symbols, ADX>=${adxMin}, mult ${mult}, sl ${sl}, split ${split} (decorrelated basket)\n`);

  console.log('bps |        TRAIN net% / PF / %pos / trades        |        TEST net% / PF / %pos / trades');
  console.log('----|----------------------------------------------|--------------------------------------------');
  for (const v of bpsList) {
    const tr = runSegment(trainSegs, v);
    const te = runSegment(testSegs, v);
    const fmt = (r) => `${r.avgNet.toFixed(2).padStart(7)} / ${r.medPF.toFixed(2)} / ${r.pctPos.toFixed(0).padStart(3)}% / ${String(r.totalTrades).padStart(6)}`;
    console.log(`${String(v).padStart(3)} | ${fmt(tr)}   |  ${fmt(te)}`);
  }
})();
