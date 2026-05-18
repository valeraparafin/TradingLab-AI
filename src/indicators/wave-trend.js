import { Technicals } from "./technical.js";

const WaveTrend = {
  execute(candles, config) {
    const channelLength = config.wtLen || 9;
    const averageLength = config.wtAvg || 12;
    return this.calcWaveTrend(candles, channelLength, averageLength);
  },

  calcWaveTrend(candles, channelLength, averageLength, malen = 3) {
    const hlc3 = candles.map((c) => (c.high + c.low + c.close) / 3);
    const esa = Technicals.ema(hlc3, channelLength);
    if (esa.length === 0) return { wt1: 0, wt2: 0, vwap: 0 };
    const absDiffs = [];
    for (let i = channelLength - 1; i < hlc3.length; i++) {
      absDiffs.push(Math.abs(hlc3[i] - esa[i - (channelLength - 1)]));
    }
    const d = Technicals.ema(absDiffs, channelLength);
    if (d.length === 0) return { wt1: 0, wt2: 0, vwap: 0 };
    const ci = [];
    const startIdx = (channelLength - 1) * 2;
    for (let i = startIdx; i < hlc3.length; i++) {
      const currentEsa = esa[i - (channelLength - 1)];
      const currentD = d[i - startIdx];
      ci.push((hlc3[i] - currentEsa) / (0.015 * currentD));
    }
    const wt1Array = Technicals.ema(ci, averageLength);
    if (wt1Array.length === 0) return { wt1: 0, wt2: 0, vwap: 0 };
    const wt1 = wt1Array[wt1Array.length - 1];
    const wt2Array = Technicals.sma(wt1Array, malen);
    if (wt2Array.length === 0) return { wt1: 0, wt2: 0, vwap: 0 };
    const wt2 = wt2Array[wt2Array.length - 1];
    return { wt1, wt2, vwap: wt1 - wt2 };
  },
};

export default WaveTrend;
