// src/backtest/pumpDumpGate.js
import { isPumpDumpShort } from './pumpDump.js';
import { SIDE } from '../core/contracts.js';

/**
 * Wrap a decide fn so a PERMIT survives only when the signal is a SELL AND the current bar is
 * in a post-pump-dump state. Long side and non-eligible bars are vetoed (→ DENY). Inner DENY /
 * HOLD pass through unchanged. Same shape as withHtfGate / withUniverseGate.
 *
 * @param {(ctx:object, account:object)=>{signal:object, decision:object}} decide
 * @param {{pumpWindow?:number, pumpPct?:number, dumpPct?:number}} [opts] forwarded to isPumpDumpShort
 */
export function withPumpDumpGate(decide, opts = {}) {
  return (ctx, account) => {
    const result = decide(ctx, account);
    const d = result && result.decision;
    if (!d || d.decision !== 'PERMIT' || !d.order) return result;
    const side = result.signal && result.signal.side;
    if (side !== SIDE.SELL) {
      return { signal: result.signal, decision: { decision: 'DENY', reason: 'pump-dump gate: long side vetoed' } };
    }
    if (!isPumpDumpShort(ctx.candles, opts).eligible) {
      return { signal: result.signal, decision: { decision: 'DENY', reason: 'pump-dump gate: not post-pump-dump' } };
    }
    return result;
  };
}
