/**
 * Isolated-margin liquidation price (single-tier MMR, v1 approximation).
 * Long  ≈ entry × (1 − 1/leverage + mmr)
 * Short ≈ entry × (1 + 1/leverage − mmr)
 * Returns null when liquidation does not apply (spot / missing inputs).
 *
 * @param {number} entry entry (fill) price
 * @param {'BUY'|'SELL'} side position side
 * @param {number} leverage >1 for futures
 * @param {number} mmr maintenance margin rate (e.g. 0.005)
 * @returns {number|null}
 */
export function liqPrice(entry, side, leverage, mmr) {
  if (!(leverage > 1) || mmr == null || !Number.isFinite(mmr) || !Number.isFinite(entry)) return null;
  if (side === 'BUY') return entry * (1 - 1 / leverage + mmr);
  if (side === 'SELL') return entry * (1 + 1 / leverage - mmr);
  return null;
}
