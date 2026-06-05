// backtest/oos-param-sweep.mjs
// Parameter sweep on top of the robust core found by oos-sweep.mjs.
// Three phases, each split train(H1)/test(H2), reusing the exact simulate path:
//   A) SMC pivot_length            — does a faster/slower structure window beat default 50?
//   B) Stop-loss width × RR        — the biggest lever after RR, on the strong cells.
//   C) VMC wt-len/avg & REVERSAL fvg_lookback — is an edge hidden in non-default params?
// Read-only on market_data.db. No persistence; metrics only.
//
// Param shapes differ per indicator (verified against src/indicators/*):
//   SMC      → config.logic = { indicators: { pivot_length: N } }   (nested, default 50)
//   VMC      → config.logic = { wtLen, wtAvg }                       (flat,   default 9 / 12)
//   REVERSAL → config.logic = { fvg_lookback: N }                    (flat,   default 20)
import path from 'path';
import { openMarketDb } from '../src/data/marketDataSchema.js';
import { MarketDataRepo } from '../src/data/MarketDataRepo.js';
import { simulate } from '../src/backtest/simulator.js';
import { computeMetrics } from '../src/backtest/metrics.js';

const SPLIT = Date.parse('2025-06-01');     // H1 < SPLIT <= H2
const LOOKBACK = 250, START = 10000, MIN_TRADES = 20;
const COSTS = { takerFee: 0.0006, makerFee: 0.0002, slippageBps: 5, liqFeeRate: 0.0006 };

function guardrails(rr, sl) {
  return {
    portfolioValue: START, riskPerTrade: 0.1, maxTradeSizeUSD: Infinity,
    stopLossPct: sl, takeProfitPct: sl * rr, minRiskRewardRatio: 1,
    maxOpenPositions: 1, maxPortfolioHeatPct: 100, dailyLossLimitPct: 1,
    dailyProfitTargetPct: null, maxTradesPerDay: 999999, leverage: 1, mmr: null,
  };
}

function logicConfig(logic, p) {
  if (logic === 'SMC') return { indicators: { pivot_length: p.pivot } };
  if (logic === 'VMC_CIPHERB') return { wtLen: p.wtLen, wtAvg: p.wtAvg };
  if (logic === 'REVERSAL') return { fvg_lookback: p.fvg };
  return {};
}

function runHalf(candles, logic, tf, symbol, rr, sl, lcfg) {
  const sim = simulate({
    candles, config: { logicType: logic, logic: lcfg }, guardrails: guardrails(rr, sl),
    costs: COSTS, symbol, timeframe: tf, lookback: LOOKBACK, startEquity: START, funding: null,
  });
  const m = computeMetrics({
    trades: sim.trades, equityCurve: sim.equityCurve, startEquity: START,
    slippageCost: sim.slippageCost, timeframe: tf, totalFunding: sim.totalFunding,
    liquidationCount: sim.liquidationCount,
  });
  return { net: m.return.netPnlPct * 100, pf: m.trades.profitFactor, wr: m.trades.winRate * 100, n: m.trades.count };
}

const db = await openMarketDb(path.join(process.cwd(), 'market_data.db'));
const repo = new MarketDataRepo(db);
const cache = {};
async function halves(tf, symbol) {
  const key = `${tf}:${symbol}`;
  if (!cache[key]) {
    const all = await repo.getCandles(symbol, tf, 0, Number.MAX_SAFE_INTEGER);
    cache[key] = { h1: all.filter(c => c.time < SPLIT), h2: all.filter(c => c.time >= SPLIT) };
  }
  return cache[key];
}

const fmt = (h) => `${String(h.n).padStart(4)}/${h.wr.toFixed(0).padStart(2)}%/${h.pf.toFixed(2)}/${(h.net >= 0 ? '+' : '') + h.net.toFixed(1)}%`;
const robustOf = (a, b) => a.net > 0 && b.net > 0 && a.n >= MIN_TRADES && b.n >= MIN_TRADES;
const score = (a, b) => Math.min(a.net, b.net); // weakest half = robustness score

async function cell(logic, symbol, tf, rr, sl, p) {
  const { h1, h2 } = await halves(tf, symbol);
  try {
    const lc = logicConfig(logic, p);
    const a = runHalf(h1, logic, tf, symbol, rr, sl, lc);
    const b = runHalf(h2, logic, tf, symbol, rr, sl, lc);
    return { a, b, robust: robustOf(a, b), score: score(a, b) };
  } catch { return null; }
}

// ---------------------------------------------------------------- PHASE A: SMC pivot_length
console.log('\n================ PHASE A — SMC pivot_length (default 50) ================');
console.log('(per param: trades/winrate/profitFactor/netReturn ; H1 train | H2 test ; ✓=robust)\n');
const A_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'LTCUSDT', 'XLMUSDT', 'XRPUSDT'];
const A_TFS = ['15m', '1H', '4H'];
const A_PIVOTS = [20, 35, 50];
const A_RRS = [2, 3];
const aWins = [];
for (const tf of A_TFS) for (const symbol of A_SYMBOLS) for (const rr of A_RRS) {
  const sym = symbol.replace('USDT', '');
  const runs = [];
  for (const pivot of A_PIVOTS) {
    const r = await cell('SMC', symbol, tf, rr, 0.02, { pivot });
    if (r) runs.push({ pivot, ...r });
  }
  if (!runs.length) continue;
  const base = runs.find(r => r.pivot === 50);
  const best = runs.slice().sort((x, y) => y.score - x.score)[0];
  // only print rows where at least one pivot is robust (keep noise down)
  if (!runs.some(r => r.robust)) continue;
  console.log(`SMC ${sym.padEnd(4)} ${tf.padEnd(3)} RR${rr}`);
  for (const r of runs) {
    const tag = r.robust ? '✓' : ' ';
    const star = (best.pivot === r.pivot && best.robust) ? ' <= best' : '';
    console.log(`   pivot ${String(r.pivot).padStart(2)} ${tag} | H1 ${fmt(r.a)} | H2 ${fmt(r.b)}${star}`);
  }
  if (base && best.pivot !== 50 && best.robust && best.score > base.score + 0.5) {
    aWins.push(`SMC ${sym} ${tf} RR${rr}: pivot ${best.pivot} weakest-half +${best.score.toFixed(1)}% vs pivot50 ${base.score >= 0 ? '+' : ''}${base.score.toFixed(1)}%`);
  }
}

// ---------------------------------------------------------------- PHASE B: stop-loss width
console.log('\n================ PHASE B — stop-loss width x RR (default 2%) ================');
console.log('(strong cells; default params; per cell: SL x RR grid, ✓=robust both halves)\n');
const B_CELLS = [
  ['SMC', 'XLMUSDT', '1H'], ['SMC', 'XLMUSDT', '15m'], ['SMC', 'ETHUSDT', '1H'],
  ['SMC', 'BTCUSDT', '1H'], ['SMC', 'SOLUSDT', '1H'], ['SMC', 'XRPUSDT', '1H'],
  ['REVERSAL', 'BTCUSDT', '4H'],
];
const B_SLS = [0.01, 0.015, 0.02, 0.03];
const B_RRS = [2, 3];
const bWins = [];
for (const [logic, symbol, tf] of B_CELLS) {
  const sym = symbol.replace('USDT', '');
  console.log(`${logic} ${sym} ${tf}`);
  let bestRobust = null;
  for (const sl of B_SLS) for (const rr of B_RRS) {
    const p = logic === 'REVERSAL' ? { fvg: 20 } : { pivot: 50 };
    const r = await cell(logic, symbol, tf, rr, sl, p);
    if (!r) continue;
    const tag = r.robust ? '✓' : ' ';
    console.log(`   SL ${(sl * 100).toFixed(1).padStart(4)}% RR${rr} ${tag} | H1 ${fmt(r.a)} | H2 ${fmt(r.b)}`);
    if (r.robust && (!bestRobust || r.score > bestRobust.score)) bestRobust = { sl, rr, ...r };
  }
  if (bestRobust && !(bestRobust.sl === 0.02 && bestRobust.rr === 3)) {
    bWins.push(`${logic} ${sym} ${tf}: best robust = SL ${(bestRobust.sl * 100).toFixed(1)}%/RR${bestRobust.rr} (weakest half +${bestRobust.score.toFixed(1)}%)`);
  }
}

// ---------------------------------------------------------------- PHASE C: VMC & REVERSAL params
console.log('\n================ PHASE C — VMC wt-len/avg & REVERSAL fvg_lookback ================');
console.log('(per param set; H1 train | H2 test ; ✓=robust)\n');
const C_VMC_CELLS = [['BTCUSDT', '4H'], ['XRPUSDT', '1H'], ['ETHUSDT', '1H'], ['BTCUSDT', '15m']];
const C_WT = [{ wtLen: 9, wtAvg: 12 }, { wtLen: 6, wtAvg: 9 }, { wtLen: 10, wtAvg: 21 }];
const C_REV_CELLS = [['BTCUSDT', '4H'], ['BTCUSDT', '1H'], ['ETHUSDT', '1H']];
const C_FVG = [10, 20, 40];
const cWins = [];
for (const [symbol, tf] of C_VMC_CELLS) {
  const sym = symbol.replace('USDT', '');
  for (const rr of [2, 3]) {
    const runs = [];
    for (const w of C_WT) {
      const r = await cell('VMC_CIPHERB', symbol, tf, rr, 0.02, w);
      if (r) runs.push({ label: `wt${w.wtLen}/${w.wtAvg}`, base: w.wtLen === 9 && w.wtAvg === 12, ...r });
    }
    if (!runs.some(r => r.robust)) continue;
    console.log(`VMC ${sym.padEnd(4)} ${tf.padEnd(3)} RR${rr}`);
    for (const r of runs) console.log(`   ${r.label.padEnd(8)} ${r.robust ? '✓' : ' '} | H1 ${fmt(r.a)} | H2 ${fmt(r.b)}`);
    const best = runs.slice().sort((x, y) => y.score - x.score)[0];
    if (best.robust && !best.base) cWins.push(`VMC ${sym} ${tf} RR${rr}: ${best.label} robust (weakest +${best.score.toFixed(1)}%)`);
  }
}
for (const [symbol, tf] of C_REV_CELLS) {
  const sym = symbol.replace('USDT', '');
  for (const rr of [2, 3]) {
    const runs = [];
    for (const fvg of C_FVG) {
      const r = await cell('REVERSAL', symbol, tf, rr, 0.02, { fvg });
      if (r) runs.push({ label: `fvg${fvg}`, base: fvg === 20, ...r });
    }
    if (!runs.some(r => r.robust)) continue;
    console.log(`REV ${sym.padEnd(4)} ${tf.padEnd(3)} RR${rr}`);
    for (const r of runs) console.log(`   ${r.label.padEnd(6)} ${r.robust ? '✓' : ' '} | H1 ${fmt(r.a)} | H2 ${fmt(r.b)}`);
    const best = runs.slice().sort((x, y) => y.score - x.score)[0];
    if (best.robust && !best.base) cWins.push(`REV ${sym} ${tf} RR${rr}: ${best.label} robust (weakest +${best.score.toFixed(1)}%)`);
  }
}

await db.close();

// ---------------------------------------------------------------- WINS SUMMARY
console.log('\n================ WINS vs BASELINE (params that beat defaults) ================');
const all = [...aWins, ...bWins, ...cWins];
if (!all.length) console.log('  NONE — default params (pivot 50, wt 9/12, fvg 20, SL 2%) were already best. No tuning edge.');
else for (const w of all) console.log('  • ' + w);
console.log('');
