// backtest/sweep-adx-gate.js
// Research harness (not production): tests the "RangeFilter signal edge is a trend-regime
// story" hypothesis by sweeping the ADX entry gate across every symbol on a timeframe.
// Loads candles once per symbol, then runs signal-mode simulate() at each ADX threshold and
// aggregates. Usage: node backtest/sweep-adx-gate.js --tf 15m --mult 5 --thresholds 0,20,25,30,40
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
const mult = Number(arg('mult', '5'));
const period = Number(arg('period', '20'));
const sl = Number(arg('sl', '0.08'));
const lookback = Number(arg('lookback', '250'));
const thresholds = String(arg('thresholds', '0,20,25,30,40')).split(',').map(Number);
const symbolsArg = arg('symbols', null);

const guardrails = {
  portfolioValue: 200, riskPerTrade: 0.1, sizingMode: 'fixed',
  stopLossPct: sl, takeProfitPct: 0.04, minRiskRewardRatio: 1.5,
  maxOpenPositions: 1, maxTradesPerDay: 999999, dailyLossLimitPct: 1,
  maxPortfolioHeatPct: 100, leverage: 1,
};
const costs = { takerFee: 0.0006, makerFee: 0.0002, slippageBps: 5 };
const config = { logicType: 'RangeFilter', logic: { exit_mode: 'signal', indicators: { period, multiplier: mult } } };

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

(async () => {
  const db = await openMarketDb(path.join(process.cwd(), 'market_data.db'));
  const repo = new MarketDataRepo(db);
  let symbols = symbolsArg
    ? symbolsArg.split(',')
    : (await db.all('SELECT DISTINCT symbol FROM candles WHERE timeframe = ? ORDER BY symbol', tf)).map((r) => r.symbol);

  // Preload candles once per symbol.
  const data = [];
  for (const sym of symbols) {
    const candles = await repo.getCandles(sym, tf, 0, Number.MAX_SAFE_INTEGER);
    if (candles.length >= lookback + 2) data.push({ sym, candles });
  }
  await db.close();
  console.log(`Loaded ${data.length}/${symbols.length} symbols on ${tf} (mult ${mult}, period ${period}, sl ${sl}, signal mode)\n`);

  console.log('adxMin | symbols | avg net% | median PF | win% | avg DD% | total trades | % positive');
  console.log('-------|---------|----------|-----------|------|---------|--------------|-----------');
  for (const adxMin of thresholds) {
    const regimeGate = adxMin > 0 ? { adxMin, adxPeriod: 14 } : undefined;
    const nets = [], pfs = [], wins = [], dds = [];
    let totalTrades = 0, positive = 0, used = 0;
    for (const { sym, candles } of data) {
      const sim = simulate({ candles, config, guardrails, costs, symbol: sym, timeframe: tf, lookback, startEquity: guardrails.portfolioValue, regimeGate });
      if (sim.trades.length === 0) continue;
      const m = computeMetrics({ trades: sim.trades, equityCurve: sim.equityCurve, startEquity: guardrails.portfolioValue, slippageCost: sim.slippageCost, timeframe: tf, totalFunding: sim.totalFunding, liquidationCount: sim.liquidationCount });
      used++;
      nets.push(m.return.netPnlPct * 100);
      const pf = isFinite(m.trades.profitFactor) ? m.trades.profitFactor : 3; // cap Inf for the median
      pfs.push(pf);
      wins.push(m.trades.winRate * 100);
      dds.push(m.risk.maxDrawdownPct * 100);
      totalTrades += sim.trades.length;
      if (m.return.netPnlPct > 0) positive++;
    }
    const avg = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
    console.log(
      `${String(adxMin).padStart(6)} | ${String(used).padStart(7)} | ${avg(nets).toFixed(2).padStart(8)} | ${median(pfs).toFixed(2).padStart(9)} | ${avg(wins).toFixed(1).padStart(4)} | ${avg(dds).toFixed(1).padStart(7)} | ${String(totalTrades).padStart(12)} | ${((positive / used) * 100).toFixed(0).padStart(9)}%`,
    );
  }
})();
