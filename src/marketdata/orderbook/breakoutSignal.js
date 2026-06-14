// src/marketdata/orderbook/breakoutSignal.js
import { SIDE } from '../../core/contracts.js';

const DEF = { imbThresh: 0.15, aggThresh: 0.15, minVelocity: 0.5, spotBoost: 0.1, spotPenalty: 0.15 };
const clamp01 = (x) => Math.max(0, Math.min(1, x));

/**
 * Deterministic breakout-confirm signal. Candles define the level; the order book + tape
 * confirm a mid *cross* has impulse. Spot is a SOFT confirm (conviction only, never blocks).
 * @param {{level:{resistance:number|null,support:number|null}, feat:object,
 *          prevMid:number|null, opts?:object}} args
 *   feat = one SP1 snapshot: {ready, spotReady, ts, futures, spot}
 * @returns {{side:string, setup:'breakout', conviction:number, rationale:string,
 *            invalidation:{backInsideRange:number}} | null}
 */
export function breakoutSignal({ level, feat, prevMid, opts = {} }) {
  const o = { ...DEF, ...opts };
  if (!feat || !feat.ready || !feat.futures) return null;
  if (prevMid == null) return null;
  if (!level || level.resistance == null || level.support == null) return null;

  const f = feat.futures;
  const mid = f.mid;

  // Trigger: detect the cross, not merely "currently beyond".
  let side = null, brokenLevel = null;
  if (prevMid <= level.resistance && mid > level.resistance) { side = SIDE.BUY; brokenLevel = level.resistance; }
  else if (prevMid >= level.support && mid < level.support) { side = SIDE.SELL; brokenLevel = level.support; }
  if (!side) return null;

  // Book confirm: directional imbalance (already encodes depth asymmetry — bid-heavy ⇒ thin asks
  // for a BUY), tape aggression, and a live tape. Wall-based "thin opposite side" tuning is SP2b.
  const dir = side === SIDE.BUY ? 1 : -1;
  const imbOk = dir * f.imbalance > o.imbThresh;
  const aggOk = dir * f.aggressorImbalance > o.aggThresh;
  const velOk = f.printVelocity >= o.minVelocity;
  if (!(imbOk && aggOk && velOk)) return null;

  // Base conviction from alignment strength of book imbalance + tape aggression.
  const align = (Math.min(Math.abs(f.imbalance), 1) + Math.min(Math.abs(f.aggressorImbalance), 1)) / 2;
  let conviction = clamp01(align);

  // Spot SOFT-confirm.
  if (feat.spotReady && feat.spot) {
    const spotDir = dir * feat.spot.imbalance;
    if (spotDir > o.imbThresh) conviction += o.spotBoost;
    else if (spotDir < -o.imbThresh) conviction -= o.spotPenalty;
    conviction = clamp01(conviction);
  }

  return {
    side,
    setup: 'breakout',
    conviction,
    rationale: `breakout ${side} thru ${brokenLevel}: imb=${f.imbalance.toFixed(2)} agg=${f.aggressorImbalance.toFixed(2)} vel=${f.printVelocity.toFixed(1)}`,
    invalidation: { backInsideRange: brokenLevel },
  };
}
