// src/marketdata/orderbook/replaySignals.js
import { levelFromCandles } from './levels.js';
import { breakoutSignal } from './breakoutSignal.js';
import { withOrderBookGate } from './obGate.js';

/**
 * Pure replay core: drive feature snapshots + candles through the SP2a pipeline and
 * collect PERMITted signals. The candle level is computed once from `candles` (the
 * reference the live mid must cross); `prevMid` is tracked across snapshots.
 * @param {object[]} snapshots SP1 feature snapshots in time order
 * @param {{high:number,low:number}[]} candles
 * @param {{level?:object, signal?:object, gate?:object}} [opts]
 * @returns {Array<{ts:number, side:string, setup:string, conviction:number, rationale:string, invalidation:object}>}
 */
export function replaySignals(snapshots, candles, opts = {}) {
  const level = levelFromCandles(candles, opts.level);
  const decide = (ctx) => {
    const sig = breakoutSignal({ level, feat: ctx.feat, prevMid: ctx.prevMid, opts: opts.signal });
    if (!sig) return { signal: null, decision: { decision: 'HOLD' } };
    return { signal: sig, decision: { decision: 'PERMIT', order: { side: sig.side } } };
  };
  const gated = withOrderBookGate(decide, opts.gate);

  const out = [];
  let prevMid = null;
  for (const feat of snapshots) {
    const r = gated({ feat, prevMid }, {});
    if (r.signal && r.decision.decision === 'PERMIT') {
      out.push({ ts: feat.ts, ...r.signal });
    }
    if (feat.ready && feat.futures) prevMid = feat.futures.mid;
  }
  return out;
}
