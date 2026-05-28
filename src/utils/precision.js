import { assetService } from '../server/services/asset.service.js';

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
}

export const precisionManager = new PrecisionManager();
