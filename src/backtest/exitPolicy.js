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
