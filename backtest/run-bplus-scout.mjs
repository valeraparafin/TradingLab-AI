// backtest/run-bplus-scout.mjs
// Frozen B+ concept-proof. Pre-registered configs (no tuning). Candle-only (no order book).
import path from 'path';
import fs from 'fs';
import { openMarketDb } from '../src/data/marketDataSchema.js';
import { MarketDataRepo } from '../src/data/MarketDataRepo.js';
import { simulate } from '../src/backtest/simulator.js';
import { buildPicksByDay } from '../src/backtest/historicalUniverse.js';
import { withUniverseGate } from '../src/backtest/universeGate.js';
import { evaluateBar } from '../src/core/pipeline.js';

const TFS = ['5m', '15m'];
const WINDOWS = {
  train: ['2024-06-01', '2025-06-01'],
  test:  ['2025-06-01', '2026-06-08'],
};
const COSTS = { takerFee: 0.0006, makerFee: 0.0002, slippageBps: 5 };
const SCORE_OPTS = { minLiquidity: 20e6, topN: 15, denylist: [] };

// Exit arms: A = structural stop + TP 2R + no-impulse time-stop; B = structural stop + trailing.
const ARMS = {
  A: { guardrails: { stopMode: 'structural', structuralRR: 2 }, exitPolicy: { timeStopBars: 6, impulseR: 1 } },
  B: { guardrails: { stopMode: 'structural', structuralRR: 10 }, exitPolicy: { channelExit: 10 } },
};

function baseGuardrails(extra) {
  return {
    portfolioValue: 10000, riskPerTrade: 0.02, sizingMode: 'fixed',
    minRiskRewardRatio: 0, maxOpenPositions: 1, maxPortfolioHeatPct: 100,
    dailyLossLimitPct: 1, maxTradesPerDay: 999999, leverage: 1, ...extra,
  };
}
function maxDrawdown(curve) {
  let peak = -Infinity, mdd = 0;
  for (const pt of curve) { if (pt.equity > peak) peak = pt.equity; if (peak > 0) mdd = Math.max(mdd, (peak - pt.equity) / peak); }
  return mdd;
}

async function main() {
  const uni = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'backtest', 'bplus-universe.json'), 'utf8'));
  const alts = uni.alts, majors = uni.majors, all = [...alts, ...majors];
  const db = await openMarketDb(path.join(process.cwd(), 'market_data.db'));
  const repo = new MarketDataRepo(db);
  const rows = [];

  for (const [win, [fromS, toS]] of Object.entries(WINDOWS)) {
    const from = Date.parse(fromS), to = Date.parse(toS);
    for (const tf of TFS) {
      // Load candles once per (window, tf), build the rolling pick map from alts only.
      const candlesBySym = {};
      for (const sym of all) {
        const cs = await repo.getCandles(sym, tf, from, to);
        if (cs && cs.length >= 260) candlesBySym[sym] = cs;
      }
      const altCandles = Object.fromEntries(Object.entries(candlesBySym).filter(([s]) => alts.includes(s)));
      const picksByDay = buildPicksByDay(altCandles, SCORE_OPTS);

      for (const [armName, arm] of Object.entries(ARMS)) {
        for (const sym of all) {
          const cs = candlesBySym[sym];
          if (!cs) { rows.push({ win, tf, arm: armName, sym, skip: true }); continue; }
          const isAlt = alts.includes(sym);
          // Majors (control) trade their own breakouts ungated; alts are gated to the daily picks.
          const decide = isAlt ? withUniverseGate(evaluateBar, picksByDay, sym) : evaluateBar;
          const res = simulate({
            candles: cs,
            config: { logicType: 'ScalpBreakout', logic: {} },
            guardrails: baseGuardrails(arm.guardrails),
            costs: COSTS, symbol: sym, timeframe: tf, lookback: 250,
            exitPolicy: arm.exitPolicy,
          }, decide);
          const pnlPct = res.finalEquity / 10000 - 1;
          const bh = cs[cs.length - 1].close / cs[0].close - 1;
          rows.push({ win, tf, arm: armName, sym, isAlt, pnlPct, mdd: maxDrawdown(res.equityCurve), trades: res.trades.length, bh });
        }
      }
    }
  }
  await db.close();

  const pct = (x) => (x * 100).toFixed(1) + '%';
  console.log('window\ttf\tarm\tsym\tgroup\tpnl\tmaxdd\ttrades\tbh');
  for (const r of rows) {
    if (r.skip) { console.log(`${r.win}\t${r.tf}\t${r.arm}\t${r.sym}\tSKIP`); continue; }
    console.log(`${r.win}\t${r.tf}\t${r.arm}\t${r.sym}\t${r.isAlt ? 'alt' : 'major'}\t${pct(r.pnlPct)}\t${pct(r.mdd)}\t${r.trades}\t${pct(r.bh)}`);
  }

  // Test-year gate per (tf × arm): alts breadth, beats-BH, MaxDD, + majors control.
  console.log('\n-- TEST-YEAR GATE (alts) + majors control --');
  for (const tf of TFS) for (const armName of Object.keys(ARMS)) {
    const cells = rows.filter(r => !r.skip && r.win === 'test' && r.tf === tf && r.arm === armName);
    const altC = cells.filter(r => r.isAlt), majC = cells.filter(r => !r.isAlt);
    const posShare = (g) => g.length ? g.filter(r => r.pnlPct > 0).length / g.length : 0;
    const avg = (g) => g.length ? g.reduce((a, r) => a + r.pnlPct, 0) / g.length : 0;
    const beat = altC.filter(r => r.pnlPct > r.bh).length;
    const mddMax = altC.length ? Math.max(...altC.map(r => r.mdd)) : 0;
    console.log(`${tf}\t${armName}\talts: pos ${(100 * posShare(altC)).toFixed(0)}% avg ${pct(avg(altC))} beatBH ${beat}/${altC.length} worstDD ${pct(mddMax)} | majors avg ${pct(avg(majC))}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
