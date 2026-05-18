const Technicals = {
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
};

module.exports = Technicals;
