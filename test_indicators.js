
const Indicators = {
  ema(values, period) {
    if (values.length < period) return [];
    const k = 2 / (period + 1);
    const ema = [];

    // Initial SMA for first value
    let sum = 0;
    for (let i = 0; i < period; i++) sum += values[i];
    ema.push(sum / period);

    for (let i = period; i < values.length; i++) {
      ema.push(values[i] * k + ema[ema.length - 1] * (1 - k));
    }
    return ema;
  },

  sma(values, period) {
    if (values.length < period) return [];
    const sma = [];
    for (let i = period - 1; i < values.length; i++) {
      const slice = values.slice(i - period + 1, i + 1);
      sma.push(slice.reduce((a, b) => a + b, 0) / period);
    }
    return sma;
  },

  lowest(values, period) {
    if (values.length < period) return [];
    const lows = [];
    for (let i = period - 1; i < values.length; i++) {
      lows.push(Math.min(...values.slice(i - period + 1, i + 1)));
    }
    return lows;
  },

  highest(values, period) {
    if (values.length < period) return [];
    const highs = [];
    for (let i = period - 1; i < values.length; i++) {
      highs.push(Math.max(...values.slice(i - period + 1, i + 1)));
    }
    return highs;
  },

  calcWaveTrend(candles, channelLength, averageLength, malen = 3) {
    const hlc3 = candles.map(c => (c.high + c.low + c.close) / 3);
    const esa = this.ema(hlc3, channelLength);
    if (esa.length === 0) return { wt1: 0, wt2: 0, vwap: 0 };

    // We need to calculate the absolute difference between hlc3 and its EMA.
    // Since EMA starts at index 'channelLength - 1', we align.
    const absDiffs = [];
    for (let i = channelLength - 1; i < hlc3.length; i++) {
      absDiffs.push(Math.abs(hlc3[i] - esa[i - (channelLength - 1)]));
    }

    const d = this.ema(absDiffs, channelLength);
    if (d.length === 0) return { wt1: 0, wt2: 0, vwap: 0 };

    // Calculate CI. CI corresponds to the index where we have both ESA and D.
    // ESA is available from index channelLength-1.
    // D is available from index (channelLength-1) + (channelLength-1).
    const ci = [];
    const startIdx = (channelLength - 1) * 2;
    for (let i = startIdx; i < hlc3.length; i++) {
      const currentEsa = esa[i - (channelLength - 1)];
      const currentD = d[i - startIdx];
      ci.push((hlc3[i] - currentEsa) / (0.015 * currentD));
    }

    const wt1Array = this.ema(ci, averageLength);
    if (wt1Array.length === 0) return { wt1: 0, wt2: 0, vwap: 0 };
    const wt1 = wt1Array[wt1Array.length - 1];

    const wt2Array = this.sma(wt1Array, malen);
    if (wt2Array.length === 0) return { wt1: 0, wt2: 0, vwap: 0 };
    const wt2 = wt2Array[wt2Array.length - 1];

    return { wt1, wt2, vwap: wt1 - wt2 };
  },

  calcMFI(candles, period) {
    if (candles.length < period + 1) return 0;
    const typicalPrice = candles.map(c => (c.high + c.low + c.close) / 3);
    const rawMoneyFlow = candles.map((c, i) => typicalPrice[i] * c.volume);

    let positiveMF = 0;
    let negativeMF = 0;

    const sliceStart = candles.length - period;
    for (let i = sliceStart + 1; i < candles.length; i++) {
      if (typicalPrice[i] > typicalPrice[i - 1]) {
        positiveMF += rawMoneyFlow[i];
      } else if (typicalPrice[i] < typicalPrice[i - 1]) {
        negativeMF += rawMoneyFlow[i];
      }
    }

    if (negativeMF === 0) return 100;
    return 100 - (100 / (1 + (positiveMF / negativeMF)));
  },

  calcStochRSI(candles, rsiLen, stochLen = 14, smoothK = 3, smoothD = 3) {
    if (candles.length < rsiLen + stochLen + smoothK + smoothD) return { k: 0, d: 0 };
    const closes = candles.map(c => c.close);

    // RSI Calculation (Wilder's Smoothing)
    const rsi = [];
    let avgGain = 0;
    let avgLoss = 0;

    for (let i = 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? -diff : 0;

      if (i <= rsiLen) {
        avgGain += gain;
        avgLoss += loss;
        if (i === rsiLen) {
          avgGain /= rsiLen;
          avgLoss /= rsiLen;
        }
      } else {
        avgGain = (avgGain * (rsiLen - 1) + gain) / rsiLen;
        avgLoss = (avgLoss * (rsiLen - 1) + loss) / rsiLen;
      }

      if (i >= rsiLen) {
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        rsi.push(100 - (100 / (1 + rs)));
      }
    }

    const stochRSI = [];
    const rsiLows = this.lowest(rsi, stochLen);
    const rsiHighs = this.highest(rsi, stochLen);

    for (let i = stochLen - 1; i < rsi.length; i++) {
      const low = rsiLows[i - (stochLen - 1)];
      const high = rsiHighs[i - (stochLen - 1)];
      const range = high - low;
      stochRSI.push(range === 0 ? 0 : (rsi[i] - low) / range);
    }

    const kArray = this.sma(stochRSI, smoothK);
    const k = kArray[kArray.length - 1];

    const dArray = this.sma(kArray, smoothD);
    const d = dArray[dArray.length - 1];

    return { k, d };
  },

  calcSTC(candles, fastLength, slowLength, length = 10, factor = 0.5) {
    if (candles.length < slowLength + length * 2) return 0;
    const closes = candles.map(c => c.close);
    const fastEma = this.ema(closes, fastLength);
    const slowEma = this.ema(closes, slowLength);

    const macd = [];
    const offset = fastEma.length - slowEma.length;
    for (let i = 0; i < slowEma.length; i++) {
      macd.push(fastEma[i + offset] - slowEma[i]);
    }

    const stochPass1 = (src, len) => {
      const lows = this.lowest(src, len);
      const highs = this.highest(src, len);
      const res = [];
      for (let i = len - 1; i < src.length; i++) {
        const low = lows[i - (len - 1)];
        const high = highs[i - (len - 1)];
        const range = high - low;
        res.push(range === 0 ? 0 : (src[i] - low) / range);
      }
      return res;
    };

    const s1 = stochPass1(macd, length);
    const smooth1 = this.ema(s1, Math.floor(length * factor));
    const s2 = stochPass1(smooth1, length);

    return s2[s2.length - 1] * 100;
  }
};

// Test Data
const mockCandles = [];
for (let i = 0; i < 200; i++) {
  mockCandles.push({
    high: 100 + Math.random() * 10,
    low: 90 + Math.random() * 10,
    close: 95 + Math.random() * 10,
    volume: 1000 + Math.random() * 500
  });
}

console.log("WaveTrend:", Indicators.calcWaveTrend(mockCandles, 9, 12));
console.log("MFI:", Indicators.calcMFI(mockCandles, 60));
console.log("StochRSI:", Indicators.calcStochRSI(mockCandles, 14));
console.log("STC:", Indicators.calcSTC(mockCandles, 23, 50));
