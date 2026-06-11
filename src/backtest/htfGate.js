// src/backtest/htfGate.js
import { aggregateHTF } from '../core/aggregateHTF.js';
import { classifyHTFTrend } from '../core/classifyHTFTrend.js';

/** with/against/neutral for a trade side given an UP/DOWN/NEUTRAL HTF verdict. */
export function bucketOf(side, verdict) {
  if (verdict === 'NEUTRAL') return 'neutral';
  if (verdict === 'UP') return side === 'BUY' ? 'with' : 'against';
  return side === 'SELL' ? 'with' : 'against'; // DOWN
}

/**
 * Wrap a decide function with an HTF emaBand gate (backtest-only). When the inner decision
 * is a PERMIT whose order side runs AGAINST the HTF emaBand trend, flip it to DENY; `with`
 * and `neutral` pass through unchanged, as does any inner DENY. Pure and deterministic: the
 * HTF verdict is derived from ctx.candles via closed-only aggregation (no look-ahead).
 *
 * @param {(ctx:object, account:object)=>{signal:object, decision:object}} decide inner fn (e.g. evaluateBar)
 * @param {{ratio:number, emaPeriod:number, band:number}} opts
 * @returns {(ctx:object, account:object)=>{signal:object, decision:object}}
 */
export function withHtfGate(decide, opts) {
  const { ratio, emaPeriod, band } = opts;
  return (ctx, account) => {
    const result = decide(ctx, account);
    const d = result && result.decision;
    if (!d || d.decision !== 'PERMIT' || !d.order) return result;

    const htf = aggregateHTF(ctx.candles, ratio);
    const verdict = classifyHTFTrend(htf, { emaPeriod, band }).emaBand;
    if (bucketOf(d.order.side, verdict) === 'against') {
      return {
        signal: result.signal,
        decision: { decision: 'DENY', reason: `HTF gate: ${d.order.side} against ${verdict} trend (emaBand)` },
      };
    }
    return result;
  };
}
