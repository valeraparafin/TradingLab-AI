// src/agents/computeSetupRR.js

/**
 * Setup reward:risk from the structural stop.
 *
 * The risk leg is the entry→invalidation distance as a fraction of entry; the reward leg
 * is the fixed takeProfitPct (a fraction). Returns null whenever there is no valid
 * structural basis — caller then falls back to the config-ratio (takeProfitPct/stopLossPct).
 *
 * Invalid (→ null) means any of: non-finite invalidation/entry (the LLM string path lands
 * here), invalidation on the wrong side of entry for the side, zero distance, non-positive
 * entry, missing takeProfitPct, or a side other than BUY/SELL.
 *
 * @param {{entryPrice:number, invalidation:(number|null), side:'BUY'|'SELL'|'HOLD', takeProfitPct:number}} a
 * @returns {number|null}
 */
export function computeSetupRR({ entryPrice, invalidation, side, takeProfitPct }) {
  if (typeof invalidation !== 'number' || !isFinite(invalidation)) return null;
  if (typeof entryPrice !== 'number' || !isFinite(entryPrice) || entryPrice <= 0) return null;
  if (typeof takeProfitPct !== 'number' || !isFinite(takeProfitPct) || takeProfitPct <= 0) return null;
  const onCorrectSide =
    side === 'BUY' ? invalidation < entryPrice :
    side === 'SELL' ? invalidation > entryPrice : false;
  if (!onCorrectSide) return null;
  const riskFrac = Math.abs(entryPrice - invalidation) / entryPrice;
  if (!(riskFrac > 0)) return null;
  return takeProfitPct / riskFrac;
}
