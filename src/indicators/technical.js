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
   * RSI over a value array (e.g. closes). Uses a rolling SMA of gains/losses over
   * each `period`-length window. Returns an ascending series of length
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
    const rsiAt = (g, l) => (l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l));
    const out = [];
    for (let i = period - 1; i < gains.length; i++) {
      let ag = 0, al = 0;
      for (let j = i - period + 1; j <= i; j++) { ag += gains[j]; al += losses[j]; }
      ag /= period; al /= period;
      out.push(rsiAt(ag, al));
    }
    return out;
  },
};

