// src/core/aggregateHTF.js

/** Modal (most frequent) positive delta between consecutive candle times, in ms. */
function inferStepMs(candles) {
  const counts = new Map();
  for (let i = 1; i < candles.length; i++) {
    const d = candles[i].time - candles[i - 1].time;
    if (d > 0) counts.set(d, (counts.get(d) || 0) + 1);
  }
  let best = 0, bestN = -1;
  // On a tie, first-seen delta wins (Map insertion order) — deterministic.
  for (const [d, n] of counts) if (n > bestN) { bestN = n; best = d; }
  return best;
}

const startBar = (time, c) => ({
  time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume || 0,
});
const extendBar = (bar, c) => {
  if (c.high > bar.high) bar.high = c.high;
  if (c.low < bar.low) bar.low = c.low;
  bar.close = c.close;
  bar.volume += c.volume || 0;
};

/**
 * Resample ascending LTF candles into higher-timeframe candles.
 * Calendar-aligned (buckets keyed by floor(time/htfMs)*htfMs) and CLOSED-ONLY:
 * the final, still-forming bucket is intentionally excluded (no repaint/look-ahead).
 *
 * Precondition: `candles` MUST be ascending by time. Not enforced — matching the
 * simulate() convention; the sole caller (MarketDataRepo.getCandles) is ORDER BY
 * time ASC. Out-of-order input yields undefined output.
 *
 * @param {import('./contracts.js').Candle[]} candles ascending by time
 * @param {number} ratio LTF→HTF multiple (e.g. 4 for 1H→4H). Rounded to nearest
 *   integer >= 1; ratio=1 is valid (returns LTF candles minus the final open bucket).
 * @returns {import('./contracts.js').Candle[]} closed HTF candles, ascending
 */
export function aggregateHTF(candles, ratio) {
  if (!Array.isArray(candles) || candles.length < 2) return [];
  const r = Math.round(ratio);
  if (!(r >= 1)) return [];
  const ltfMs = inferStepMs(candles);
  if (!(ltfMs > 0)) return [];
  const htfMs = r * ltfMs;

  const out = [];
  let cur = null, curKey = null;
  for (const c of candles) {
    const key = Math.floor(c.time / htfMs) * htfMs;
    if (curKey === null) { curKey = key; cur = startBar(key, c); continue; }
    if (key === curKey) { extendBar(cur, c); continue; }
    out.push(cur);          // a later bucket started → current bucket is closed
    curKey = key;
    cur = startBar(key, c);
  }
  // `cur` is the final, possibly-open bucket → dropped (closed-only).
  return out;
}
