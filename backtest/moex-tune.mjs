// backtest/moex-tune.mjs
//
// Phase 0 parameter tuning: calibrate ONE global parameter set per (indicator, timeframe)
// to the MOEX equity universe — NOT per-instrument (per-name PF is noise, Spearman≈0.06).
// Pure offline research on MOEX ISS candles already in market_data.db.
//
//   node backtest/moex-tune.mjs --logic SMC --tf 1H            # search (train→test)
//   node backtest/moex-tune.mjs --logic SMC --tf 1H --holdout  # also touch the frozen holdout (champion only)
//
// Anti-overfit protocol (3-way temporal split per symbol, warmup carried across boundaries):
//   TRAIN  [0 .. 50%)   — calibrate: every grid combo is scored here, across ALL names pooled.
//   TEST   [50% .. 75%) — select:    only the TRAIN top-K combos are re-scored here.
//   HOLD   [75% .. 100%]— frozen:     touched ONCE, by the single TEST-best combo, only with --holdout.
// The TRAIN→TEST gap measures overfit; a champion that also holds on HOLD is a real MOEX calibration.
//
// Objective is robust by design (not max PF, which cherry-picks one regime): rank by BREADTH
// (% of traded names with PF>1) then median per-name PF, gated by a minimum total-trade count so
// a combo that only fires a handful of times can't win on luck.
import path from 'path';
import { openMarketDb } from '../src/data/marketDataSchema.js';
import { MarketDataRepo } from '../src/data/MarketDataRepo.js';
import { simulate } from '../src/backtest/simulator.js';
import { computeMetrics } from '../src/backtest/metrics.js';
import { buildGuardrails, buildCosts } from './run-backtest.js';

const SYMBOLS = [
  'AFKS', 'AFLT', 'ALRS', 'BSPB', 'CBOM', 'CHMF', 'CNRU', 'DOMRF', 'ENPG', 'FLOT',
  'GAZP', 'GMKN', 'HEAD', 'IRAO', 'LENT', 'LKOH', 'MAGN', 'MDMG', 'MOEX', 'MSNG',
  'MTSS', 'NLMK', 'NVTK', 'OZON', 'PHOR', 'PIKK', 'PLZL', 'POSI', 'RENI', 'ROSN',
  'RTKM', 'RUAL', 'SBER', 'SNGS', 'SVCB', 'T', 'TATN', 'TRNFP', 'UGLD', 'VKCO',
  'VTBR', 'X5',
];

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const LOGIC = (arg('--logic', 'SMC')).toUpperCase();
const TF = arg('--tf', '1H');
const STAGE = arg('--stage', 'structure'); // 'structure' | 'exit'
// Stage-2 fixes the structure via these flags (taken from the Stage-1 winner):
const FIX_PIVOT = Number(arg('--pivot', 50));
const FIX_ZONE = arg('--zone', 'ob');
const FIX_BIAS = arg('--bias', 'bos_choch');
const FIX_LONGONLY = process.argv.includes('--longOnly');
const USE_HOLDOUT = process.argv.includes('--holdout');
const TOP_K = Number(arg('--top', 6));
const LOOKBACK = 250;
const MIN_TRADES = Number(arg('--minTrades', 150)); // pooled OOS trades a combo must reach to qualify

// Temporal split fractions (per symbol, by bar index).
const TRAIN_END = 0.50;
const TEST_END = 0.75;

const COST_ARGS = { takerFee: 0.0005, makerFee: 0.0002, slippageBps: 10 };
const BASE_G = { equity: 100000, riskPerTrade: 0.1, leverage: 1, maxOpen: 1 };

// MOEX share lots (from T-Bank invest_list_shares). With --lots the sim rounds each entry down
// to a whole-lot quantity at the fill price (realistic execution); without it, legacy fractional.
const LOT_MAP = {
  AFKS: 100, AFLT: 10, ALRS: 10, BSPB: 10, CBOM: 100, CHMF: 1, CNRU: 1, DOMRF: 1, ENPG: 1, FLOT: 10,
  GAZP: 10, GMKN: 10, HEAD: 1, IRAO: 100, LENT: 1, LKOH: 1, MAGN: 10, MDMG: 1, MOEX: 10, MSNG: 1000,
  MTSS: 10, NLMK: 10, NVTK: 1, OZON: 1, PHOR: 1, PIKK: 1, PLZL: 1, POSI: 1, RENI: 10, ROSN: 1,
  RTKM: 10, RUAL: 10, SBER: 1, SNGS: 100, SVCB: 100, T: 1, TATN: 1, TRNFP: 1, UGLD: 1000, VKCO: 1,
  VTBR: 1, X5: 1,
};
const USE_LOTS = process.argv.includes('--lots');

const SL_GRID = [0.03, 0.04, 0.05, 0.06];
const RR_GRID = [1.5, 2, 2.5, 3];

/** Build the grid of { name, logicType, logic, guardrails } for the chosen LOGIC. */
function buildGrid() {
  const grid = [];
  const exit = (sl, rr) => buildGuardrails({ ...BASE_G, sl, tp: +(sl * rr).toFixed(4), minRR: 1.0 });

  if (LOGIC === 'SMC') {
    for (const pivot of [20, 30, 50, 75]) {
      for (const sl of SL_GRID) for (const rr of RR_GRID) {
        grid.push({
          name: `piv${pivot} sl${sl * 100} rr${rr}`,
          logicType: 'SMC',
          logic: { indicators: { pivotLength: pivot } },
          guardrails: exit(sl, rr),
        });
      }
    }
  } else if (LOGIC === 'BREAKOUT') {
    // Breakout reads params at the TOP level of `logic` (config.length_), not under `indicators`.
    for (const len of [50, 100, 150]) {
      for (const sl of SL_GRID) for (const rr of RR_GRID) {
        grid.push({
          name: `len${len} sl${sl * 100} rr${rr}`,
          logicType: 'Breakout',
          logic: { length_: len, length: 14 },
          guardrails: exit(sl, rr),
        });
      }
    }
  } else if (LOGIC === 'VMC_CIPHERB') {
    // 7 internal params kept at template defaults (sweeping them blows up the comparison budget);
    // only the exit geometry is tuned, to see if the default VMC signal has any edge on equities.
    for (const sl of SL_GRID) for (const rr of RR_GRID) {
      grid.push({
        name: `default sl${sl * 100} rr${rr}`,
        logicType: 'VMC_CipherB',
        logic: { indicators: {} },
        guardrails: exit(sl, rr),
      });
    }
  } else if (LOGIC === 'SMC_ZONE') {
    const mk = (name, ind, g) => grid.push({ name, logicType: 'SMC_ZONE', logic: { indicators: ind }, guardrails: g });
    if (STAGE === 'structure') {
      // Fixed exit: percent SL 5% / RR 2. Sweep pivot × zone × bias × longOnly.
      const g = exit(0.05, 2);
      for (const pivot of [20, 30, 50, 75])
        for (const zone of ['ob', 'fvg', 'either'])
          for (const bias of ['choch', 'bos_choch'])
            for (const lo of [false, true])
              mk(`piv${pivot} ${zone} ${bias}${lo ? ' LO' : ''}`,
                 { pivotLength: pivot, zoneType: zone, biasSource: bias, longOnly: lo }, g);
    } else {
      // Fixed structure (from --pivot/--zone/--bias/--longOnly). Sweep both stop modes × RR.
      const ind = { pivotLength: FIX_PIVOT, zoneType: FIX_ZONE, biasSource: FIX_BIAS, longOnly: FIX_LONGONLY };
      for (const sl of SL_GRID) for (const rr of RR_GRID)
        mk(`pct sl${sl * 100} rr${rr}`, ind, exit(sl, rr));
      for (const rr of RR_GRID)
        mk(`struct rr${rr}`, ind, buildGuardrails({ ...BASE_G, sl: 0.05, tp: 0.10, minRR: 0, stopMode: 'structural', structuralRR: rr }));
    }
  } else {
    throw new Error(`Unsupported --logic ${LOGIC} (use SMC | BREAKOUT | VMC_CIPHERB | SMC_ZONE)`);
  }
  return grid;
}

function runSeg(candles, cfg, lot = 1) {
  const sim = simulate({
    candles,
    config: { logicType: cfg.logicType, logic: cfg.logic },
    guardrails: cfg.guardrails,
    costs: buildCosts(COST_ARGS),
    symbol: 'X',
    timeframe: TF,
    lookback: LOOKBACK,
    startEquity: cfg.guardrails.portfolioValue,
    funding: null,
    lotSize: USE_LOTS ? (lot || 1) : 0,
  });
  const m = computeMetrics({
    trades: sim.trades,
    equityCurve: sim.equityCurve,
    startEquity: cfg.guardrails.portfolioValue,
    slippageCost: sim.slippageCost,
    timeframe: TF,
    totalFunding: 0,
    liquidationCount: 0,
  });
  return { pf: m.trades.profitFactor, net: m.return.netPnlPct, n: m.trades.count };
}

/** Score one combo across the whole basket on a given segment slice-fn. Returns aggregate stats. */
function scoreCombo(cfg, perSymbolBars) {
  let net = 0, totN = 0, tradedSyms = 0, winPF = 0;
  const pfs = [];
  for (const { sym, candles } of perSymbolBars) {
    if (candles.length < LOOKBACK + 30) continue;
    const r = runSeg(candles, cfg, LOT_MAP[sym] || 1);
    net += r.net; totN += r.n;
    if (r.n > 0) { tradedSyms++; if (Number.isFinite(r.pf)) pfs.push(r.pf); if (r.pf > 1) winPF++; }
  }
  const med = pfs.length ? [...pfs].sort((a, b) => a - b)[Math.floor(pfs.length / 2)] : NaN;
  return { avgNet: net / SYMBOLS.length, totN, tradedSyms, winPF, medPF: med,
    breadth: tradedSyms ? winPF / tradedSyms : 0 };
}

// Rank: qualify on min pooled trades, then breadth desc, then median PF desc.
function rankKey(s) { return s.totN < MIN_TRADES ? -1 : s.breadth * 100 + (Number.isFinite(s.medPF) ? s.medPF : 0); }

const fmtPf = (x) => (x === Infinity ? '∞' : Number.isFinite(x) ? x.toFixed(2) : 'n/a');
const pct = (x) => (x * 100).toFixed(1) + '%';
const line = (name, s) => `${name.padEnd(22)} medPF ${fmtPf(s.medPF).padEnd(6)} breadth ${String(s.winPF).padStart(2)}/${s.tradedSyms} (${(s.breadth * 100).toFixed(0)}%)  avgNet ${pct(s.avgNet).padStart(7)}  n=${s.totN}`;

async function main() {
  const db = await openMarketDb(path.join(process.cwd(), 'market_data.db'));
  const repo = new MarketDataRepo(db);

  // Pre-slice every symbol into the three temporal segments once.
  const train = [], test = [], hold = [];
  let used = 0;
  for (const sym of SYMBOLS) {
    const c = await repo.getCandles(sym, TF, 0, Number.MAX_SAFE_INTEGER);
    if (c.length < LOOKBACK + 100) { continue; }
    used++;
    const iTrain = Math.floor(c.length * TRAIN_END);
    const iTest = Math.floor(c.length * TEST_END);
    train.push({ sym, candles: c.slice(0, iTrain) });
    test.push({ sym, candles: c.slice(Math.max(0, iTrain - LOOKBACK), iTest) });
    hold.push({ sym, candles: c.slice(Math.max(0, iTest - LOOKBACK)) });
  }

  const grid = buildGrid();
  console.log(`\n${LOGIC} @ ${TF} — ${grid.length} combos × ${used} names. Split 50/25/25. minTrades=${MIN_TRADES}.`);

  // 1) Calibrate on TRAIN.
  const scored = grid.map((cfg) => ({ cfg, train: scoreCombo(cfg, train) }));
  scored.sort((a, b) => rankKey(b.train) - rankKey(a.train));

  console.log(`\n──── TRAIN top ${TOP_K} (calibration) ────`);
  const top = scored.slice(0, TOP_K);
  for (const s of top) console.log(line(s.cfg.name, s.train));

  // 2) Select on TEST — re-score only the TRAIN winners.
  console.log(`\n──── same combos on TEST (out-of-sample selection) ────`);
  for (const s of top) s.test = scoreCombo(s.cfg, test);
  top.sort((a, b) => rankKey(b.test) - rankKey(a.test));
  for (const s of top) console.log(line(s.cfg.name, s.test));

  const champ = top[0];
  console.log(`\nTEST-best (champion): ${champ.cfg.name}`);
  console.log(`  TRAIN ${line('', champ.train).trim()}`);
  console.log(`  TEST  ${line('', champ.test).trim()}`);

  // 3) Frozen holdout — touched once, champion only, opt-in.
  if (USE_HOLDOUT) {
    const h = scoreCombo(champ.cfg, hold);
    console.log(`\n══════ FROZEN HOLDOUT (final, ${champ.cfg.name}) ══════`);
    console.log(`  ${line('', h).trim()}`);
  } else {
    console.log(`\n(holdout NOT touched — re-run with --holdout once you trust the champion)`);
  }
  await db.close();
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
