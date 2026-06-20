// backtest/moex-xsectional.mjs
//
// Phase-0 IDEA #1+#2: CROSS-SECTIONAL rank portfolios + OVERNIGHT/INTRADAY decomposition on the
// MOEX daily basket. This is a DIFFERENT BET from everything in moex-walkforward.mjs: not "will THIS
// name go up next bar" (timing, which P2/P3 showed has no candle edge), but "rank the basket and bet
// relative strength" (cross-sectional risk premium) + "is the basket's return hiding in the overnight
// gap" (the overnight-drift anomaly). Neither needs microstructure — daily OHLC we already have.
//
//   node backtest/moex-xsectional.mjs                 # full grid + overnight test
//   node backtest/moex-xsectional.mjs --hold 5        # weekly rebalance
//
// HONESTY RULES (same as the walk-forward):
//  - Calendar-anchored: a name only ranks on dates where it has BOTH the signal lookback AND the
//    forward window — recent IPOs (OZON, POSI, X5...) drop out of early years automatically.
//  - Costs charged on FULL turnover each rebalance (pessimistic; real turnover is lower).
//  - The WHOLE small grid is printed (no cherry-pick); judge by per-YEAR breadth, not the best cell.
//  - Shorts: 40/42 names are shortable (P1 audit) but borrow cost is real & high on MOEX — so we
//    report long-short (gross+net) AND long-only-top-quintile (deployable without shorts).
import path from 'path';
import { openMarketDb } from '../src/data/marketDataSchema.js';

const SYMBOLS = ['AFKS','AFLT','ALRS','BSPB','CBOM','CHMF','CNRU','DOMRF','ENPG','FLOT','GAZP','GMKN','HEAD','IRAO','LENT','LKOH','MAGN','MDMG','MOEX','MSNG','MTSS','NLMK','NVTK','OZON','PHOR','PIKK','PLZL','POSI','RENI','ROSN','RTKM','RUAL','SBER','SNGS','SVCB','T','TATN','TRNFP','UGLD','VKCO','VTBR','X5'];

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const HOLD = Number(arg('--hold', 5));         // rebalance/holding period in trading days (5 = weekly)
const MIN_NAMES = Number(arg('--minNames', 10)); // need at least this many ranked names to trade a date
const Q = Number(arg('--q', 0.2));             // quintile fraction for long/short legs
// Costs: per-SIDE = takerFee + slippage. Round-trip (in+out) = 2x. Charged on full turnover each rebal.
const SIDE_COST = 0.0005 + 0.0010;             // 5bps fee + 10bps slippage = 15bps/side
const ROUND_TRIP = 2 * SIDE_COST;              // 30bps to rotate one name's notional fully

async function loadDaily() {
  const db = await openMarketDb(path.join(process.cwd(), 'market_data.db'));
  const bySym = {}; const dateSet = new Set();
  for (const s of SYMBOLS) {
    const rows = await db.all("SELECT time, open, close FROM candles WHERE symbol=? AND timeframe='1D' ORDER BY time", s);
    if (rows.length < 60) continue;
    const m = new Map();
    for (const r of rows) { const d = new Date(r.time).toISOString().slice(0, 10); m.set(d, r); dateSet.add(d); }
    bySym[s] = m;
  }
  await db.close();
  const dates = [...dateSet].sort();
  return { bySym, dates };
}

// ---- Cross-sectional rank portfolio ----------------------------------------------------------
// signal at date index i: trailing return close[i-skip]/close[i-look] - 1 (momentum); reversal negates.
// enter at close[i], exit at close[i+hold]; non-overlapping (step by hold).
function runXS({ bySym, dates }, { look, skip, hold, reversal }) {
  const syms = Object.keys(bySym);
  const closeAt = (s, d) => { const b = bySym[s].get(d); return b ? b.close : null; };
  const perYear = {}; // year -> {ls:[], lo:[]}
  const allLS = [], allLO = [];
  for (let i = look; i + hold < dates.length; i += hold) {
    const dEntry = dates[i], dLook = dates[i - look], dSkip = dates[i - skip], dExit = dates[i + hold];
    const cand = [];
    for (const s of syms) {
      const cL = closeAt(s, dLook), cS = closeAt(s, dSkip), cE = closeAt(s, dEntry), cX = closeAt(s, dExit);
      if (cL == null || cS == null || cE == null || cX == null || cL <= 0 || cE <= 0) continue;
      let sig = cS / cL - 1; if (reversal) sig = -sig;
      cand.push({ s, sig, fwd: cX / cE - 1 });
    }
    if (cand.length < MIN_NAMES) continue;
    cand.sort((a, b) => b.sig - a.sig);
    const q = Math.max(1, Math.floor(cand.length * Q));
    const longs = cand.slice(0, q), shorts = cand.slice(cand.length - q);
    const mean = (a) => a.reduce((x, y) => x + y.fwd, 0) / a.length;
    const longLeg = mean(longs), shortLeg = mean(shorts), basket = mean(cand);
    // long-short, full-turnover net: rotate both legs (2 round trips per unit gross)
    const lsGross = longLeg - shortLeg;
    const lsNet = lsGross - 2 * ROUND_TRIP;
    // long-only top quintile, market-neutral alpha (vs equal-weight basket), net of one rotation
    const loNet = (longLeg - basket) - ROUND_TRIP;
    const yr = dEntry.slice(0, 4);
    (perYear[yr] ??= { ls: [], lo: [], lsG: [] });
    perYear[yr].ls.push(lsNet); perYear[yr].lo.push(loNet); perYear[yr].lsG.push(lsGross);
    allLS.push(lsNet); allLO.push(loNet);
  }
  return { perYear, allLS, allLO, periodsPerYear: 252 / hold };
}

const sum = (a) => a.reduce((x, y) => x + y, 0);
const mean = (a) => (a.length ? sum(a) / a.length : NaN);
function sharpe(a, ppy) { if (a.length < 2) return NaN; const m = mean(a); const sd = Math.sqrt(mean(a.map(x => (x - m) ** 2))); return sd ? (m / sd) * Math.sqrt(ppy) : NaN; }
const annual = (a, ppy) => mean(a) * ppy; // simple annualization of mean per-period return

function reportXS(label, res) {
  const ppy = res.periodsPerYear;
  const years = Object.keys(res.perYear).sort();
  const lsByYear = years.map(y => sum(res.perYear[y].ls));   // realized net L/S return that calendar year
  const loByYear = years.map(y => sum(res.perYear[y].lo));
  const posLS = lsByYear.filter(x => x > 0).length, posLO = loByYear.filter(x => x > 0).length;
  console.log(`\n── ${label} | ${res.allLS.length} rebalances, ${years.length} yrs, ${ppy.toFixed(0)} rebal/yr ──`);
  console.log('year    L/S net   LongOnly-α');
  for (let k = 0; k < years.length; k++)
    console.log(`${years[k]}  ${(lsByYear[k] * 100).toFixed(1).padStart(7)}%  ${(loByYear[k] * 100).toFixed(1).padStart(8)}%`);
  const allG = years.flatMap(y => res.perYear[y].lsG);
  console.log(`POOLED  L/S: ann ${(annual(res.allLS, ppy) * 100).toFixed(1)}% net / ${(annual(allG, ppy) * 100).toFixed(1)}% GROSS  Sharpe ${sharpe(res.allLS, ppy).toFixed(2)}  yrs+ ${posLS}/${years.length}`);
  console.log(`        LO-α: ann ${(annual(res.allLO, ppy) * 100).toFixed(1)}%  Sharpe ${sharpe(res.allLO, ppy).toFixed(2)}  yrs+ ${posLO}/${years.length}`);
}

// ---- Overnight vs intraday decomposition -----------------------------------------------------
// each name/day: overnight = open[t]/close[t-1]-1 ; intraday = close[t]/open[t]-1.
// equal-weight the basket each day, cumulate. GROSS (capturing either needs daily turnover = costly).
function runOvernight({ bySym, dates }) {
  const syms = Object.keys(bySym);
  const perYear = {}; // year -> {on:[], id:[]}
  let prevClose = {};
  for (const d of dates) {
    const on = [], id = [];
    for (const s of syms) {
      const b = bySym[s].get(d);
      if (b) {
        if (prevClose[s] != null && prevClose[s] > 0 && b.open > 0) on.push(b.open / prevClose[s] - 1);
        if (b.open > 0) id.push(b.close / b.open - 1);
        prevClose[s] = b.close;
      }
    }
    if (!on.length && !id.length) continue;
    const yr = d.slice(0, 4);
    (perYear[yr] ??= { on: [], id: [] });
    if (on.length) perYear[yr].on.push(mean(on));
    if (id.length) perYear[yr].id.push(mean(id));
  }
  return perYear;
}
function reportOvernight(perYear) {
  const years = Object.keys(perYear).sort();
  console.log(`\n══════ OVERNIGHT vs INTRADAY (equal-weight basket, GROSS, daily) ══════`);
  console.log('year   overnight   intraday   (sum of daily mean basket returns)');
  let onAll = [], idAll = [];
  for (const y of years) {
    const on = perYear[y].on, id = perYear[y].id;
    onAll = onAll.concat(on); idAll = idAll.concat(id);
    console.log(`${y}  ${(sum(on) * 100).toFixed(1).padStart(8)}%  ${(sum(id) * 100).toFixed(1).padStart(8)}%`);
  }
  console.log(`POOLED overnight ann ${(annual(onAll, 252) * 100).toFixed(1)}%  Sharpe ${sharpe(onAll, 252).toFixed(2)}`);
  console.log(`       intraday  ann ${(annual(idAll, 252) * 100).toFixed(1)}%  Sharpe ${sharpe(idAll, 252).toFixed(2)}`);
  console.log(`  NOTE: gross. Capturing overnight = buy@close/sell@open daily (~${(ROUND_TRIP*252*100).toFixed(0)}%/yr cost at full size) — read as "where does the return live", not a deployable PnL.`);
}

async function main() {
  const data = await loadDaily();
  console.log(`Loaded ${Object.keys(data.bySym).length} names, ${data.dates.length} trading days ${data.dates[0]}→${data.dates[data.dates.length-1]}`);
  console.log(`HOLD=${HOLD}d, quintile=${Q}, cost ${(SIDE_COST*100).toFixed(2)}%/side (round-trip ${(ROUND_TRIP*100).toFixed(1)}%)`);

  // Small fixed grid — literature-standard windows. Printed in full; judge by per-year breadth.
  const GRID = [
    { name: 'MOM 60-5',  look: 60, skip: 5, hold: HOLD, reversal: false },  // ~3mo momentum, skip 1wk
    { name: 'MOM 120-5', look: 120, skip: 5, hold: HOLD, reversal: false }, // ~6mo momentum
    { name: 'MOM 250-20',look: 250, skip: 20, hold: HOLD, reversal: false },// ~12mo momentum, skip 1mo (classic)
    { name: 'REV 5',     look: 5, skip: 0, hold: HOLD, reversal: true },     // short-term reversal 1wk
    { name: 'REV 20',    look: 20, skip: 0, hold: HOLD, reversal: true },    // reversal 1mo
  ];
  for (const cfg of GRID) reportXS(cfg.name, runXS(data, cfg));

  reportOvernight(runOvernight(data));
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
