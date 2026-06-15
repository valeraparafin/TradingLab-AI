// src/marketdata/orderbook/obSignalLog.js
// Pure formatters for the live signal/outcome JSONL log + the forward-outcome math.
// Mirrors the per-signal calc in replayScore.scoreSignals, kept pure for the live engine.

/** Realized move of a signal over a horizon, net of round-trip cost. */
export function outcomeBps({ entryMid, exitMid, side, costBps = 5 }) {
  const dir = side === 'SELL' ? -1 : 1;
  const grossBps = (dir * (exitMid - entryMid) / entryMid) * 1e4;
  const netBps = grossBps - costBps;
  return { grossBps, netBps, win: netBps > 0 };
}

/** One 'signal' log line. `sig` is a breakoutSignal result; invalidation flattened to its number. */
export function signalRecord({ t, sym, sig, entryMid, level }) {
  return {
    t, type: 'signal', sym,
    side: sig.side, setup: sig.setup, conviction: sig.conviction,
    entryMid,
    invalidation: sig.invalidation ? sig.invalidation.backInsideRange : null,
    level: level ? { resistance: level.resistance, support: level.support } : null,
    rationale: sig.rationale,
  };
}

/** One 'outcome' log line, computed from entry/exit mids. */
export function outcomeRecord({ t, sym, side, entryMid, exitMid, horizonMs, costBps = 5 }) {
  const { grossBps, netBps, win } = outcomeBps({ entryMid, exitMid, side, costBps });
  return { t, type: 'outcome', sym, side, entryMid, exitMid, horizonMs, grossBps, netBps, win };
}
