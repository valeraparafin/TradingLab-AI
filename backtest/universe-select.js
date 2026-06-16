// backtest/universe-select.js
// Research harness (not production): hypothesis #3 — does the RangeFilter signal edge live in a
// selectable subset of symbols? Disciplined, no-overfit test: measure each symbol's characteristic
// on the TRAIN segment (liquidity, volatility) and its ADX-only PF on train, then check on the
// held-out TEST segment whether (a) train-PF predicts test-PF (does the per-symbol edge persist?)
// and (b) any train-measured characteristic separates the test winners from the noise.
// Built on the already-tested simulate(); no new production logic.
//   node backtest/universe-select.js --tf 15m --mult 5 --adx 40 --split 0.6
import path from 'path';
import { openMarketDb } from '../src/data/marketDataSchema.js';
import { MarketDataRepo } from '../src/data/MarketDataRepo.js';
import { simulate } from '../src/backtest/simulator.js';
import { computeMetrics } from '../src/backtest/metrics.js';
import { dailyStats } from '../src/backtest/historicalUniverse.js';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const tf = arg('tf', '15m');
const mult = Number(arg('mult', '5'));
const period = Number(arg('period', '20'));
const sl = Number(arg('sl', '0.08'));
const lookback = Number(arg('lookback', '250'));
const split = Number(arg('split', '0.6'));
const adxMin = Number(arg('adx', '40'));
const slippageBps = Number(arg('slippage', '5'));

const guardrails = {
  portfolioValue: 200, riskPerTrade: 0.1, sizingMode: 'fixed',
  stopLossPct: sl, takeProfitPct: 0.04, minRiskRewardRatio: 1.5,
  maxOpenPositions: 1, maxTradesPerDay: 999999, dailyLossLimitPct: 1,
  maxPortfolioHeatPct: 100, leverage: 1,
};
const costs = { takerFee: 0.0006, makerFee: 0.0002, slippageBps };
const config = { logicType: 'RangeFilter', logic: { exit_mode: 'signal', indicators: { period, multiplier: mult } } };
const regimeGate = { adxMin, adxPeriod: 14 };

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function runPF(candles) {
  if (candles.length < lookback + 2) return null;
  const sim = simulate({ candles, config, guardrails, costs, symbol: 'X', timeframe: tf, lookback, startEquity: guardrails.portfolioValue, regimeGate });
  if (sim.trades.length === 0) return null;
  const m = computeMetrics({ trades: sim.trades, equityCurve: sim.equityCurve, startEquity: guardrails.portfolioValue, slippageCost: sim.slippageCost, timeframe: tf, totalFunding: sim.totalFunding, liquidationCount: sim.liquidationCount });
  return { pf: isFinite(m.trades.profitFactor) ? m.trades.profitFactor : 3, net: m.return.netPnlPct * 100, trades: sim.trades.length };
}

// Pearson correlation.
function corr(xs, ys) {
  const n = xs.length; if (n < 2) return 0;
  const mx = avg(xs), my = avg(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return (sxx > 0 && syy > 0) ? sxy / Math.sqrt(sxx * syy) : 0;
}

(async () => {
  const db = await openMarketDb(path.join(process.cwd(), 'market_data.db'));
  const repo = new MarketDataRepo(db);
  const symbols = (await db.all('SELECT DISTINCT symbol FROM candles WHERE timeframe = ? ORDER BY symbol', tf)).map((r) => r.symbol);

  const rows = [];
  for (const sym of symbols) {
    const candles = await repo.getCandles(sym, tf, 0, Number.MAX_SAFE_INTEGER);
    if (candles.length < 2 * (lookback + 2)) continue;
    const cut = Math.floor(candles.length * split);
    const train = candles.slice(0, cut), test = candles.slice(cut);
    const trainPF = runPF(train), testPF = runPF(test);
    if (!trainPF || !testPF) continue;
    const ds = dailyStats(train);
    rows.push({
      sym,
      liq: median(ds.map((d) => d.liquidity)),
      vol: median(ds.map((d) => d.volatility)) * 100,
      trainPF: trainPF.pf, testPF: testPF.pf, testNet: testPF.net,
    });
  }
  await db.close();

  // (a) Does train-PF predict test-PF? (edge persistence)
  const cPF = corr(rows.map((r) => r.trainPF), rows.map((r) => r.testPF));
  // (b) Do characteristics predict test-PF?
  const cLiq = corr(rows.map((r) => Math.log(r.liq + 1)), rows.map((r) => r.testPF));
  const cVol = corr(rows.map((r) => r.vol), rows.map((r) => r.testPF));

  console.log(`Universe selection ${tf}: ${rows.length} symbols, split ${split}, adx>=${adxMin}, mult ${mult}\n`);
  console.log(`Correlation with TEST PF (does it predict OOS edge?):`);
  console.log(`  train PF   -> test PF : ${cPF.toFixed(2)}   (edge persistence per symbol)`);
  console.log(`  liquidity  -> test PF : ${cLiq.toFixed(2)}`);
  console.log(`  volatility -> test PF : ${cVol.toFixed(2)}\n`);

  // Bucket by each train-measured characteristic; compare aggregate TEST stats top vs bottom half.
  const bucket = (key, label) => {
    const sorted = [...rows].sort((a, b) => a[key] - b[key]);
    const h = Math.floor(sorted.length / 2);
    const bottom = sorted.slice(0, h), top = sorted.slice(sorted.length - h);
    const stat = (g) => `medPF ${median(g.map((r) => r.testPF)).toFixed(2)} / avgNet ${avg(g.map((r) => r.testNet)).toFixed(1)}% / %pos ${((g.filter((r) => r.testNet > 0).length / g.length) * 100).toFixed(0)}%`;
    console.log(`  ${label.padEnd(18)} TEST  high: ${stat(top)}   |  low: ${stat(bottom)}`);
  };
  console.log('Bucketed TEST performance (split by TRAIN-measured characteristic):');
  bucket('liq', 'liquidity');
  bucket('vol', 'volatility');
  bucket('trainPF', 'train PF');

  // Also: "select symbols profitable on train" → how do they do on test vs the rest?
  const profTrain = rows.filter((r) => r.trainPF > 1.0);
  const lossTrain = rows.filter((r) => r.trainPF <= 1.0);
  const stat = (g) => g.length ? `n=${g.length} medPF ${median(g.map((r) => r.testPF)).toFixed(2)} / avgNet ${avg(g.map((r) => r.testNet)).toFixed(1)}% / %pos ${((g.filter((r) => r.testNet > 0).length / g.length) * 100).toFixed(0)}%` : 'n=0';
  console.log(`\nSelect on TRAIN PF>1, measure TEST:`);
  console.log(`  train-profitable -> test: ${stat(profTrain)}`);
  console.log(`  train-losing     -> test: ${stat(lossTrain)}`);
})();
