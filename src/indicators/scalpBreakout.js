// src/indicators/scalpBreakout.js
import { SIDE } from '../core/contracts.js';

const pick = (cfg, a, b, d) => (cfg && cfg[a] != null ? cfg[a] : (cfg && cfg[b] != null ? cfg[b] : d));
const rangeOf = (arr) => Math.max(...arr.map(c => c.high)) - Math.min(...arr.map(c => c.low));

/**
 * ProScalping-style level-breakout setup (candle-only; order book excluded).
 * Detects a tested level (cluster of touches), requires consolidation (pinch), then a
 * breakout close. Returns the broken level as `invalidation` (structural stop sits behind it).
 */
export default class ScalpBreakout {
  static execute(candles, config = {}) {
    const lookback = pick(config, 'lookback', 'lookback', 30);
    const minTouches = pick(config, 'minTouches', 'min_touches', 2);
    const touchTol = pick(config, 'touchTol', 'touch_tol', 0.0015);
    const breakoutMargin = pick(config, 'breakoutMargin', 'breakout_margin', 0.0005);
    const pinchBars = pick(config, 'pinchBars', 'pinch_bars', 6);
    const pinchRatio = pick(config, 'pinchRatio', 'pinch_ratio', 0.7);
    if (candles.length < lookback + 1) return { side: SIDE.HOLD, invalidation: null, level: null, touches: 0 };

    const prior = candles.slice(candles.length - lookback - 1, candles.length - 1); // lookback bars, excl current
    const cur = candles[candles.length - 1];
    const res = Math.max(...prior.map(c => c.high));
    const sup = Math.min(...prior.map(c => c.low));
    const resTouches = prior.filter(c => Math.abs(c.high - res) / res <= touchTol).length;
    const supTouches = prior.filter(c => Math.abs(c.low - sup) / sup <= touchTol).length;

    // Pinch: recent pinchBars range must be <= pinchRatio * the preceding pinchBars range.
    const recent = prior.slice(-pinchBars);
    const earlier = prior.slice(-2 * pinchBars, -pinchBars);
    const pinchOk = earlier.length === 0 ? true : rangeOf(recent) <= pinchRatio * rangeOf(earlier);

    const price = cur.close;
    if (pinchOk && resTouches >= minTouches && price > res * (1 + breakoutMargin)) {
      return { side: SIDE.BUY, invalidation: res, level: res, touches: resTouches };
    }
    if (pinchOk && supTouches >= minTouches && price < sup * (1 - breakoutMargin)) {
      return { side: SIDE.SELL, invalidation: sup, level: sup, touches: supTouches };
    }
    return { side: SIDE.HOLD, invalidation: null, level: null, touches: 0 };
  }
}
