// Live signal + sizing snapshot for the deployable DONCHIANTREND 1D + regime system.
// Reads the SAME market_data.db the frozen holdout validated on, so signals match the backtest.
// Regime index built on the full validated 42-name basket; trades a liquid 15-name subset.
// Sizing for a 200k RUB book: risk 0.75%/trade, 5% stop, scale-out TP, no leverage. Pure read-only.
import path from 'path';
import { openMarketDb } from '../src/data/marketDataSchema.js';
import { MarketDataRepo } from '../src/data/MarketDataRepo.js';
import DonchianTrend from '../src/indicators/donchianTrend.js';

const SYMBOLS = ['AFKS','AFLT','ALRS','BSPB','CBOM','CHMF','CNRU','DOMRF','ENPG','FLOT','GAZP','GMKN','HEAD','IRAO','LENT','LKOH','MAGN','MDMG','MOEX','MSNG','MTSS','NLMK','NVTK','OZON','PHOR','PIKK','PLZL','POSI','RENI','ROSN','RTKM','RUAL','SBER','SNGS','SVCB','T','TATN','TRNFP','UGLD','VKCO','VTBR','X5'];
const LOT_MAP = {AFKS:100,AFLT:10,ALRS:10,BSPB:10,CBOM:100,CHMF:1,CNRU:1,DOMRF:1,ENPG:1,FLOT:10,GAZP:10,GMKN:10,HEAD:1,IRAO:100,LENT:1,LKOH:1,MAGN:10,MDMG:1,MOEX:10,MSNG:1000,MTSS:10,NLMK:10,NVTK:1,OZON:1,PHOR:1,PIKK:1,PLZL:1,POSI:1,RENI:10,ROSN:1,RTKM:10,RUAL:10,SBER:1,SNGS:100,SVCB:100,T:1,TATN:1,TRNFP:1,UGLD:1000,VKCO:1,VTBR:1,X5:1};
const TRADE_UNIVERSE = ['SBER','GAZP','LKOH','GMKN','ROSN','NVTK','TATN','MOEX','PLZL','ALRS','CHMF','MAGN','NLMK','SNGS','VTBR'];

const TF = '1D';
const ENTRY_LOOKBACK = 20;
const REGIME_MA = 200;
const EQUITY = 200000;
const RISK_PCT = 0.0075;      // 0.75% of equity risked per trade
const SL_PCT = 0.05;          // 5% hard stop
const RR = 3;                 // TP target = 3R = 15%
const SCALE_AT_R = 1;         // bank 50% at +1R (=+5%)
const SCALE_FRAC = 0.5;
const MAX_POS_PCT = 0.20;     // cap any single position at 20% of equity
const MAX_GROSS_PCT = 1.0;    // no leverage

const ymd = (ts) => new Date(ts).toISOString().slice(0, 10);

function buildRegime(data) {
  const closes = {}; const dateSet = new Set();
  for (const sym of Object.keys(data)) { const m = new Map(); for (const c of data[sym]) { const d = ymd(c.time); m.set(d, c.close); dateSet.add(d); } closes[sym] = m; }
  const dates = [...dateSet].sort();
  const idx = []; let level = 1; const prev = {};
  for (const d of dates) {
    const rets = [];
    for (const sym of Object.keys(closes)) { const c = closes[sym].get(d); if (c == null) continue; if (prev[sym] > 0) rets.push(c / prev[sym] - 1); prev[sym] = c; }
    if (rets.length) level *= 1 + rets.reduce((a, b) => a + b, 0) / rets.length;
    idx.push(level);
  }
  const k = dates.length - 1;
  if (k < REGIME_MA) return { on: true, date: dates[k], note: 'warmup' };
  let s = 0; for (let j = k - REGIME_MA + 1; j <= k; j++) s += idx[j];
  const sma = s / REGIME_MA;
  return { on: idx[k] >= sma, date: dates[k], index: idx[k], sma };
}

async function main() {
  const db = await openMarketDb(path.join(process.cwd(), 'market_data.db'));
  const repo = new MarketDataRepo(db);
  const data = {};
  for (const sym of SYMBOLS) { const c = await repo.getCandles(sym, TF, 0, Number.MAX_SAFE_INTEGER); if (c.length > REGIME_MA + 5) data[sym] = c; }

  const reg = buildRegime(data);
  console.log(`\nREGIME (42-name basket index vs ${REGIME_MA}DMA) @ ${reg.date}: ${reg.on ? 'RISK-ON ✓ (entries allowed)' : 'RISK-OFF ✗ (no new entries — sit flat)'}`);
  if (reg.index) console.log(`  index ${reg.index.toFixed(4)} vs SMA ${reg.sma.toFixed(4)}  (${((reg.index/reg.sma-1)*100).toFixed(1)}% ${reg.index>=reg.sma?'above':'below'})`);

  const riskRub = EQUITY * RISK_PCT;
  console.log(`\nEquity ${EQUITY} | risk/trade ${(RISK_PCT*100).toFixed(2)}% = ${riskRub}₽ | SL ${SL_PCT*100}% | target ${SL_PCT*RR*100}% | scale ${SCALE_FRAC*100}% @ ${SCALE_AT_R}R`);
  console.log('\nSYM    last      signal  chUpper   chLower    lots  shares  value₽   risk₽   SL        TP1(+5%)  TP2(+15%)');
  const picks = [];
  for (const sym of TRADE_UNIVERSE) {
    const c = data[sym]; if (!c) { console.log(`${sym.padEnd(6)} (no data)`); continue; }
    const r = DonchianTrend.execute(c, { indicators: { entryLookback: ENTRY_LOOKBACK } });
    const last = c[c.length - 1];
    if (r.side === 'HOLD') { console.log(`${sym.padEnd(6)} ${String(last.close).padEnd(9)} HOLD`); continue; }
    if (!reg.on) { console.log(`${sym.padEnd(6)} ${String(last.close).padEnd(9)} ${r.side} (blocked: risk-off)`); continue; }
    const lot = LOT_MAP[sym] || 1;
    const px = last.close;
    const targetNotional = Math.min(riskRub / SL_PCT, EQUITY * MAX_POS_PCT);
    let numLots = Math.floor(targetNotional / (px * lot));
    if (numLots < 1) numLots = 1; // at least one lot if it fits later cap
    let shares = numLots * lot;
    let value = shares * px;
    if (value > EQUITY * MAX_POS_PCT) { numLots = Math.max(1, Math.floor(EQUITY * MAX_POS_PCT / (px * lot))); shares = numLots * lot; value = shares * px; }
    const dir = r.side === 'BUY' ? 1 : -1;
    const sl = px * (1 - dir * SL_PCT);
    const tp1 = px * (1 + dir * SL_PCT);        // +1R
    const tp2 = px * (1 + dir * SL_PCT * RR);   // +3R
    const riskAtStop = shares * px * SL_PCT;
    picks.push({ sym, side: r.side, px, lot, numLots, shares, value, sl, tp1, tp2, riskAtStop });
    console.log(`${sym.padEnd(6)} ${String(px).padEnd(9)} ${r.side.padEnd(6)}  ${String(r.upper?.toFixed(2)).padEnd(8)} ${String(r.lower?.toFixed(2)).padEnd(9)} ${String(numLots).padStart(5)}  ${String(shares).padStart(6)}  ${value.toFixed(0).padStart(7)} ${riskAtStop.toFixed(0).padStart(6)}  ${sl.toFixed(2).padStart(8)}  ${tp1.toFixed(2).padStart(8)}  ${tp2.toFixed(2).padStart(8)}`);
  }
  // exposure check
  let gross = picks.reduce((s, p) => s + p.value, 0);
  console.log(`\nCandidates: ${picks.length} | gross exposure ${gross.toFixed(0)}₽ (${(gross/EQUITY*100).toFixed(0)}% of equity) | total risk-at-stop ${picks.reduce((s,p)=>s+p.riskAtStop,0).toFixed(0)}₽`);
  if (gross > EQUITY * MAX_GROSS_PCT) console.log(`  ⚠ gross > ${MAX_GROSS_PCT*100}% — would trim lowest-conviction names to fit no-leverage cap`);
  console.log(`\nLast data date: ${ymd(data.SBER.at(-1).time)} (db). Refresh last 1-2 bars from API before live placement.`);
  await db.close();
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
