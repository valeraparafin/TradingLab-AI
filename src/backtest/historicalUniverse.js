// src/backtest/historicalUniverse.js
import { scoreUniverse } from '../screener/score.js';

/** UTC date key 'YYYY-MM-DD' from epoch ms. */
export function dayKey(ms) { return new Date(ms).toISOString().slice(0, 10); }

/**
 * Aggregate candles into per-UTC-day stats. Pure.
 * @param {{time:number,open:number,high:number,low:number,close:number,volume:number}[]} candles ascending
 * @returns {{dayKey:string, volatility:number, momentum:number, liquidity:number}[]}
 */
export function dailyStats(candles) {
  const byDay = new Map();
  for (const c of candles) {
    const k = dayKey(c.time);
    let d = byDay.get(k);
    if (!d) { d = { dayKey: k, open: c.open, high: c.high, low: c.low, close: c.close, quoteVol: 0 }; byDay.set(k, d); }
    if (c.high > d.high) d.high = c.high;
    if (c.low < d.low) d.low = c.low;
    d.close = c.close;
    d.quoteVol += c.volume * c.close; // notional approximation
  }
  return [...byDay.values()].map(d => ({
    dayKey: d.dayKey,
    volatility: d.low > 0 ? (d.high - d.low) / d.low : 0,
    momentum: d.open > 0 ? Math.abs(d.close - d.open) / d.open : 0,
    liquidity: d.quoteVol,
  }));
}

/**
 * Rolling daily picks with NO look-ahead: day D's shortlist is scored from each symbol's
 * PRIOR day (D-1) stats. Pure.
 * @param {Record<string, object[]>} symbolCandles symbol → ascending candles
 * @param {object} [opts] passed to scoreUniverse (minLiquidity, denylist, topN, weights)
 * @returns {Record<string, string[]>} dayKey → array of selected symbols
 */
export function buildPicksByDay(symbolCandles, opts = {}) {
  const perSym = {};
  const allDays = new Set();
  for (const [sym, cs] of Object.entries(symbolCandles)) {
    const m = new Map();
    for (const d of dailyStats(cs)) { m.set(d.dayKey, d); allDays.add(d.dayKey); }
    perSym[sym] = m;
  }
  const days = [...allDays].sort();
  const picks = {};
  for (let i = 1; i < days.length; i++) {
    const D = days[i], prev = days[i - 1];
    const rows = [];
    for (const [sym, m] of Object.entries(perSym)) {
      const s = m.get(prev);
      if (s) rows.push({ symbol: sym, volatility: s.volatility, momentum: s.momentum, liquidity: s.liquidity });
    }
    picks[D] = scoreUniverse(rows, opts).map(r => r.symbol);
  }
  return picks;
}
