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
 * Priority: gap-on-open (non-entry bars only) → intrabar SL/LIQ → intrabar TP.
 * SL is a MARKET fill (slippage applied); TP is a LIMIT fill (no slippage, fills at tpPrice).
 * On the entry bar the gap-on-open check is skipped (we already filled at this bar's open).
 * Among adverse levels {SL, LIQ}, the one geometrically reached first triggers:
 *   long (falling): higher price first; short (rising): lower price first.
 * Liquidation fills AT liqPrice (the simulator caps the loss at margin regardless).
 *
 * @param {{side:'BUY'|'SELL', slPrice:number|null, tpPrice:number|null, liqPrice?:number}} pos
 * @param {{open:number, high:number, low:number}} bar
 * @param {{slippageBps:number}} costs
 * @param {boolean} isEntryBar
 * @returns {{exitPrice:number, idealPrice:number, reason:'SL'|'TP'|'SL_GAP'|'TP_GAP'|'LIQUIDATION'|'LIQ_GAP', market:boolean}|null}
 */
export function checkExit(pos, bar, costs, isEntryBar) {
  const { side, slPrice, tpPrice, liqPrice } = pos;
  const exitSide = side === 'BUY' ? 'SELL' : 'BUY';
  const bps = (costs && costs.slippageBps) || 0;
  const mkt = (ideal, reason) => ({ idealPrice: ideal, exitPrice: slip(ideal, exitSide, bps), reason, market: true });
  const lim = (price, reason) => ({ idealPrice: price, exitPrice: price, reason, market: false });
  // Liquidation fills AT the liq price (loss is capped at margin by the simulator regardless).
  const liqExit = (reason) => ({ idealPrice: liqPrice, exitPrice: liqPrice, reason, market: true });

  if (side === 'BUY') {
    // Adverse = downward. Among {SL, LIQ} the HIGHER price is hit first while falling.
    if (!isEntryBar) {
      const slGap = slPrice != null && bar.open <= slPrice;
      const liqGap = liqPrice != null && bar.open <= liqPrice;
      if (liqGap && (!slGap || liqPrice >= slPrice)) return liqExit('LIQ_GAP');
      if (slGap) return mkt(bar.open, 'SL_GAP');
      if (tpPrice != null && bar.open >= tpPrice) return lim(tpPrice, 'TP_GAP');
    }
    const slHit = slPrice != null && bar.low <= slPrice;
    const liqHit = liqPrice != null && bar.low <= liqPrice;
    if (liqHit && (!slHit || liqPrice >= slPrice)) return liqExit('LIQUIDATION');
    if (slHit) return mkt(slPrice, 'SL');
    if (tpPrice != null && bar.high >= tpPrice) return lim(tpPrice, 'TP');
  } else {
    // Adverse = upward. Among {SL, LIQ} the LOWER price is hit first while rising.
    if (!isEntryBar) {
      const slGap = slPrice != null && bar.open >= slPrice;
      const liqGap = liqPrice != null && bar.open >= liqPrice;
      if (liqGap && (!slGap || liqPrice <= slPrice)) return liqExit('LIQ_GAP');
      if (slGap) return mkt(bar.open, 'SL_GAP');
      if (tpPrice != null && bar.open <= tpPrice) return lim(tpPrice, 'TP_GAP');
    }
    const slHit = slPrice != null && bar.high >= slPrice;
    const liqHit = liqPrice != null && bar.high >= liqPrice;
    if (liqHit && (!slHit || liqPrice <= slPrice)) return liqExit('LIQUIDATION');
    if (slHit) return mkt(slPrice, 'SL');
    if (tpPrice != null && bar.low <= tpPrice) return lim(tpPrice, 'TP');
  }
  return null;
}
