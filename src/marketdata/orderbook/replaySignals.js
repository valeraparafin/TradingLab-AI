// src/marketdata/orderbook/replaySignals.js
import { levelFromCandles } from './levels.js';
import { breakoutSignal } from './breakoutSignal.js';
import { withOrderBookGate } from './obGate.js';
import { LocalOrderBook, VENUE } from './LocalOrderBook.js';
import { buildSnapshot } from './snapshot.js';

/**
 * Pure replay core: drive feature snapshots + candles through the SP2a pipeline and
 * collect PERMITted signals. `prevMid` is tracked across snapshots.
 *
 * Level modes:
 *  - default (static): the level is computed once from all `candles` — cheap offline feedback,
 *    but the mid crosses a fixed level at most once or twice in a window (SP2a simplification).
 *  - `opts.rolling: true`: recompute the level per snapshot from candles whose `time <= feat.ts`
 *    (trailing structure as of that moment). Requires candles to carry a `time` field. This is
 *    the fair test — breakouts of evolving structure fire throughout the window.
 *
 * @param {object[]} snapshots SP1 feature snapshots in time order
 * @param {{high:number,low:number,time?:number}[]} candles
 * @param {{level?:object, signal?:object, gate?:object, rolling?:boolean}} [opts]
 * @returns {Array<{ts:number, side:string, setup:string, conviction:number, rationale:string, invalidation:object}>}
 */
export function replaySignals(snapshots, candles, opts = {}) {
  const rolling = !!opts.rolling;
  // `level` is closed over by `decide` and reassigned per snapshot when rolling; decide reads it
  // at call time, so a single decide/gate pair stays correct across an evolving level.
  let level = levelFromCandles(candles, opts.level);
  const decide = (ctx) => {
    const sig = breakoutSignal({ level, feat: ctx.feat, prevMid: ctx.prevMid, opts: opts.signal });
    if (!sig) return { signal: null, decision: { decision: 'HOLD' } };
    return { signal: sig, decision: { decision: 'PERMIT', order: { side: sig.side } } };
  };
  const gated = withOrderBookGate(decide, opts.gate);

  const out = [];
  let prevMid = null;
  for (const feat of snapshots) {
    if (rolling) {
      const trailing = candles.filter((c) => c.time != null && c.time <= feat.ts);
      level = levelFromCandles(trailing, opts.level);
    }
    const r = gated({ feat, prevMid }, {});
    if (r.signal && r.decision.decision === 'PERMIT') {
      out.push({ ts: feat.ts, ...r.signal });
    }
    if (feat.ready && feat.futures) prevMid = feat.futures.mid;
  }
  return out;
}

/**
 * Re-drive both venue books from parsed, time-ordered frames and emit a dual-book feature
 * snapshot at each FUTURES book event (futures is primary). Spot events update the spot book
 * but do not emit; futures trade frames feed the rolling tape only. Pure: callers parse the JSONL.
 * @param {object[]} frames parsed lines {t, sym, v, k, ...} for BOTH venues, time-ordered
 * @param {{symbol:string, depthLimit?:number, bookOpts?:object, tapeOpts?:object, tapeWindowMs?:number}} cfg
 * @returns {object[]} SP1 feature snapshots
 */
export function framesToSnapshots(frames, { symbol, depthLimit = 20, bookOpts = {}, tapeOpts = {}, tapeWindowMs = 5000 } = {}) {
  const fut = new LocalOrderBook({ venue: VENUE.FUT, depthLimit });
  const spot = new LocalOrderBook({ venue: VENUE.SPOT, depthLimit });
  let trades = [];
  const out = [];

  for (const ev of frames) {
    const book = ev.v === VENUE.SPOT ? spot : fut;
    if (ev.k === 'snapshot') {
      book.applySnapshot({ lastUpdateId: ev.lastUpdateId, bids: ev.bids, asks: ev.asks });
    } else if (ev.k === 'depth') {
      book.applyDiff({ U: ev.U, u: ev.u, pu: ev.pu, b: ev.b || [], a: ev.a || [] });
    } else if (ev.k === 'trade' && ev.v === VENUE.FUT) {
      trades.push({ t: ev.t, p: ev.p, q: ev.q, m: ev.m });
      trades = trades.filter((tr) => ev.t - tr.t <= tapeWindowMs);
      continue; // trade frames feed the tape, never emit
    } else {
      continue; // state frames, spot trades, etc.
    }
    if (ev.v !== VENUE.FUT) continue; // emit only on a futures book event

    out.push(buildSnapshot({
      symbol, ts: ev.t, now: ev.t,
      futBook: fut.snapshotBook(),
      futTrades: trades,
      spotBook: spot.snapshotBook(),
      opts: { book: bookOpts, tape: tapeOpts },
    }));
  }
  return out;
}
