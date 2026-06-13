// backtest/run-ppd-scout.mjs
// Frozen post-pump-dump swing concept-proof. Pre-registered configs (no tuning). Fully backtestable.
import path from 'path';
import fs from 'fs';
import { openMarketDb } from '../src/data/marketDataSchema.js';
import { MarketDataRepo } from '../src/data/MarketDataRepo.js';
import { simulate } from '../src/backtest/simulator.js';
import { withPumpDumpGate } from '../src/backtest/pumpDumpGate.js';
import { evaluateBar } from '../src/core/pipeline.js';

const TFS = ['15m', '5m'];
const WINDOWS = {
  train: ['2024-06-01', '2025-06-01'],
  test:  ['2025-06-01', '2026-06-08'],
};
const COSTS = { takerFee: 0.0006, makerFee: 0.0002, slippageBps: 5 };

// Frozen parameter sets (pre-registered). P1 base, P2 strict (only strong pumps).
const PSETS = {
  P1: { pumpWindow: 480, pumpPct: 0.50, dumpPct: 0.15, entryLookback: 96, channelExit: 192 },
  P2: { pumpWindow: 480, pumpPct: 1.00, dumpPct: 0.20, entryLookback: 96, channelExit: 192 },
};

function baseGuardrails(extra) {
  return {
    portfolioValue: 10000, riskPerTrade: 0.02, sizingMode: 'fixed',
    minRiskRewardRatio: 0, maxOpenPositions: 1, maxPortfolioHeatPct: 100,
    dailyLossLimitPct: 1, maxTradesPerDay: 999999, leverage: 1, atrPeriod: 14,
    stopMode: 'channel', ...extra,
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
      const candlesBySym = {};
      for (const sym of all) {
        const cs = await repo.getCandles(sym, tf, from, to);
        if (cs && cs.length >= 540) candlesBySym[sym] = cs; // need >= pumpWindow(480) + margin
      }
      for (const [psName, P] of Object.entries(PSETS)) {
        for (const sym of all) {
          const cs = candlesBySym[sym];
          if (!cs) { rows.push({ win, tf, ps: psName, sym, skip: true }); continue; }
          const isAlt = alts.includes(sym);
          // Same detector gate for alts AND majors (the detector IS the strategy; majors are the
          // control and should rarely qualify). Short-only via the gate.
          const decide = withPumpDumpGate(evaluateBar, { pumpWindow: P.pumpWindow, pumpPct: P.pumpPct, dumpPct: P.dumpPct });
          const res = simulate({
            candles: cs,
            config: { logicType: 'DonchianTrend', logic: { indicators: { entryLookback: P.entryLookback } } },
            guardrails: baseGuardrails({}),
            costs: COSTS, symbol: sym, timeframe: tf, lookback: P.pumpWindow + 40,
            exitPolicy: { channelExit: P.channelExit },
          }, decide);
          const pnlPct = res.finalEquity / 10000 - 1;
          const bh = cs[cs.length - 1].close / cs[0].close - 1;
          rows.push({ win, tf, ps: psName, sym, isAlt, pnlPct, mdd: maxDrawdown(res.equityCurve), trades: res.trades.length, bh });
        }
      }
    }
  }
  await db.close();

  const pct = (x) => (x * 100).toFixed(1) + '%';
  console.log('window\ttf\tpset\tsym\tgroup\tpnl\tmaxdd\ttrades\tbh');
  for (const r of rows) {
    if (r.skip) { console.log(`${r.win}\t${r.tf}\t${r.ps}\t${r.sym}\tSKIP`); continue; }
    console.log(`${r.win}\t${r.tf}\t${r.ps}\t${r.sym}\t${r.isAlt ? 'alt' : 'major'}\t${pct(r.pnlPct)}\t${pct(r.mdd)}\t${r.trades}\t${pct(r.bh)}`);
  }

  // Test-year gate per (tf × pset): alts breadth, beats-BH, MaxDD, + majors control.
  // Breadth/beat counts use only alts that actually traded (trades > 0).
  console.log('\n-- TEST-YEAR GATE (alts that traded) + majors control --');
  for (const tf of TFS) for (const psName of Object.keys(PSETS)) {
    const cells = rows.filter(r => !r.skip && r.win === 'test' && r.tf === tf && r.ps === psName);
    const altC = cells.filter(r => r.isAlt && r.trades > 0), majC = cells.filter(r => !r.isAlt && r.trades > 0);
    const posShare = (g) => g.length ? g.filter(r => r.pnlPct > 0).length / g.length : 0;
    const avg = (g) => g.length ? g.reduce((a, r) => a + r.pnlPct, 0) / g.length : 0;
    const beat = altC.filter(r => r.pnlPct > r.bh).length;
    const mddMax = altC.length ? Math.max(...altC.map(r => r.mdd)) : 0;
    console.log(`${tf}\t${psName}\talts(traded ${altC.length}): pos ${(100 * posShare(altC)).toFixed(0)}% avg ${pct(avg(altC))} beatBH ${beat}/${altC.length} worstDD ${pct(mddMax)} | majors(traded ${majC.length}) avg ${pct(avg(majC))}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
