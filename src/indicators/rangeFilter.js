// src/indicators/rangeFilter.js
/**
 * Range Filter (DonovanWall) — Buy & Sell Signals. Pure port of strategy/VMC Swing.txt.
 * Deterministic; the signal is computed on the last CLOSED candle (no look-ahead).
 *
 * Output contract mirrors donchianTrend.js:
 *   side: 'BUY'|'SELL'|'HOLD'  — fresh-flip side (HOLD between flips)
 *   state: 1|-1|0              — persistent CondIni phase (long/short)
 *   dir: 1|-1|0               — filter direction (Pine fdir)
 *   freshFlip: boolean        — bar where state flips (= Pine BUY/SELL label)
 *   filter, hiBand, loBand, price
 */
import { Technicals } from './technical.js';

const HOLD = { side: 'HOLD', state: 0, dir: 0, freshFlip: false, filter: null, hiBand: null, loBand: null, price: null, adx: null };

// Pine-style EMA: seed with the first value, then recursive smoothing.
// NOTE: seeds with values[0]; Pine ta.ema warms from na over `period` bars, so the
// first ~2*period bars differ slightly from TradingView. Immaterial past warmup.
function ema(values, period) {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  const out = [values[0]];
  for (let i = 1; i < values.length; i++) out.push(values[i] * k + out[i - 1] * (1 - k));
  return out;
}

function resolveSource(c, source) {
  switch (source) {
    case 'open': return c.open;
    case 'high': return c.high;
    case 'low': return c.low;
    case 'hl2': return (c.high + c.low) / 2;
    case 'hlc3': return (c.high + c.low + c.close) / 3;
    case 'ohlc4': return (c.open + c.high + c.low + c.close) / 4;
    case 'hlcc4': return (c.high + c.low + c.close + c.close) / 4; // TradingView "(H+L+C+C)/4"
    case 'close':
    default: return c.close;
  }
}

const RangeFilter = {
  execute(candles, config = {}) {
    const ind = config.indicators || {};
    const pick = (cam, sn, def) => {
      const v = [ind[cam], ind[sn]].find((x) => x !== undefined && x !== null);
      return v ?? def;
    };
    const period = pick('period', 'period', 20);
    const multiplier = pick('multiplier', 'multiplier', 3.5);
    const source = pick('source', 'source', 'close');

    if (!Array.isArray(candles) || candles.length < period + 2) return { ...HOLD };

    const src = candles.map((c) => resolveSource(c, source));

    // rng_size: AC = ema(ema(|x - x[1]|, n), 2n-1) * qty
    const absDiff = src.map((x, i) => (i === 0 ? 0 : Math.abs(x - src[i - 1])));
    const avrng = ema(absDiff, period);
    const smoothrng = ema(avrng, period * 2 - 1).map((v) => v * multiplier);

    // rng_filt: stepwise filter that only moves when price exits the ±r band.
    const filt = new Array(src.length);
    filt[0] = src[0];
    for (let i = 1; i < src.length; i++) {
      const r = smoothrng[i];
      const prev = filt[i - 1];
      let f = prev;
      if (src[i] - r > prev) f = src[i] - r;
      if (src[i] + r < prev) f = src[i] + r;
      filt[i] = f;
    }

    // fdir: filter direction, carried forward when flat.
    const fdir = new Array(src.length).fill(0);
    for (let i = 1; i < src.length; i++) {
      fdir[i] = filt[i] > filt[i - 1] ? 1 : filt[i] < filt[i - 1] ? -1 : fdir[i - 1];
    }

    // CondIni state + fresh flip (Pine longCondition/shortCondition).
    let condIni = 0;
    let prevCondIni = 0;
    let freshFlip = false;
    for (let i = 1; i < src.length; i++) {
      const upward = fdir[i] === 1;
      const downward = fdir[i] === -1;
      const longCond = src[i] > filt[i] && upward;
      const shortCond = src[i] < filt[i] && downward;
      prevCondIni = condIni;
      condIni = longCond ? 1 : shortCond ? -1 : condIni;
      if (i === src.length - 1) {
        const longCondition = longCond && prevCondIni === -1;
        const shortCondition = shortCond && prevCondIni === 1;
        freshFlip = longCondition || shortCondition;
      }
    }

    const last = src.length - 1;
    const r = smoothrng[last];
    const state = condIni;
    const side = freshFlip ? (state === 1 ? 'BUY' : state === -1 ? 'SELL' : 'HOLD') : 'HOLD';

    // ADX on the decision bar so the live regime gate (rf_regime_adx) can prune low-ADX chop —
    // the proven core lever. Null until there are enough candles to compute it (warmup).
    const adxPeriod = pick('adxPeriod', 'adx_period', 14);
    const adxSeries = Technicals.adx(candles, adxPeriod);
    const adx = adxSeries.length ? adxSeries[adxSeries.length - 1] : null;

    return {
      side,
      state,
      dir: fdir[last],
      freshFlip,
      filter: filt[last],
      hiBand: filt[last] + r,
      loBand: filt[last] - r,
      price: candles[last].close,
      adx,
    };
  },
};

export default RangeFilter;
