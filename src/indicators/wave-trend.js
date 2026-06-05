import { Technicals } from "./technical.js";

const WaveTrend = {
  execute(candles, config = {}) {
    // 1. Config
    //
    // Params live under `config.indicators` (same shape as SMC). Templates
    // store snake_case keys (channel_length, average_length, ...) and
    // resolveConfig() deep-converts them to camelCase before runtime, so the
    // canonical runtime key is camelCase per the repo casing policy. We accept
    // the camelCase descriptive name first, then the raw snake_case form (for
    // un-resolved configs), then the legacy short alias used by older VMC
    // templates (wtLen/wtAvg/...), then the hardcoded default.
    //
    // VMC Cipher B reference: n1 "Channel Length" -> wtLen (esa/d EMA period),
    // n2 "Average Length" -> wtAvg (tci/wt1 EMA period).
    const ind = config.indicators || {};
    const param = (camel, snake, legacy, def) => {
      for (const v of [ind[camel], ind[snake], ind[legacy], config[legacy]]) {
        if (v !== undefined && v !== null) return v;
      }
      return def;
    };

    const wtLen = param('channelLength', 'channel_length', 'wtLen', 9);
    const wtAvg = param('averageLength', 'average_length', 'wtAvg', 12);
    const mfiLen = param('mfiLength', 'mfi_length', 'mfiLen', 60);
    const rsiLen = param('rsiLength', 'rsi_length', 'rsiLen', 14);
    const stochLen = param('stochLength', 'stoch_length', 'stochLen', 14);
    const stcFast = param('stcFast', 'stc_fast', 'stcFast', 23);
    const stcSlow = param('stcSlow', 'stc_slow', 'stcSlow', 50);

    // --- WaveTrend Calculation ---
    const hlc3 = candles.map((c) => (c.high + c.low + c.close) / 3);
    const esa = Technicals.ema(hlc3, wtLen);
    if (esa.length === 0) return this.emptyResult();

    const absDiffs = [];
    for (let i = wtLen - 1; i < hlc3.length; i++) {
      absDiffs.push(Math.abs(hlc3[i] - esa[i - (wtLen - 1)]));
    }
    const d = Technicals.ema(absDiffs, wtLen);
    if (d.length === 0) return this.emptyResult();

    const ci = [];
    const startIdx = (wtLen - 1) * 2;
    for (let i = startIdx; i < hlc3.length; i++) {
      const currentEsa = esa[i - (wtLen - 1)];
      const currentD = d[i - startIdx];
      ci.push((hlc3[i] - currentEsa) / (0.015 * currentD));
    }

    const wt1Array = Technicals.ema(ci, wtAvg);
    if (wt1Array.length === 0) return this.emptyResult();
    const wt1 = wt1Array[wt1Array.length - 1];

    const wt2Array = Technicals.sma(wt1Array, 3); // malen = 3
    if (wt2Array.length === 0) return this.emptyResult();
    const wt2 = wt2Array[wt2Array.length - 1];

    // Detect Cross Up (Bullish)
    const wtCrossUp = wt1Array.length > 1 && wt1Array[wt1Array.length - 2] < wt2Array[wt2Array.length - 2] && wt1 > wt2;
    // Detect Cross Down (Bearish)
    const wtCrossDown = wt1Array.length > 1 && wt1Array[wt1Array.length - 2] > wt2Array[wt2Array.length - 2] && wt1 < wt2;

    // --- MFI Calculation ---
    const mfi = this.calcMFI(candles, mfiLen);

    // --- Stoch RSI Calculation ---
    const stochRsi = this.calcStochRSI(candles, rsiLen, stochLen);

    // --- STC (Schaff Trend Cycle) Calculation ---
    const stc = this.calcSTC(candles, stcFast, stcSlow);

    return {
      wt: { wt1, wt2 },
      wtCrossUp,
      wtCrossDown,
      mfi,
      stochRsi,
      stc,
      vwap: wt1 - wt2
    };
  },

  calcMFI(candles, period) {
    if (candles.length < period) return 50;
    const typicalPriceVolume = candles.map(c => ((c.high + c.low + c.close) / 3) * c.volume);

    let positiveVolume = 0;
    let negativeVolume = 0;

    for (let i = candles.length - period; i < candles.length; i++) {
      if (candles[i].close > candles[i - 1]?.close) {
        positiveVolume += typicalPriceVolume[i];
      } else if (candles[i].close < candles[i - 1]?.close) {
        negativeVolume += typicalPriceVolume[i];
      }
    }

    if (positiveVolume + negativeVolume === 0) return 50;
    return 100 - (100 / (1 + (positiveVolume / negativeVolume)));
  },

  calcStochRSI(candles, rsiLen, stochLen) {
    const closes = candles.map(c => c.close);
    const rsi = this.calcRSI(closes, rsiLen);
    if (rsi.length < stochLen) return { k: 50, d: 50 };

    const stochRsiK = [];
    for (let i = stochLen - 1; i < rsi.length; i++) {
      const slice = rsi.slice(i - stochLen + 1, i + 1);
      const min = Math.min(...slice);
      const max = Math.max(...slice);
      const k = max === min ? 50 : ((rsi[i] - min) / (max - min)) * 100;
      stochRsiK.push(k);
    }

    const k = stochRsiK[stochRsiK.length - 1];
    const d = Technicals.sma(stochRsiK, 3)[Technicals.sma(stochRsiK, 3)?.length - 1] || 50;

    return { k, d };
  },

  calcRSI(values, period) {
    if (values.length < period + 1) return [];
    const rsi = [];
    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
      const diff = values[i] - values[i - 1];
      if (diff >= 0) gains += diff; else losses -= diff;
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period + 1; i < values.length; i++) {
      const diff = values[i] - values[i - 1];
      const gain = diff >= 0 ? diff : 0;
      const loss = diff < 0 ? -diff : 0;

      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;

      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      rsi.push(100 - (100 / (1 + rs)));
    }
    return rsi;
  },

  calcSTC(candles, fast, slow) {
    const closes = candles.map(c => c.close);
    const macd = this.calcMACD(closes, fast, slow);
    if (!macd) return 50;

    const { values } = macd;
    const stoch = [];
    const period = slow;

    for (let i = period - 1; i < values.length; i++) {
      const slice = values.slice(i - period + 1, i + 1);
      const min = Math.min(...slice);
      const max = Math.max(...slice);
      stoch.push(max === min ? 0 : (values[i] - min) / (max - min));
    }

    const smoothedStoch = Technicals.ema(stoch, 3); // First smoothing
    if (smoothedStoch.length === 0) return 50;

    const finalSTC = Technicals.ema(smoothedStoch, 3); // Second smoothing
    return (finalSTC[finalSTC.length - 1] * 100) || 50;
  },

  calcMACD(values, fast, slow) {
    const emaFast = Technicals.ema(values, fast);
    const emaSlow = Technicals.ema(values, slow);
    if (emaFast.length === 0 || emaSlow.length === 0) return null;

    const offset = emaSlow.length === emaFast.length ? 0 : emaFast.length - emaSlow.length;
    const macdLine = [];
    for (let i = 0; i < emaSlow.length; i++) {
      macdLine.push(emaFast[i + offset] - emaSlow[i]);
    }
    return { values: macdLine };
  },

  emptyResult() {
    return {
      wt: { wt1: 0, wt2: 0 },
      wtCrossUp: false,
      wtCrossDown: false,
      mfi: 50,
      stochRsi: { k: 50, d: 50 },
      stc: 50,
      vwap: 0
    };
  }
};

export default WaveTrend;
