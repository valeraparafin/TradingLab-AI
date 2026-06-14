// src/marketdata/orderbook/replayScore.js
// Pure forward-outcome scorer for replayed order-book signals. Given the signals collected by
// replaySignals and the snapshot stream they came from, measure where the futures mid went over
// a fixed horizon after each signal, net of a round-trip cost assumption. This turns "how many
// signals" into "did they have an edge" — the actual go/no-go number for the order-book pivot.

/** First ready futures mid at or after `ts`, else null. snapshots must be time-ordered. */
function midAtOrAfter(snapshots, ts) {
  for (const s of snapshots) {
    if (s.ts >= ts && s.ready && s.futures) return s.futures.mid;
  }
  return null;
}

/**
 * Score signals by realized forward move net of costs.
 * @param {object[]} snapshots time-ordered SP1 feature snapshots (same stream replaySignals saw)
 * @param {Array<{ts:number, side:'BUY'|'SELL', conviction?:number}>} signals
 * @param {{horizonMs?:number, costBps?:number}} [opts]
 *   horizonMs: forward window per signal (default 60_000). costBps: round-trip cost in bps
 *   (spread + fees) subtracted from each signal's directional return (default 5).
 * @returns {{n:number, resolved:number, wins:number, hitRate:number, avgNetBps:number,
 *            totalNetBps:number, avgGrossBps:number, horizonMs:number, costBps:number,
 *            perSignal:Array<{ts:number, side:string, grossBps:number, netBps:number}>}}
 *   hitRate/avgNetBps are over *resolved* signals (those with a forward mid in-window).
 */
export function scoreSignals(snapshots, signals, { horizonMs = 60_000, costBps = 5 } = {}) {
  const perSignal = [];
  let wins = 0, totalNetBps = 0, totalGrossBps = 0;
  for (const sig of signals || []) {
    const entry = midAtOrAfter(snapshots, sig.ts);
    const exit = midAtOrAfter(snapshots, sig.ts + horizonMs);
    if (entry == null || exit == null || entry <= 0) continue; // unresolved → excluded
    const dir = sig.side === 'SELL' ? -1 : 1;
    const grossBps = (dir * (exit - entry) / entry) * 1e4;
    const netBps = grossBps - costBps;
    if (netBps > 0) wins++;
    totalNetBps += netBps;
    totalGrossBps += grossBps;
    perSignal.push({ ts: sig.ts, side: sig.side, grossBps, netBps });
  }
  const resolved = perSignal.length;
  return {
    n: (signals || []).length,
    resolved,
    wins,
    hitRate: resolved ? wins / resolved : 0,
    avgNetBps: resolved ? totalNetBps / resolved : 0,
    avgGrossBps: resolved ? totalGrossBps / resolved : 0,
    totalNetBps,
    horizonMs,
    costBps,
    perSignal,
  };
}
