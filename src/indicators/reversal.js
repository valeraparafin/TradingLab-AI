import { Technicals } from "./technical.js";

const Reversal = {
  execute(candles, config) {
    const fvgLookback = config.fvg_lookback || 20;

    return {
      structure: this.calcStructure(candles),
      recentFVG: this.calcRecentFVG(candles, fvgLookback),
      rejection: this.calcRejection(candles),
    };
  },

  calcStructure(candles) {
    if (candles.length < 20) return { trend: 0 };

    const closes = candles.map(c => c.close);
    const last = closes[closes.length - 1];
    const prev = closes[closes.length - 2];

    // Simple trend proxy: 1 for bullish, -1 for bearish, 0 for neutral
    // In a real scenario, this would be based on Higher Highs / Higher Lows
    const trend = last > prev ? 1 : last < prev ? -1 : 0;

    return { trend };
  },

  calcRecentFVG(candles, lookback) {
    if (candles.length < 3) return null;

    const window = candles.slice(-lookback);
    for (let i = window.length - 1; i >= 2; i--) {
      const candle0 = window[i - 2];
      const candle1 = window[i - 1];
      const candle2 = window[i];

      // Bullish FVG: Gap between candle 0 high and candle 2 low
      if (candle0.high < candle2.low) {
        return { top: candle2.low, bottom: candle0.high, type: 'bullish' };
      }
      // Bearish FVG: Gap between candle 0 low and candle 2 high
      if (candle0.low > candle2.high) {
        return { top: candle0.low, bottom: candle2.high, type: 'bearish' };
      }
    }

    return null;
  },

  calcRejection(candles) {
    if (candles.length < 1) return null;

    const last = candles[candles.length - 1];
    const bodySize = Math.abs(last.close - last.open);
    const candleRange = last.high - last.low;

    if (candleRange === 0) return null;

    // Bullish Rejection (Hammer/Pin Bar)
    // Lower wick is significantly larger than the body
    const lowerWick = Math.min(last.open, last.close) - last.low;
    if (lowerWick > bodySize * 2) {
      return {
        type: 'bullish',
        high: last.high,
        low: last.low,
      };
    }

    // Bearish Rejection (Shooting Star/Pin Bar)
    // Upper wick is significantly larger than the body
    const upperWick = last.high - Math.max(last.open, last.close);
    if (upperWick > bodySize * 2) {
      return {
        type: 'bearish',
        high: last.high,
        low: last.low,
      };
    }

    return null;
  },
};

export default Reversal;
