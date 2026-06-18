// Canonical SMC retracement-entry detector. Pure function of the decision window:
// a structural break (BOS/CHoCH) sets bias, then price must pull back into the originating
// OB/FVG zone before entry. No state is carried between bars. See spec
// docs/superpowers/specs/2026-06-18-smc-zone-entry-design.md.
import { findPivots } from './pivots.js';

const pick = (...vals) => vals.find((v) => v !== undefined && v !== null);

/**
 * Most recent structural break in the window. Walks bars left to right, tracking the latest
 * CONFIRMED pivot (a pivot at index p is only usable once p+length bars exist - no look-ahead).
 * A close above the last confirmed pivot-high is a bullish break; below the last pivot-low,
 * bearish. type is CHoCH when it reverses the prior trend, else BOS. Returns the latest event
 * matching biasSource ('choch' = only CHoCH; 'bos_choch' = any), or null.
 */
export function findLatestBreak(candles, pivotLength, biasSource) {
  const piv = findPivots(candles, pivotLength);
  const highs = piv.high, lows = piv.low;
  let trend = 0, lastHigh = null, lastLow = null, hi = 0, lo = 0;
  const breaks = [];
  for (let i = 0; i < candles.length; i++) {
    while (hi < highs.length && highs[hi].index + pivotLength <= i) { lastHigh = highs[hi].price; hi++; }
    while (lo < lows.length && lows[lo].index + pivotLength <= i) { lastLow = lows[lo].price; lo++; }
    const close = candles[i].close;
    if (lastHigh != null && close > lastHigh) {
      breaks.push({ direction: 'bullish', barIndex: i, type: trend === -1 ? 'CHoCH' : 'BOS', level: lastHigh });
      trend = 1; lastHigh = null;
    } else if (lastLow != null && close < lastLow) {
      breaks.push({ direction: 'bearish', barIndex: i, type: trend === 1 ? 'CHoCH' : 'BOS', level: lastLow });
      trend = -1; lastLow = null;
    }
  }
  const ok = (b) => (biasSource === 'choch' ? b.type === 'CHoCH' : true);
  for (let k = breaks.length - 1; k >= 0; k--) if (ok(breaks[k])) return breaks[k];
  return null;
}
