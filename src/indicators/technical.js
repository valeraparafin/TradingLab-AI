export const Technicals = {
  calcStdDev(values, period) {
    if (values.length < period) return null;
    const slice = values.slice(-period);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance =
      slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
    return Math.sqrt(variance);
  },
  ema(values, period) {
    if (values.length < period) return [];
    const k = 2 / (period + 1);
    const ema = [];
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
  /**
   * Wilder's Average True Range. Consumes OHLC candle objects (not a value array).
   * TR = max(high-low, |high-prevClose|, |low-prevClose|). Seed = SMA of the first
   * `period` TRs, then Wilder smoothing: ATR = (prevATR*(period-1) + TR) / period.
   * Returns an ascending ATR series of length (candles.length - period), or [] if
   * there are not more than `period` candles. (candles ascending by time)
   */
  atr(candles, period) {
    if (!Array.isArray(candles) || candles.length < period + 1) return [];
    const tr = [];
    for (let i = 1; i < candles.length; i++) {
      const h = candles[i].high, l = candles[i].low, pc = candles[i - 1].close;
      tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
    let sum = 0;
    for (let i = 0; i < period; i++) sum += tr[i];
    const out = [sum / period];
    for (let i = period; i < tr.length; i++) {
      out.push((out[out.length - 1] * (period - 1) + tr[i]) / period);
    }
    return out;
  },
  /**
   * Wilder's RSI over a value array (e.g. closes). Seed = SMA of the first `period`
   * gains/losses, then Wilder smoothing (SMMA). Returns an ascending series of length
   * (values.length - period), or [] if there are not more than `period` values.
   */
  rsi(values, period) {
    if (!Array.isArray(values) || values.length < period + 1) return [];
    const gains = [], losses = [];
    for (let i = 1; i < values.length; i++) {
      const d = values[i] - values[i - 1];
      gains.push(d > 0 ? d : 0);
      losses.push(d < 0 ? -d : 0);
    }
    let avgGain = 0, avgLoss = 0;
    for (let i = 0; i < period; i++) { avgGain += gains[i]; avgLoss += losses[i]; }
    avgGain /= period; avgLoss /= period;
    const rsiAt = (g, l) => (l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l));
    const out = [rsiAt(avgGain, avgLoss)];
    for (let i = period; i < gains.length; i++) {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
      out.push(rsiAt(avgGain, avgLoss));
    }
    return out;
  },
  /**
   * Wilder's ADX (Average Directional Index) — non-directional trend-strength in [0,100].
   * Computes +DM/-DM/TR, Wilder-smooths each over `period`, forms +DI/-DI and DX, then
   * Wilder-averages DX over `period`. Returns an ascending ADX series of length
   * (candles.length - 2*period + 1), or [] if candles.length < 2*period + 1.
   */
  adx(candles, period) {
    if (!Array.isArray(candles) || candles.length < 2 * period + 1) return [];
    const plusDM = [], minusDM = [], tr = [];
    for (let i = 1; i < candles.length; i++) {
      const up = candles[i].high - candles[i - 1].high;
      const down = candles[i - 1].low - candles[i].low;
      plusDM.push(up > down && up > 0 ? up : 0);
      minusDM.push(down > up && down > 0 ? down : 0);
      const h = candles[i].high, l = candles[i].low, pc = candles[i - 1].close;
      tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
    // Wilder smoothing of an array, seeded by the sum of the first `period` values.
    const smooth = (arr) => {
      let s = 0;
      for (let i = 0; i < period; i++) s += arr[i];
      const out = [s];
      for (let i = period; i < arr.length; i++) { s = s - s / period + arr[i]; out.push(s); }
      return out;
    };
    const sPlus = smooth(plusDM), sMinus = smooth(minusDM), sTr = smooth(tr);
    const dx = [];
    for (let i = 0; i < sTr.length; i++) {
      const pDI = sTr[i] === 0 ? 0 : 100 * (sPlus[i] / sTr[i]);
      const mDI = sTr[i] === 0 ? 0 : 100 * (sMinus[i] / sTr[i]);
      const denom = pDI + mDI;
      dx.push(denom === 0 ? 0 : 100 * (Math.abs(pDI - mDI) / denom));
    }
    if (dx.length < period) return [];
    let adxVal = 0;
    for (let i = 0; i < period; i++) adxVal += dx[i];
    adxVal /= period;
    const out = [adxVal];
    for (let i = period; i < dx.length; i++) { adxVal = (adxVal * (period - 1) + dx[i]) / period; out.push(adxVal); }
    return out;
  },
  /**
   * Least-squares slope over the last `period` values, normalized by their mean
   * (fractional change per bar — unit-free, comparable across symbols). Returns a
   * single number, or null if there are fewer than `period` values.
   */
  slope(values, period) {
    if (!Array.isArray(values) || values.length < period) return null;
    const slice = values.slice(-period);
    const n = period;
    const sumX = (n * (n - 1)) / 2;
    const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
    let sumY = 0, sumXY = 0;
    for (let i = 0; i < n; i++) { sumY += slice[i]; sumXY += i * slice[i]; }
    const denom = n * sumX2 - sumX * sumX;
    if (denom === 0) return null;
    const m = (n * sumXY - sumX * sumY) / denom; // slope per bar
    const mean = sumY / n;
    return mean !== 0 ? m / mean : 0;
  },
};

