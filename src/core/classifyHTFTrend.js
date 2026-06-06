// src/core/classifyHTFTrend.js
import { Technicals } from '../indicators/technical.js';

/** close vs EMA with a neutral band. */
function emaBandVerdict(htf, emaPeriod, band) {
  const closes = htf.map((c) => c.close);
  const ema = Technicals.ema(closes, emaPeriod);
  if (!ema.length) return 'NEUTRAL';
  const e = ema[ema.length - 1];
  const close = closes[closes.length - 1];
  if (close > e * (1 + band)) return 'UP';
  if (close < e * (1 - band)) return 'DOWN';
  return 'NEUTRAL';
}

/** EMA slope over `lookback` HTF bars, with a neutral threshold. */
function emaSlopeVerdict(htf, emaPeriod, lookback, threshold) {
  const closes = htf.map((c) => c.close);
  const ema = Technicals.ema(closes, emaPeriod);
  if (ema.length <= lookback) return 'NEUTRAL';
  const now = ema[ema.length - 1];
  const past = ema[ema.length - 1 - lookback];
  if (!(past > 0)) return 'NEUTRAL'; // guards div-by-zero; prices are always positive here
  const slope = (now - past) / past;
  if (slope > threshold) return 'UP';
  if (slope < -threshold) return 'DOWN';
  return 'NEUTRAL';
}

/** Wilder ADX over HTF bars; returns the latest ADX or null if insufficient data. */
function computeADX(htf, period) {
  const n = htf.length;
  if (n < period * 2 + 1) return null;
  const tr = [], plusDM = [], minusDM = [];
  for (let i = 1; i < n; i++) {
    const h = htf[i].high, l = htf[i].low;
    const pc = htf[i - 1].close, ph = htf[i - 1].high, pl = htf[i - 1].low;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    const up = h - ph, down = pl - l;
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
  }
  const smooth = (arr) => {
    let s = 0;
    for (let i = 0; i < period; i++) s += arr[i];
    const out = [s];
    for (let i = period; i < arr.length; i++) { s = s - s / period + arr[i]; out.push(s); }
    return out;
  };
  const trS = smooth(tr), pdS = smooth(plusDM), mdS = smooth(minusDM);
  const dx = [];
  for (let i = 0; i < trS.length; i++) {
    if (!(trS[i] > 0)) { dx.push(0); continue; }
    const pdi = 100 * pdS[i] / trS[i];
    const mdi = 100 * mdS[i] / trS[i];
    const denom = pdi + mdi;
    dx.push(denom === 0 ? 0 : 100 * Math.abs(pdi - mdi) / denom);
  }
  if (dx.length < period) return null;
  let adx = 0;
  for (let i = 0; i < period; i++) adx += dx[i];
  adx /= period;
  for (let i = period; i < dx.length; i++) adx = (adx * (period - 1) + dx[i]) / period;
  return adx;
}

/** ADX gate: range (ADX < threshold) → NEUTRAL; else the already-computed emaBand direction. */
function adxRegimeVerdict(htf, emaBand, adxPeriod, adxThreshold) {
  const adx = computeADX(htf, adxPeriod);
  if (adx == null || adx < adxThreshold) return 'NEUTRAL';
  return emaBand;
}

/**
 * Classify the HTF trend three ways. NEUTRAL is the over-filter safeguard:
 * in a range every definition returns NEUTRAL so both trade sides pass.
 *
 * @param {import('./contracts.js').Candle[]} htf closed HTF candles, ascending
 * @param {object} [opts]
 * @param {number} [opts.emaPeriod=50]
 * @param {number} [opts.band=0.005] neutral band fraction for emaBand
 * @param {number} [opts.slopeLookback=5] HTF bars for emaSlope
 * @param {number} [opts.slopeThreshold=0.002] neutral threshold for emaSlope
 * @param {number} [opts.adxPeriod=14]
 * @param {number} [opts.adxThreshold=25]
 * @returns {{emaBand:'UP'|'DOWN'|'NEUTRAL', emaSlope:'UP'|'DOWN'|'NEUTRAL', adxRegime:'UP'|'DOWN'|'NEUTRAL'}}
 */
export function classifyHTFTrend(htf, opts = {}) {
  const {
    emaPeriod = 50, band = 0.005,
    slopeLookback = 5, slopeThreshold = 0.002,
    adxPeriod = 14, adxThreshold = 25,
  } = opts;
  if (!Array.isArray(htf) || htf.length === 0) {
    return { emaBand: 'NEUTRAL', emaSlope: 'NEUTRAL', adxRegime: 'NEUTRAL' };
  }
  const emaBand = emaBandVerdict(htf, emaPeriod, band);
  return {
    emaBand,
    emaSlope: emaSlopeVerdict(htf, emaPeriod, slopeLookback, slopeThreshold),
    adxRegime: adxRegimeVerdict(htf, emaBand, adxPeriod, adxThreshold),
  };
}
