/**
 * Apply slippage to a MARKET fill. Slippage always worsens the fill for the side
 * that is transacting: a BUY pays more, a SELL receives less.
 * @param {number} price reference price
 * @param {'BUY'|'SELL'} side the side of THIS transaction (for an exit, the opposite of the position)
 * @param {number} bps slippage in basis points (5 = 0.05%)
 * @returns {number}
 */
export function slip(price, side, bps) {
  const f = (bps || 0) / 10000;
  return side === 'BUY' ? price * (1 + f) : price * (1 - f);
}

/**
 * Detect an exit for an open position on a single bar.
 * Priority: gap-on-open (non-entry bars only) → intrabar SL → intrabar TP.
 * SL is a MARKET fill (slippage applied); TP is a LIMIT fill (no slippage, fills at tpPrice).
 * On the entry bar the gap-on-open check is skipped (we already filled at this bar's open).
 *
 * @param {{side:'BUY'|'SELL', slPrice:number|null, tpPrice:number|null}} pos
 * @param {{open:number, high:number, low:number}} bar
 * @param {{slippageBps:number}} costs
 * @param {boolean} isEntryBar
 * @returns {{exitPrice:number, idealPrice:number, reason:'SL'|'TP'|'SL_GAP'|'TP_GAP', market:boolean}|null}
 */
export function checkExit(pos, bar, costs, isEntryBar) {
  const { side, slPrice, tpPrice } = pos;
  const exitSide = side === 'BUY' ? 'SELL' : 'BUY';
  const bps = (costs && costs.slippageBps) || 0;
  const mkt = (ideal, reason) => ({ idealPrice: ideal, exitPrice: slip(ideal, exitSide, bps), reason, market: true });
  const lim = (price, reason) => ({ idealPrice: price, exitPrice: price, reason, market: false });

  // Gap on open (skipped on the entry bar). SL_GAP fills at the (worse) gapped open;
  // TP_GAP fills at tpPrice (limit convention — no windfall from the open gapping past TP).
  if (!isEntryBar) {
    if (side === 'BUY') {
      if (slPrice != null && bar.open <= slPrice) return mkt(bar.open, 'SL_GAP');
      if (tpPrice != null && bar.open >= tpPrice) return lim(tpPrice, 'TP_GAP');
    } else {
      if (slPrice != null && bar.open >= slPrice) return mkt(bar.open, 'SL_GAP');
      if (tpPrice != null && bar.open <= tpPrice) return lim(tpPrice, 'TP_GAP');
    }
  }

  // Intrabar — SL first (pessimistic), then TP.
  if (side === 'BUY') {
    if (slPrice != null && bar.low <= slPrice) return mkt(slPrice, 'SL');
    if (tpPrice != null && bar.high >= tpPrice) return lim(tpPrice, 'TP');
  } else {
    if (slPrice != null && bar.high >= slPrice) return mkt(slPrice, 'SL');
    if (tpPrice != null && bar.low <= tpPrice) return lim(tpPrice, 'TP');
  }
  return null;
}
