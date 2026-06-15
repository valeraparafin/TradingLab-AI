// src/agents/ObAnalyst.js
// Pure: a drained order-book signal record (obSignalLog.signalRecord shape) → the
// QualitativeProposal contract RiskPolicy consumes. Carries entryMid so the orchestrator
// prices the order at the signal's own mid (not a lagging candle). No I/O.

/** HOLD proposal — RiskPolicy DENYs it (no trade). */
function holdProposal(reason = 'no order-book signal') {
  return { side: 'HOLD', conviction: 0, rationale: reason, invalidationIdea: null, entryMid: null };
}

/**
 * @param {{side?:string, conviction?:number, entryMid?:number,
 *          invalidation?:number|null, rationale?:string}|null} rec
 * @returns {{side:string, conviction:number, rationale:string,
 *            invalidationIdea:number|null, entryMid:number|null}}
 */
export function proposalFromSignal(rec) {
  if (!rec || (rec.side !== 'BUY' && rec.side !== 'SELL')) {
    return holdProposal(rec ? `unusable signal side ${rec.side}` : 'null signal record');
  }
  return {
    side: rec.side,
    conviction: typeof rec.conviction === 'number' ? rec.conviction : 0,
    rationale: rec.rationale || `order-book ${rec.side}`,
    invalidationIdea: typeof rec.invalidation === 'number' && isFinite(rec.invalidation) ? rec.invalidation : null,
    entryMid: typeof rec.entryMid === 'number' && isFinite(rec.entryMid) ? rec.entryMid : null,
  };
}
