// src/manual/resolveSignalExit.js
/**
 * Pure helpers for the signal-driven exit mode (stop-and-reverse).
 * The engine wires these in; they do no I/O.
 */

/** Persistent-state side: long state → BUY, short state → SELL, neutral → HOLD. */
export function signalStateSide(strategyData = {}) {
  const state = strategyData.state ?? 0;
  return state === 1 ? 'BUY' : state === -1 ? 'SELL' : 'HOLD';
}

/**
 * Decide whether an open position should close because the indicator state flipped.
 * @param {{ exitMode: string, positionSide: 'BUY'|'SELL', strategyData: object }} args
 * @returns {{ exit: boolean, reason: string }}
 */
export function resolveSignalExit({ exitMode, positionSide, strategyData = {} }) {
  if (exitMode !== 'signal') return { exit: false, reason: 'not signal mode' };
  const desired = signalStateSide(strategyData);
  if (desired !== 'HOLD' && desired !== positionSide) {
    return { exit: true, reason: `signal flip to ${desired}` };
  }
  return { exit: false, reason: 'state aligned' };
}
