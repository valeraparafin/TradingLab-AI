// backtest/oos-sweep.mjs
// Out-of-sample sweep: logic × symbol × TF × RR, each split into train(H1)/test(H2).
// Finds cells profitable in BOTH halves (robustness), reusing the exact simulate path.
// No persistence; metrics only. Read-only on market_data.db.
import path from 'path';
import { openMarketDb } from '../src/data/marketDataSchema.js';
import { MarketDataRepo } from '../src/data/MarketDataRepo.js';
import { simulate } from '../src/backtest/simulator.js';
import { computeMetrics } from '../src/backtest/metrics.js';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'LTCUSDT', 'XLMUSDT', 'XRPUSDT'];
const TFS = ['15m', '1H', '4H'];          // 5m excluded: proven fee-dominated/dead
const LOGICS = ['SMC', 'VMC_CIPHERB', 'REVERSAL']; // BREAKOUT excluded: structurally 0 trades
const RRS = [2, 3];                        // sl fixed 2% → tp = 2%·RR
const SPLIT = Date.parse('2025-06-01');    // H1 < SPLIT ≤ H2
const SL = 0.02, LOOKBACK = 250, START = 10000, MIN_TRADES = 20;

function guardrails(rr) {
  return {
    portfolioValue: START, riskPerTrade: 0.1, maxTradeSizeUSD: Infinity,
    stopLossPct: SL, takeProfitPct: SL * rr, minRiskRewardRatio: 1,
    maxOpenPositions: 1, maxPortfolioHeatPct: 100, dailyLossLimitPct: 1,
    dailyProfitTargetPct: null, maxTradesPerDay: 999999, leverage: 1, mmr: null,
  };
}
const COSTS = { takerFee: 0.0006, makerFee: 0.0002, slippageBps: 5, liqFeeRate: 0.0006 };

function runHalf(candles, logicType, tf, symbol, rr) {
  const g = guardrails(rr);
  const sim = simulate(
    { candles, config: { logicType, logic: {} }, guardrails: g, costs: COSTS,
      symbol, timeframe: tf, lookback: LOOKBACK, startEquity: START, funding: null },
    undefined,
  );
  const m = computeMetrics({ trades: sim.trades, equityCurve: sim.equityCurve,
    startEquity: START, slippageCost: sim.slippageCost, timeframe: tf,
    totalFunding: sim.totalFunding, liquidationCount: sim.liquidationCount });
  return { net: m.return.netPnlPct * 100, pf: m.trades.profitFactor,
    wr: m.trades.winRate * 100, n: m.trades.count };
}

const db = await openMarketDb(path.join(process.cwd(), 'market_data.db'));
const repo = new MarketDataRepo(db);
const rows = [];

for (const tf of TFS) {
  for (const symbol of SYMBOLS) {
    const all = await repo.getCandles(symbol, tf, 0, Number.MAX_SAFE_INTEGER);
    const h1 = all.filter(c => c.time < SPLIT);
    const h2 = all.filter(c => c.time >= SPLIT);
    for (const logic of LOGICS) {
      for (const rr of RRS) {
        let a, b;
        try { a = runHalf(h1, logic, tf, symbol, rr); b = runHalf(h2, logic, tf, symbol, rr); }
        catch (e) { continue; } // logic that can't run on this data → skip
        const robust = a.net > 0 && b.net > 0 && a.n >= MIN_TRADES && b.n >= MIN_TRADES;
        rows.push({ tf, symbol: symbol.replace('USDT', ''), logic, rr, a, b, robust,
          score: Math.min(a.net, b.net) });
      }
    }
  }
}
await db.close();

const fmt = (h) => `${String(h.n).padStart(4)}/${h.wr.toFixed(0).padStart(2)}%/${h.pf.toFixed(2)}/${(h.net >= 0 ? '+' : '') + h.net.toFixed(1)}%`;
const line = (r) => `${r.logic.padEnd(11)} ${r.symbol.padEnd(4)} ${r.tf.padEnd(4)} RR${r.rr}  | H1 ${fmt(r.a)} | H2 ${fmt(r.b)}`;

const robust = rows.filter(r => r.robust).sort((x, y) => y.score - x.score);
console.log(`\n===== ROBUST CELLS (profit in BOTH halves, ≥${MIN_TRADES} trades each) =====`);
console.log(`(format: trades/winrate/profitFactor/netReturn per half)\n`);
if (!robust.length) console.log('  NONE — no config is profitable out-of-sample.');
else for (const r of robust) console.log('  ✓ ' + line(r));

console.log(`\n===== SUMMARY =====`);
console.log(`Total cells tested: ${rows.length} | Robust: ${robust.length}`);
const byLogic = {};
for (const r of rows) { byLogic[r.logic] ??= { t: 0, rob: 0 }; byLogic[r.logic].t++; if (r.robust) byLogic[r.logic].rob++; }
for (const [k, v] of Object.entries(byLogic)) console.log(`  ${k.padEnd(12)} robust ${v.rob}/${v.t}`);

// near-misses: positive in test (H2) but failed robustness, top 8 by H2 net
const near = rows.filter(r => !r.robust && r.b.net > 0 && r.b.n >= MIN_TRADES).sort((x, y) => y.b.net - x.b.net).slice(0, 8);
console.log(`\n===== TOP NEAR-MISSES (good in TEST half, failed train) =====`);
for (const r of near) console.log('  ~ ' + line(r));
