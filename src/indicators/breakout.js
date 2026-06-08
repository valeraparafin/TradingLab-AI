import { Technicals } from "./technical.js";

const Breakout = {
  execute(candles, config) {
    const length_ = config.length_ || 100;
    const length = config.length || 14;
    return this.calcBreakoutChannels(candles, length_, length);
  },

  calcBreakoutChannels(candles, length_ = 100, length = 14) {
    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);

    if (closes.length < length_)
      return { top: null, bottom: null, active: false };

    const lowestLow = Math.min(...lows.slice(-length_));
    const highestHigh = Math.max(...highs.slice(-length_));
    const normalizedPrices = closes.map(
      (c) => (c - lowestLow) / (highestHigh - lowestLow),
    );

    const volArray = [];
    for (let i = 0; i < normalizedPrices.length; i++) {
      if (i < 14) volArray.push(null);
      else
        volArray.push(
          Technicals.calcStdDev(normalizedPrices.slice(i - 13, i + 1), 14),
        );
    }

    const window = volArray.slice(-(length + 1)).filter((v) => v !== null);
    if (window.length < length)
      return { top: null, bottom: null, active: false };

    const currentVol = volArray[volArray.length - 1];
    const avgVol = window.reduce((a, b) => a + b, 0) / window.length;

    if (currentVol < avgVol) {
      // Channel boundaries come from the `length` bars BEFORE the current (forming) bar.
      // Including the current bar would let its own high/low bound the close, making a
      // breakout (price > top / price < bottom) mathematically impossible → 0 signals.
      const recentHigh = Math.max(...highs.slice(-length - 1, -1));
      const recentLow = Math.min(...lows.slice(-length - 1, -1));
      return { top: recentHigh, bottom: recentLow, active: true };
    }
    return { top: null, bottom: null, active: false };
  },
};

export default Breakout;
