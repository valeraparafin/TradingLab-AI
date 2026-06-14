// src/marketdata/orderbook/obGate.js
import { SIDE } from '../../core/contracts.js';

/**
 * Wrap a decide fn so a PERMIT survives only when the live order book confirms it.
 * Reads the SP1 snapshot from ctx.feat. Inner DENY/HOLD/non-PERMIT pass through.
 * Same {signal, decision} shape as withPumpDumpGate / withHtfGate so it composes.
 * @param {(ctx:object, account:object)=>{signal:object, decision:object}} decide
 * @param {{maxSpreadBps?:number}} [opts]
 */
export function withOrderBookGate(decide, opts = {}) {
  const maxSpreadBps = opts.maxSpreadBps ?? 8;
  return (ctx, account) => {
    const result = decide(ctx, account);
    const d = result && result.decision;
    if (!d || d.decision !== 'PERMIT' || !d.order) return result;

    const feat = ctx && ctx.feat;
    if (!feat || !feat.ready || !feat.futures) {
      return { signal: result.signal, decision: { decision: 'DENY', reason: 'ob gate: book not ready' } };
    }
    const f = feat.futures;
    if (f.spread / f.mid > maxSpreadBps / 10000) {
      return { signal: result.signal, decision: { decision: 'DENY', reason: 'ob gate: spread too wide' } };
    }
    const side = result.signal && result.signal.side;
    if ((side === SIDE.BUY && f.imbalance < 0) || (side === SIDE.SELL && f.imbalance > 0)) {
      return { signal: result.signal, decision: { decision: 'DENY', reason: 'ob gate: book contradicts side' } };
    }
    return result;
  };
}
