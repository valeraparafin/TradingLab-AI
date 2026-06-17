// backtest/phase3-metalabel.mjs
// Research harness (not production): Phase 3 meta-labeling. The primary model (RangeFilter signal
// mode + ADX gate) decides the SIDE; a logistic meta-model predicts P(win) per signal from
// decision-time features (momentum + volatility + participation + SMC structure). We then take
// only signals above a probability threshold and ask: does that beat taking ALL signals (τ=0,
// the ADX-only baseline), OUT OF SAMPLE?
//
// Protocol: pool per-signal events across symbols, sort by time, temporal split (train first
// `split`, test rest) with an EMBARGO gap to prevent train/test leakage across the cut. Train the
// logreg on train events, sweep the threshold on BOTH train (in-sample) and test (OOS). Print the
// standardized coefficients (which features matter, and their sign) — this directly answers
// whether SMC structure adds predictive value over momentum/volatility.
// Usage: node backtest/phase3-metalabel.mjs --tf 1H --mult 6 --adx 30 --sl 0.12 --split 0.6 --embargo 50
import path from 'path';
import { openMarketDb } from '../src/data/marketDataSchema.js';
import { MarketDataRepo } from '../src/data/MarketDataRepo.js';
import { simulate } from '../src/backtest/simulator.js';
import { extractFeatures, FEATURE_NAMES } from '../src/backtest/metaFeatures.js';
import { LogisticRegression } from '../src/backtest/logreg.js';

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
const embargo = Number(arg('embargo', '50'));
const pivotLength = Number(arg('pivot', '50'));
const thresholds = String(arg('taus', '0,0.45,0.5,0.55,0.6,0.65')).split(',').map(Number);
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

// Pooled trade-level metrics over a set of {y, pnl, p} events kept at threshold τ.
function metricsAt(events, tau) {
  const kept = events.filter((e) => e.p >= tau);
  if (!kept.length) return { n: 0, win: 0, pf: 0, net: 0, avg: 0 };
  let pos = 0, sw = 0, sl_ = 0, net = 0;
  for (const e of kept) {
    net += e.pnl;
    if (e.pnl > 0) { pos++; sw += e.pnl; } else { sl_ += -e.pnl; }
  }
  return { n: kept.length, win: (pos / kept.length) * 100, pf: sl_ > 0 ? sw / sl_ : 99, net, avg: net / kept.length };
}

(async () => {
  const db = await openMarketDb(path.join(process.cwd(), 'market_data.db'));
  const repo = new MarketDataRepo(db);
  const symbols = symbolsArg
    ? symbolsArg.split(',')
    : (await db.all('SELECT DISTINCT symbol FROM candles WHERE timeframe = ? ORDER BY symbol', tf)).map((r) => r.symbol);

  const events = [];
  let usedSymbols = 0;
  for (const sym of symbols) {
    const candles = await repo.getCandles(sym, tf, 0, Number.MAX_SAFE_INTEGER);
    if (candles.length < lookback + 60) continue;
    const sim = simulate({ candles, config, guardrails, costs, symbol: sym, timeframe: tf, lookback, startEquity: guardrails.portfolioValue, regimeGate });
    if (!sim.trades.length) continue;
    const timeIdx = new Map(candles.map((c, i) => [c.time, i]));
    let added = 0;
    for (const t of sim.trades) {
      const entryIdx = timeIdx.get(t.entryTime);
      if (entryIdx == null) continue;
      const i = entryIdx - 1; // decision bar (entry fills next-bar open)
      if (i < 60) continue;
      const window = candles.slice(Math.max(0, i - lookback + 1), i + 1);
      const x = extractFeatures(window, t.side, { pivotLength });
      if (!x) continue;
      events.push({ t: t.entryTime, x, y: t.pnl > 0 ? 1 : 0, pnl: t.pnl });
      added++;
    }
    if (added) usedSymbols++;
  }
  await db.close();

  events.sort((a, b) => a.t - b.t);
  const cutTime = events[Math.floor(events.length * split)].t;
  // Embargo: drop train events within `embargo` bars (in time) of the cut to avoid leakage.
  const barMs = ({ '5m': 300000, '15m': 900000, '1H': 3600000, '4H': 14400000, '1D': 86400000 })[tf] || 3600000;
  const train = events.filter((e) => e.t < cutTime - embargo * barMs);
  const test = events.filter((e) => e.t >= cutTime);

  console.log(`Phase 3 meta-label ${tf}: ${usedSymbols}/${symbols.length} symbols, ADX>=${adxMin}, mult ${mult}, pivot ${pivotLength}`);
  console.log(`events: ${events.length} total | train ${train.length} (base win ${(100 * train.reduce((a, e) => a + e.y, 0) / train.length).toFixed(1)}%) | test ${test.length} (base win ${(100 * test.reduce((a, e) => a + e.y, 0) / test.length).toFixed(1)}%) | embargo ${embargo} bars\n`);

  const model = new LogisticRegression({ lr: 0.3, epochs: 1500, l2: 0.01 });
  model.fit(train.map((e) => e.x), train.map((e) => e.y));
  for (const e of train) e.p = model.predict(e.x);
  for (const e of test) e.p = model.predict(e.x);

  console.log('Standardized coefficients (|coef| desc) — sign = direction of win-predictiveness:');
  FEATURE_NAMES.map((name, j) => ({ name, w: model.weights[j] }))
    .sort((a, b) => Math.abs(b.w) - Math.abs(a.w))
    .forEach(({ name, w }) => console.log(`  ${name.padEnd(14)} ${w >= 0 ? '+' : ''}${w.toFixed(3)}`));
  console.log(`  ${'(bias)'.padEnd(14)} ${model.bias >= 0 ? '+' : ''}${model.bias.toFixed(3)}\n`);

  console.log('  tau |   TRAIN  n / win% / PF / avgPnl   |    TEST  n / win% / PF / avgPnl');
  console.log('  ----|----------------------------------|---------------------------------');
  const fmt = (m) => `${String(m.n).padStart(5)} / ${m.win.toFixed(1).padStart(5)} / ${m.pf.toFixed(2)} / ${m.avg.toFixed(3)}`;
  for (const tau of thresholds) {
    console.log(`  ${tau.toFixed(2)} | ${fmt(metricsAt(train, tau))}   |  ${fmt(metricsAt(test, tau))}`);
  }
})();
