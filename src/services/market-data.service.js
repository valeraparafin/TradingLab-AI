export const marketDataService = {
  /**
   * Fetches candles from Binance API.
   * @param {string} symbol - Trading pair (e.g., "BTCUSDT")
   * @param {string} interval - Timeframe (e.g., "1m", "1H")
   * @param {number} limit - Number of candles to fetch
   * @returns {Promise<Array>} Array of candle objects
   */
  async fetchCandles(symbol, interval, limit = 500) {
    const intervalMap = {
      "1m": "1m",
      "3m": "3m",
      "5m": "5m",
      "15m": "15m",
      "30m": "30m",
      "1H": "1h",
      "4H": "4h",
      "1D": "1d",
      "1W": "1w",
    };
    const binanceInterval = intervalMap[interval] || "1m";
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${binanceInterval}&limit=${limit}`;
    
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Binance API error: ${res.status}`);
      const data = await res.json();
      return data.map((k) => ({
        time: k[0],
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
      }));
    } catch (error) {
      console.error(`[MarketDataService] Error fetching candles for ${symbol} (${interval}): ${error.message}`);
      throw error;
    }
  },
};
