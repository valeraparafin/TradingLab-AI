import { Technicals } from './technical.js';
import { aggregateHTF } from '../core/aggregateHTF.js';

/**
 * Trend-continuation logic with an explicit regime gate. Four layers must agree:
 *   1. Bias    (HTF): close vs EMA(emaBias) AND slope(EMA) sign
 *   2. Regime  (HTF): ADX(adxPeriod) > adxMin  (else chop → HOLD)
 *   3. Trigger (working TF): pullback tags EMA(emaFast) AND RSI crosses rsiPullback
 *   4. Invalidation: recent swing low (BUY) / swing high (SELL) for the structural stop
 *
 * `htfRatio` toggles single- vs dual-TF: 1 → bias/regime on the working series (minus the
 * open bucket via aggregateHTF); 4 → bias/regime on the aggregated 4x series. Trigger is
 * always on the working candles. Closed-only aggregation → no look-ahead. Pure/deterministic.
 */
const TrendPullback = {
  execute(candles, config = {}) {
    const ind = config.indicators || {};
    const pick = (cam, sn, def) => {
      const v = [ind[cam], ind[sn]].find((x) => x !== undefined && x !== null);
      return v ?? def;
    };
    const emaBias = pick('emaBias', 'ema_bias', 200);
    const slopeLen = pick('slopeLen', 'slope_len', 20);
    const adxPeriod = pick('adxPeriod', 'adx_period', 14);
    const adxMin = pick('adxMin', 'adx_min', 22);
    const emaFast = pick('emaFast', 'ema_fast', 20);
    const rsiPeriod = pick('rsiPeriod', 'rsi_period', 14);
    const rsiPullback = pick('rsiPullback', 'rsi_pullback', 45);
    const htfRatio = pick('htfRatio', 'htf_ratio', 4);

    const HOLD = (extra = {}) => ({
      side: 'HOLD', bias: 0, regimeOK: false, adx: null, biasSlope: null,
      trigger: 0, rsi: null, emaFast: null, price: candles.length ? candles[candles.length - 1].close : null,
      invalidation: null, ...extra,
    });
    if (!Array.isArray(candles) || candles.length < 3) return HOLD();

    // --- HTF layers: bias + regime ---
    const htf = aggregateHTF(candles, htfRatio); // ratio=1 → working candles minus open bucket
    const htfClose = htf.map((c) => c.close);
    const emaBiasSeries = Technicals.ema(htfClose, emaBias);
    const biasSlope = Technicals.slope(emaBiasSeries, slopeLen);
    const adxSeries = Technicals.adx(htf, adxPeriod);
    const adx = adxSeries.length ? adxSeries[adxSeries.length - 1] : null;
    const lastHtfClose = htfClose.length ? htfClose[htfClose.length - 1] : null;
    const lastEmaBias = emaBiasSeries.length ? emaBiasSeries[emaBiasSeries.length - 1] : null;

    let bias = 0;
    if (lastHtfClose != null && lastEmaBias != null && biasSlope != null) {
      if (lastHtfClose > lastEmaBias && biasSlope > 0) bias = 1;
      else if (lastHtfClose < lastEmaBias && biasSlope < 0) bias = -1;
    }
    const regimeOK = adx != null && adx > adxMin;

    // --- working-TF trigger: pullback to fast EMA + RSI turn ---
    const close = candles.map((c) => c.close);
    const emaFastSeries = Technicals.ema(close, emaFast);
    const rsiSeries = Technicals.rsi(close, rsiPeriod);
    const lastClose = close[close.length - 1];
    const prevClose = close.length > 1 ? close[close.length - 2] : null;
    const lastEmaFast = emaFastSeries.length ? emaFastSeries[emaFastSeries.length - 1] : null;
    const rsiNow = rsiSeries.length ? rsiSeries[rsiSeries.length - 1] : null;
    const rsiPrev = rsiSeries.length > 1 ? rsiSeries[rsiSeries.length - 2] : null;

    let trigger = 0;
    if (lastEmaFast != null && rsiNow != null && rsiPrev != null && prevClose != null) {
      const touchedDown = Math.min(prevClose, lastClose) <= lastEmaFast;
      const rsiTurnUp = rsiPrev <= rsiPullback && rsiNow > rsiPullback;
      const touchedUp = Math.max(prevClose, lastClose) >= lastEmaFast;
      const rsiTurnDown = rsiPrev >= 100 - rsiPullback && rsiNow < 100 - rsiPullback;
      if (touchedDown && rsiTurnUp) trigger = 1;
      else if (touchedUp && rsiTurnDown) trigger = -1;
    }

    // --- resolve: all layers agree ---
    let side = 'HOLD';
    if (regimeOK && bias === 1 && trigger === 1) side = 'BUY';
    else if (regimeOK && bias === -1 && trigger === -1) side = 'SELL';

    // --- invalidation: recent swing extreme on working TF ---
    const swingLen = Math.max(emaFast, 10);
    const recent = candles.slice(-swingLen);
    const swingLow = Math.min(...recent.map((c) => c.low));
    const swingHigh = Math.max(...recent.map((c) => c.high));

    return {
      side, bias, regimeOK, adx, biasSlope, trigger,
      rsi: rsiNow, emaFast: lastEmaFast, price: lastClose,
      invalidation: side === 'BUY' ? swingLow : side === 'SELL' ? swingHigh : null,
    };
  },
};

export default TrendPullback;
