/**
 * PrecisionManager handles the decimal precision for different trading symbols.
 */
export class PrecisionManager {
  constructor() {
    this.cache = {};
  }

  /**
   * Fetches precision for a symbol from Binance API.
   * @param {string} symbol - The trading pair (e.g., "BTCUSDT").
   * @returns {Promise<number>} The number of decimal places.
   */
  async getPrecision(symbol) {
    if (this.cache[symbol]) return this.cache[symbol];

    try {
      const res = await fetch(`https://api.binance.com/api/v3/exchangeInfo`);
      if (!res.ok) throw new Error(`Binance API error: ${res.status}`);
      const data = await res.json();

      const symbolInfo = data.symbols.find(s => s.symbol === symbol);
      if (!symbolInfo) {
        console.warn(`[PrecisionManager] Symbol ${symbol} not found in exchange info. Defaulting to 2.`);
        return 2;
      }

      const tickSize = symbolInfo.filters.find(f => f.filterType === 'PRICE_FILTER')?.tickSize;
      if (!tickSize) return 2;

      // Calculate decimals from tickSize (e.g., 0.0001 -> 4)
      const precision = tickSize.toString().includes('.')
        ? tickSize.toString().split('.')[1].length
        : 0;

      this.cache[symbol] = precision;
      return precision;
    } catch (err) {
      console.error(`[PrecisionManager] Error fetching precision for ${symbol}: ${err.message}`);
      return 2;
    }
  }

  /**
   * Formats a value according to the symbol's precision.
   * @param {number} value - The value to format.
   * @param {string} symbol - The trading pair.
   * @returns {Promise<string>} The formatted string.
   */
  async format(value, symbol) {
    const precision = await this.getPrecision(symbol);
    return value.toFixed(precision);
  }
}

export const precisionManager = new PrecisionManager();
