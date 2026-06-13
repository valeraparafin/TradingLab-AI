// src/backtest/universeGate.js
import { dayKey } from './historicalUniverse.js';

/**
 * Wrap a decide fn so a PERMIT is vetoed (→ DENY) when `symbol` is not in that bar-day's
 * pick list. The day is taken from the last candle's time (closed-only; no look-ahead).
 * Inner DENY / HOLD pass through unchanged. Same shape as withHtfGate.
 *
 * @param {(ctx:object, account:object)=>{signal:object, decision:object}} decide
 * @param {Record<string,string[]>} picksByDay dayKey → selected symbols
 * @param {string} symbol the symbol being simulated
 */
export function withUniverseGate(decide, picksByDay, symbol) {
  return (ctx, account) => {
    const result = decide(ctx, account);
    const d = result && result.decision;
    if (!d || d.decision !== 'PERMIT' || !d.order) return result;
    const cs = ctx.candles;
    const k = dayKey(cs[cs.length - 1].time);
    const picks = picksByDay[k] || [];
    if (!picks.includes(symbol)) {
      return { signal: result.signal, decision: { decision: 'DENY', reason: `universe gate: ${symbol} not selected on ${k}` } };
    }
    return result;
  };
}
