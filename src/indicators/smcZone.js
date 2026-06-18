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

/**
 * Zone left by the impulse that caused the break. OB = the last opposite-color candle at/before
 * the break bar (down candle for a bullish break, up candle for bearish). FVG = the most recent
 * 3-candle gap in that leg. zoneType selects 'ob' | 'fvg' | 'either' (OB preferred, FVG fallback).
 * Returns { top, bottom } or null. Scan is capped at 50 bars back.
 */
export function buildZone(candles, event, zoneType) {
  const b = event.barIndex;
  const bull = event.direction === 'bullish';
  let ob = null;
  for (let i = b; i >= 1 && b - i < 50; i--) {
    const c = candles[i];
    if (bull ? c.close < c.open : c.close > c.open) { ob = { top: c.high, bottom: c.low }; break; }
  }
  let fvg = null;
  for (let i = b; i >= 2 && b - i < 50; i--) {
    const a = candles[i - 2], c = candles[i];
    if (bull && c.low > a.high) { fvg = { top: c.low, bottom: a.high }; break; }
    if (!bull && c.high < a.low) { fvg = { top: a.low, bottom: c.high }; break; }
  }
  if (zoneType === 'ob') return ob;
  if (zoneType === 'fvg') return fvg;
  return ob || fvg;
}

/**
 * The bias is invalidated if, between the break and the current bar (exclusive), any bar CLOSES
 * beyond the far edge of the zone against the bias - i.e. price has already traded clean through
 * the zone (mitigated). An opposite structural break is handled implicitly by findLatestBreak
 * always returning the latest qualifying event.
 */
export function mitigated(candles, event, zone) {
  const bull = event.direction === 'bullish';
  for (let i = event.barIndex + 1; i < candles.length - 1; i++) {
    const close = candles[i].close;
    if (bull ? close < zone.bottom : close > zone.top) return true;
  }
  return false;
}

const SmcZone = {
  execute(candles, config = {}) {
    const ind = config.indicators || {};
    const pivotLength = pick(ind.pivotLength, ind.pivot_length, 50);
    const zoneType = pick(ind.zoneType, ind.zone_type, 'ob');
    const biasSource = pick(ind.biasSource, ind.bias_source, 'bos_choch');
    const longOnly = pick(ind.longOnly, ind.long_only, false) === true;

    const n = candles.length;
    const hold = { side: 'HOLD', zone: null, biasEvent: null, invalidation: null };
    if (n < pivotLength * 2 + 3) return hold;

    const event = findLatestBreak(candles, pivotLength, biasSource);
    if (!event) return hold;

    const zone = buildZone(candles, event, zoneType);
    if (!zone) return { ...hold, biasEvent: event };

    if (mitigated(candles, event, zone)) return { side: 'HOLD', zone, biasEvent: event, invalidation: null };

    const close = candles[n - 1].close;
    if (close < zone.bottom || close > zone.top) return { side: 'HOLD', zone, biasEvent: event, invalidation: null };

    let side = event.direction === 'bullish' ? 'BUY' : 'SELL';
    if (longOnly && side === 'SELL') return { side: 'HOLD', zone, biasEvent: event, invalidation: null };

    const invalidation = side === 'BUY' ? zone.bottom : zone.top;
    return { side, zone, biasEvent: event, invalidation };
  },
};

export default SmcZone;
