// backtest/moex-walkforward.mjs
//
// Phase-0 VALIDATION (P2): calendar-anchored walk-forward for the MOEX equity basket. Unlike
// moex-tune.mjs (one TRAIN/TEST/HOLDOUT split, one cherry-picked champion), this re-selects the
// exit parameters FRESH on each rolling in-sample window and trades the immediately-following
// out-of-sample block, which is never seen during its own selection. The pooled OOS across all
// blocks is what the SELECTION PROCESS actually earns — the honest answer to "is there an edge",
// and the antidote to the single-holdout selection fragility found in P1 (a one-name breadth
// tiebreak flipped the champion; grid holdouts spanned ~1.00-1.4).
//
//   node backtest/moex-walkforward.mjs                 # SMC_ZONE, lots on, 2y IS, 6mo OOS
//   node backtest/moex-walkforward.mjs --isYears 3 --oosMonths 6 --no-lots
//
// Calendar-anchored: blocks are defined by DATE, so a name only contributes to a block where it
// has data in BOTH the IS window and the OOS block (recent IPOs like DOMRF naturally drop out of
// early blocks) — this removes the per-name-fractional misalignment of the single-split harness.
import path from 'path';
import { openMarketDb } from '../src/data/marketDataSchema.js';
import { MarketDataRepo } from '../src/data/MarketDataRepo.js';
import { simulate } from '../src/backtest/simulator.js';
import { computeMetrics } from '../src/backtest/metrics.js';
import { buildGuardrails, buildCosts } from './run-backtest.js';

const SYMBOLS = ['AFKS','AFLT','ALRS','BSPB','CBOM','CHMF','CNRU','DOMRF','ENPG','FLOT','GAZP','GMKN','HEAD','IRAO','LENT','LKOH','MAGN','MDMG','MOEX','MSNG','MTSS','NLMK','NVTK','OZON','PHOR','PIKK','PLZL','POSI','RENI','ROSN','RTKM','RUAL','SBER','SNGS','SVCB','T','TATN','TRNFP','UGLD','VKCO','VTBR','X5'];
const LOT_MAP = {AFKS:100,AFLT:10,ALRS:10,BSPB:10,CBOM:100,CHMF:1,CNRU:1,DOMRF:1,ENPG:1,FLOT:10,GAZP:10,GMKN:10,HEAD:1,IRAO:100,LENT:1,LKOH:1,MAGN:10,MDMG:1,MOEX:10,MSNG:1000,MTSS:10,NLMK:10,NVTK:1,OZON:1,PHOR:1,PIKK:1,PLZL:1,POSI:1,RENI:10,ROSN:1,RTKM:10,RUAL:10,SBER:1,SNGS:100,SVCB:100,T:1,TATN:1,TRNFP:1,UGLD:1000,VKCO:1,VTBR:1,X5:1};

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const TF = arg('--tf', '1H');
const LOGIC = arg('--logic', 'SMC_ZONE').toUpperCase();
const IS_YEARS = Number(arg('--isYears', 2));
const OOS_MONTHS = Number(arg('--oosMonths', 6));
const USE_LOTS = !process.argv.includes('--no-lots');
const LOOKBACK = 250;
const MIN_IS_TRADES = Number(arg('--minTrades', 100));   // pooled IS trades a combo must reach to qualify
const COST = { takerFee: 0.0005, makerFee: 0.0002, slippageBps: 10 };
const BASE_G = { equity: 100000, riskPerTrade: 0.1, leverage: 1, maxOpen: 1 };
const USE_REGIME = process.argv.includes('--regime');    // gate entries on basket index vs its long MA
const REGIME_MA = Number(arg('--regimeMA', 200));        // MA length (in TF bars) for the basket index
let REGIME_FN = null;                                    // (ts)=>bool risk-on mask, built in main() if --regime
// --scaleOut: pre-registered partial-profit rule (bank 50% at 1R, breakeven the rest). a-priori, not swept.
const USE_SCALEOUT = process.argv.includes('--scaleOut');
const EXIT_POLICY = USE_SCALEOUT ? { scaleOut: { atR: 1.0, frac: 0.5, breakeven: true } } : undefined;

// Internal indicator params held at DEFAULTS (no internal sweep — keeps the comparison budget tiny;
// the walk-forward RE-SELECTS only the exit each block). Each logic reads its params from a
// different spot in `logic` (Reversal/ScalpBreakout top-level; TrendPullback/DonchianTrend under
// `indicators`; SMC_ZONE structure fixed at the Stage-1 winner).
const LOGIC_PARAMS = {
  SMC_ZONE: { indicators: { pivotLength: 50, zoneType: 'ob', biasSource: 'bos_choch', longOnly: false } },
  SMC: { indicators: { pivotLength: 50 } },
  BREAKOUT: { length_: 100, length: 14 },
  REVERSAL: { fvg_lookback: 20 },
  TRENDPULLBACK: { indicators: {} },
  DONCHIANTREND: { indicators: { entryLookback: 20 } },
  SCALPBREAKOUT: { lookback: 30, minTouches: 2, touchTol: 0.0015, breakoutMargin: 0.0005, pinchBars: 6, pinchRatio: 0.7 },
};
if (!LOGIC_PARAMS[LOGIC]) throw new Error(`Unknown --logic ${LOGIC}. Known: ${Object.keys(LOGIC_PARAMS).join(', ')}`);
// --longOnly: suppress short entries (logic must honor indicators.longOnly; DONCHIANTREND does).
if (process.argv.includes('--longOnly')) {
  LOGIC_PARAMS[LOGIC].indicators = { ...(LOGIC_PARAMS[LOGIC].indicators || {}), longOnly: true };
}
const SL_GRID = [0.03, 0.04, 0.05, 0.06];
const RR_GRID = [1.5, 2, 2.5, 3];

function buildGrid() {
  const grid = [];
  for (const sl of SL_GRID) for (const rr of RR_GRID)
    grid.push({ name: `pct sl${sl * 100} rr${rr}`,
      guardrails: buildGuardrails({ ...BASE_G, sl, tp: +(sl * rr).toFixed(4), minRR: 1.0 }) });
  return grid;
}

function runSeg(candles, guardrails, lot) {
  const sim = simulate({ candles, config: { logicType: LOGIC, logic: LOGIC_PARAMS[LOGIC] },
    guardrails, costs: buildCosts(COST), symbol: 'X', timeframe: TF, lookback: LOOKBACK,
    startEquity: guardrails.portfolioValue, funding: null, lotSize: USE_LOTS ? (lot || 1) : 0,
    marketRegime: REGIME_FN, exitPolicy: EXIT_POLICY });
  const m = computeMetrics({ trades: sim.trades, equityCurve: sim.equityCurve,
    startEquity: guardrails.portfolioValue, slippageCost: sim.slippageCost, timeframe: TF,
    totalFunding: 0, liquidationCount: 0 });
  return { pf: m.trades.profitFactor, net: m.return.netPnlPct, n: m.trades.count };
}

// Score a combo across the basket on a given per-symbol slice (returns {min,max} index bounds per sym).
function scoreCombo(guardrails, segs) {
  let net = 0, totN = 0, traded = 0, winPF = 0; const pfs = [];
  for (const { candles, lot } of segs) {
    if (candles.length < LOOKBACK + 20) continue;
    const r = runSeg(candles, guardrails, lot);
    net += r.net; totN += r.n;
    if (r.n > 0) { traded++; if (Number.isFinite(r.pf)) pfs.push(r.pf); if (r.pf > 1) winPF++; }
  }
  const med = pfs.length ? [...pfs].sort((a, b) => a - b)[Math.floor(pfs.length / 2)] : NaN;
  return { medPF: med, winPF, traded, breadth: traded ? winPF / traded : 0, avgNet: net / segs.length, n: totN };
}
const rankKey = (s) => (s.n < MIN_IS_TRADES ? -1 : s.breadth * 100 + (Number.isFinite(s.medPF) ? s.medPF : 0));

const MS_DAY = 86400000;
function addMonths(ts, m) { const d = new Date(ts); d.setUTCMonth(d.getUTCMonth() + m); return d.getTime(); }
const ymd = (ts) => new Date(ts).toISOString().slice(0, 10);

// Cross-sectional market-regime mask: an equal-weight basket index (cumulative mean daily return,
// survivorship-neutral — a name contributes only on days it has data) vs its REGIME_MA-bar SMA.
// risk-on(date) = index[date] >= SMA[date]. Trailing SMA on closes up to that date => no look-ahead.
// Warmup bars (< REGIME_MA) admit by default. Returns (ts)=>bool keyed by calendar date.
function buildRegimeMask(data) {
  const closes = {}; const dateSet = new Set();
  for (const sym of Object.keys(data)) {
    const m = new Map();
    for (const c of data[sym]) { const d = ymd(c.time); m.set(d, c.close); dateSet.add(d); }
    closes[sym] = m;
  }
  const dates = [...dateSet].sort();
  const idx = []; let level = 1; const prevClose = {};
  for (const d of dates) {
    const rets = [];
    for (const sym of Object.keys(closes)) {
      const c = closes[sym].get(d);
      if (c == null) continue;
      if (prevClose[sym] != null && prevClose[sym] > 0) rets.push(c / prevClose[sym] - 1);
      prevClose[sym] = c;
    }
    if (rets.length) level *= 1 + rets.reduce((a, b) => a + b, 0) / rets.length;
    idx.push(level);
  }
  const onByDate = new Map();
  for (let k = 0; k < dates.length; k++) {
    if (k < REGIME_MA) { onByDate.set(dates[k], true); continue; }
    let s = 0; for (let j = k - REGIME_MA + 1; j <= k; j++) s += idx[j];
    onByDate.set(dates[k], idx[k] >= s / REGIME_MA);
  }
  const onDays = [...onByDate.values()].filter(Boolean).length;
  console.log(`Regime mask: ${onDays}/${onByDate.size} days risk-ON (${(onDays / onByDate.size * 100).toFixed(0)}%), MA=${REGIME_MA}`);
  return (ts) => { const v = onByDate.get(ymd(ts)); return v == null ? true : v; };
}

async function main() {
  const db = await openMarketDb(path.join(process.cwd(), 'market_data.db'));
  const repo = new MarketDataRepo(db);
  const data = {};
  let tMin = Infinity, tMax = -Infinity;
  for (const sym of SYMBOLS) {
    const c = await repo.getCandles(sym, TF, 0, Number.MAX_SAFE_INTEGER);
    if (c.length < LOOKBACK + 50) continue;
    data[sym] = c;
    tMin = Math.min(tMin, c[0].time); tMax = Math.max(tMax, c[c.length - 1].time);
  }
  if (USE_REGIME) REGIME_FN = buildRegimeMask(data);
  // index helpers
  const idxFrom = (c, ts) => { let i = c.findIndex((x) => x.time >= ts); return i < 0 ? c.length : i; };

  // FROZEN-HOLDOUT mode (--freezeFrom YYYY-MM-DD): the strictest test. Select the exit ONCE on the
  // trailing IS_YEARS before the cutoff, LOCK it, then trade the entire post-cutoff tail as one
  // sealed block with that frozen config (+ regime gate if --regime). No per-block re-selection —
  // nothing about the holdout influences any choice. This is what a deployed bot would actually earn.
  const FREEZE_FROM = arg('--freezeFrom', null);
  if (FREEZE_FROM) {
    const freezeTs = new Date(FREEZE_FROM + 'T00:00:00Z').getTime();
    const isStart = addMonths(freezeTs, -IS_YEARS * 12);
    const isSegs = [], hoSegs = [];
    for (const sym of Object.keys(data)) {
      const c = data[sym], lot = LOT_MAP[sym] || 1;
      const isA = idxFrom(c, isStart), isB = idxFrom(c, freezeTs);
      if (isB - isA > LOOKBACK + 20) isSegs.push({ candles: c.slice(isA, isB), lot });
      if (c.length - isB > 5) hoSegs.push({ candles: c.slice(Math.max(0, isB - LOOKBACK)), lot });
    }
    const grid = buildGrid();
    let best = null, bestS = null;
    for (const g of grid) { const s = scoreCombo(g.guardrails, isSegs); if (!best || rankKey(s) > rankKey(bestS)) { best = g; bestS = s; } }
    const h = scoreCombo(best.guardrails, hoSegs);
    const pf = (x) => (Number.isFinite(x) ? x.toFixed(2) : 'n/a');
    console.log(`\nFROZEN HOLDOUT ${LOGIC} @ ${TF} | regime ${USE_REGIME ? 'ON' : 'off'} | lots ${USE_LOTS ? 'ON' : 'OFF'}`);
    console.log(`  IS (selection): ${ymd(isStart)}→${FREEZE_FROM}, ${isSegs.length} names — frozen combo: ${best.name}  (IS medPF ${pf(bestS.medPF)}, breadth ${(bestS.breadth * 100).toFixed(0)}%)`);
    console.log(`  HOLDOUT (sealed): ${FREEZE_FROM}→${ymd(tMax)}, ${hoSegs.length} names`);
    console.log(`  ⇒ medPF ${pf(h.medPF)} | breadth ${h.winPF}/${h.traded} (${(h.breadth * 100).toFixed(0)}%) | avgNet ${(h.avgNet * 100).toFixed(2)}% | trades ${h.n}`);
    await db.close();
    return;
  }

  // First OOS block starts IS_YEARS after the global start; roll OOS_MONTHS at a time to the end.
  let oosStart = addMonths(tMin, IS_YEARS * 12);
  const blocks = [];
  while (oosStart < tMax) { blocks.push([oosStart, addMonths(oosStart, OOS_MONTHS)]); oosStart = addMonths(oosStart, OOS_MONTHS); }

  console.log(`\nWALK-FORWARD ${LOGIC} @ ${TF} | IS ${IS_YEARS}y rolling, OOS ${OOS_MONTHS}mo | lots ${USE_LOTS ? 'ON' : 'OFF'}`);
  console.log(`internal params at defaults; re-select exit (${buildGrid().length} combos) each block; ${blocks.length} OOS blocks ${ymd(tMin)}→${ymd(tMax)}\n`);
  console.log('OOS block            winner            IS(medPF/br)   OOS medPF  breadth      avgNet   n');

  const grid = buildGrid();
  const oosNets = [], oosPFs = []; let oosWinBlocks = 0, oosTotN = 0;
  const isStartMs = (oe) => addMonths(oe, -IS_YEARS * 12); // rolling IS = trailing IS_YEARS before OOS start

  for (const [os, oe] of blocks) {
    const isStart = isStartMs(os);
    const isSegs = [], oosSegs = [];
    for (const sym of Object.keys(data)) {
      const c = data[sym], lot = LOT_MAP[sym] || 1;
      const isA = idxFrom(c, isStart), isB = idxFrom(c, os);
      if (isB - isA > LOOKBACK + 20) isSegs.push({ candles: c.slice(isA, isB), lot });
      const ob = idxFrom(c, oe);
      if (ob - isB > 5) oosSegs.push({ candles: c.slice(Math.max(0, isB - LOOKBACK), ob), lot });
    }
    if (!isSegs.length || !oosSegs.length) continue;
    // select on IS
    let best = null, bestS = null;
    for (const g of grid) { const s = scoreCombo(g.guardrails, isSegs); if (!best || rankKey(s) > rankKey(bestS)) { best = g; bestS = s; } }
    // trade OOS with the IS-selected combo
    const o = scoreCombo(best.guardrails, oosSegs);
    oosNets.push(o.avgNet); if (Number.isFinite(o.medPF)) oosPFs.push(o.medPF); if (o.medPF > 1) oosWinBlocks++; oosTotN += o.n;
    const pf = (x) => (Number.isFinite(x) ? x.toFixed(2) : 'n/a');
    console.log(`${ymd(os)}→${ymd(oe)}  ${best.name.padEnd(16)}  ${pf(bestS.medPF)}/${(bestS.breadth * 100).toFixed(0)}%`.padEnd(58) +
      `  ${pf(o.medPF).padEnd(8)} ${String(o.winPF).padStart(2)}/${o.traded} (${(o.breadth * 100).toFixed(0)}%)  ${(o.avgNet * 100).toFixed(1).padStart(6)}%  ${o.n}`);
  }

  const medOf = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : NaN);
  const sumNet = oosNets.reduce((a, b) => a + b, 0);
  console.log(`\n══════ POOLED WALK-FORWARD OOS (${oosPFs.length} scored blocks) ══════`);
  console.log(`  median block medPF ${medOf(oosPFs).toFixed(2)} | blocks PF>1: ${oosWinBlocks}/${oosPFs.length} (${(oosWinBlocks / oosPFs.length * 100).toFixed(0)}%)`);
  console.log(`  summed OOS avgNet ${(sumNet * 100).toFixed(1)}% across blocks | mean block ${(sumNet / oosNets.length * 100).toFixed(2)}% | total OOS trades ${oosTotN}`);
  await db.close();
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
