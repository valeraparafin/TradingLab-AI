// src/backtest/exitPolicy.js
/**
 * Breakeven stop move. R = |entryPrice - initialSlPrice|. Once the bar's favorable
 * excursion reaches entry ± breakevenR*R, return the stop moved to entryPrice; otherwise
 * return the current slPrice unchanged. Profit-only (never widens the stop) and pure — the
 * caller is responsible for applying it once (one-shot flag) so it does not re-fire.
 *
 * @param {{side:'BUY'|'SELL', entryPrice:number, initialSlPrice:number, slPrice:number}} position
 * @param {{high:number, low:number}} bar
 * @param {number} breakevenR R-multiple that triggers the move (e.g. 1)
 * @returns {number} the (possibly moved) stop price
 */
export function breakevenStop(position, bar, breakevenR) {
  const R = Math.abs(position.entryPrice - position.initialSlPrice);
  if (!(R > 0) || !(breakevenR > 0)) return position.slPrice;
  if (position.side === 'BUY') {
    if (bar.high >= position.entryPrice + breakevenR * R) {
      return Math.max(position.slPrice, position.entryPrice);
    }
  } else {
    if (bar.low <= position.entryPrice - breakevenR * R) {
      return Math.min(position.slPrice, position.entryPrice);
    }
  }
  return position.slPrice;
}

/**
 * Donchian channel trailing stop. Ratchets the stop toward price by the opposite M-bar
 * extreme of the supplied window: BUY → up to the lowest low (never lowers); SELL → down to
 * the highest high (never raises). Pure; the caller decides the window and applies it once
 * per bar AFTER the exit check (so it only binds on subsequent bars).
 *
 * @param {{side:'BUY'|'SELL', slPrice:number}} position
 * @param {{high:number, low:number}[]} recentCandles the last M candles
 * @returns {number} the (possibly ratcheted) stop price
 */
export function channelTrailStop(position, recentCandles) {
  if (!Array.isArray(recentCandles) || recentCandles.length === 0) return position.slPrice;
  if (position.side === 'BUY') {
    let lowest = Infinity;
    for (const c of recentCandles) if (c.low < lowest) lowest = c.low;
    return Math.max(position.slPrice, lowest); // ratchet up only
  }
  let highest = -Infinity;
  for (const c of recentCandles) if (c.high > highest) highest = c.high;
  return Math.min(position.slPrice, highest); // ratchet down only
}
