import { assetService } from '../server/services/asset.service.js';

/**
 * Snaps a value to N decimal places and returns a NUMBER (drops float noise
 * like 1.759727778210061). Non-finite input passes through unchanged.
 * @param {number} value
 * @param {number} decimals
 * @returns {number}
 */
export function roundTo(value, decimals) {
  const v = Number(value);
  if (!isFinite(v)) return v;
  const p = Math.max(0, Number.isFinite(decimals) ? Math.trunc(decimals) : 2);
  return Number(v.toFixed(p));
}

/**
 * PrecisionManager now acts as a thin formatting wrapper around AssetService.
 */
export class PrecisionManager {
  /**
   * Returns the decimal precision for a given symbol from the cached AssetService.
   * @param {string} symbol - The trading pair (e.g., "BTCUSDT").
   * @returns {number} The number of decimal places.
   */
  getPrecision(symbol) {
    return assetService.getPrecision(symbol);
  }

  /**
   * Formats a value according to the symbol's precision.
   * @param {number} value - The value to format.
   * @param {string} symbol - The trading pair.
   * @returns {string} The formatted string.
   */
  format(value, symbol) {
    const num = Number(value);
    if (isNaN(num)) return "0";

    const precision = (symbol === 'PERCENT' || symbol === 'INDICATOR' || symbol === 'USDT')
      ? 2
      : assetService.getPrecision(symbol);

    return Number(num.toFixed(precision)).toString();
  }

  /** Rounds a PRICE to the symbol's tick-size precision (numeric). */
  roundPrice(value, symbol) {
    return roundTo(value, assetService.getPrecision(symbol));
  }

  /** Rounds a QUANTITY to the symbol's lot-step precision (numeric). */
  roundQty(value, symbol) {
    return roundTo(value, assetService.getQuantityPrecision(symbol));
  }
}

export const precisionManager = new PrecisionManager();
