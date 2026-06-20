// Routine signal engine for the DONCHIANTREND 1D + regime sandbox forward-test.
// Reads FRESH daily candles the scheduled task pulled into data/live-candles/{SYM}.json
// (each file = raw invest_get_candles response {candles:[...]}), drops incomplete bars,
// computes the cross-sectional regime + per-name Donchian signal + 200k sizing, prints a
// JSON plan the agent executes against the SANDBOX. No DB, no network. Pure/deterministic.
//
//   node backtest/routine-signals.mjs [candlesDir]   (default data/live-candles)
import fs from 'node:fs';
import path from 'node:path';
import DonchianTrend from '../src/indicators/donchianTrend.js';

const DIR = process.argv[2] || 'data/live-candles';
const TRADE_UNIVERSE = ['SBER','GAZP','LKOH','GMKN','ROSN','NVTK','TATN','MOEX','PLZL','ALRS','CHMF','MAGN','NLMK','SNGS','VTBR'];
const LOT_MAP = {SBER:1,GAZP:10,LKOH:1,GMKN:10,ROSN:1,NVTK:1,TATN:1,MOEX:10,PLZL:1,ALRS:10,CHMF:1,MAGN:10,NLMK:10,SNGS:100,VTBR:1};

const ENTRY_LOOKBACK = 20, REGIME_MA = 200;
const EQUITY = 200000, RISK_PCT = 0.0075, SL_PCT = 0.05, RR = 3, MAX_POS_PCT = 0.20;

const qv = (q) => q == null ? null : (q.value != null ? Number(q.value) : Number(q.units || 0) + Number(q.nano || 0) / 1e9);
const ymd = (t) => new Date(t).toISOString().slice(0, 10);

function loadCandles(sym) {
  const f = path.join(DIR, `${sym}.json`);
  if (!fs.existsSync(f)) return null;
  const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  const arr = (raw.candles || raw).filter((c) => c.isComplete !== false); // drop the in-progress bar
  return arr.map((c) => ({ time: Date.parse(c.time), open: qv(c.open), high: qv(c.high), low: qv(c.low), close: qv(c.close) }))
            .filter((c) => Number.isFinite(c.close)).sort((a, b) => a.time - b.time);
}

function regime(data) {
  const closes = {}; const dateSet = new Set();
  for (const s of Object.keys(data)) { const m = new Map(); for (const c of data[s]) { m.set(ymd(c.time), c.close); dateSet.add(ymd(c.time)); } closes[s] = m; }
  const dates = [...dateSet].sort(); const idx = []; let lvl = 1; const prev = {};
  for (const d of dates) { const r = []; for (const s of Object.keys(closes)) { const c = closes[s].get(d); if (c == null) continue; if (prev[s] > 0) r.push(c / prev[s] - 1); prev[s] = c; } if (r.length) lvl *= 1 + r.reduce((a, b) => a + b, 0) / r.length; idx.push(lvl); }
  const k = dates.length - 1;
  if (k < REGIME_MA) return { on: true, date: dates[k], note: 'warmup' };
  let s = 0; for (let j = k - REGIME_MA + 1; j <= k; j++) s += idx[j];
  return { on: idx[k] >= s / REGIME_MA, date: dates[k], index: +idx[k].toFixed(4), sma: +(s / REGIME_MA).toFixed(4) };
}

const data = {};
for (const s of TRADE_UNIVERSE) { const c = loadCandles(s); if (c && c.length > REGIME_MA + 5) data[s] = c; }
const reg = regime(data);
const riskRub = EQUITY * RISK_PCT;
const picks = [];
for (const sym of TRADE_UNIVERSE) {
  const c = data[sym]; if (!c) continue;
  const sig = DonchianTrend.execute(c, { indicators: { entryLookback: ENTRY_LOOKBACK } });
  if (sig.side === 'HOLD') continue;
  const px = c[c.length - 1].close, lot = LOT_MAP[sym] || 1, dir = sig.side === 'BUY' ? 1 : -1;
  const targetNotional = Math.min(riskRub / SL_PCT, EQUITY * MAX_POS_PCT);
  let lots = Math.max(1, Math.floor(targetNotional / (px * lot)));
  if (lots * lot * px > EQUITY * MAX_POS_PCT) lots = Math.max(1, Math.floor(EQUITY * MAX_POS_PCT / (px * lot)));
  picks.push({ sym, side: sig.side, signalClose: px, lots, shares: lots * lot, indicValue: +(lots * lot * px).toFixed(0),
    slPrice: +(px * (1 - dir * SL_PCT)).toFixed(2), tp1Price: +(px * (1 + dir * SL_PCT)).toFixed(2), tp2Price: +(px * (1 + dir * SL_PCT * RR)).toFixed(2),
    riskRub: +(lots * lot * px * SL_PCT).toFixed(0) });
}
const plan = { asOf: reg.date, regimeOn: reg.on, regime: reg, equity: EQUITY, riskPerTradeRub: riskRub,
  note: 'regime = large-cap (15-name) proxy index vs 200DMA; signalClose is the last COMPLETE daily close — re-price on live orderbook before sizing; SL 5% / TP1 +5% (50%) / TP2 +15%; entries only when regimeOn; both sides but shorts need confirmMarginTrade in risk-on only',
  signals: picks };
console.log(JSON.stringify(plan, null, 2));
