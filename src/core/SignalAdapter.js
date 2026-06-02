import { SIDE } from './contracts.js';

const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
const hold = (reason) => ({ side: SIDE.HOLD, conviction: 0, reason, invalidation: null });

/** SMC: structure.trend drives side; BOS/CHoCH + order-block add conviction. */
function fromSMC(raw) {
  const trend = raw?.structure?.trend ?? 0;
  const side = trend === 1 ? SIDE.BUY : trend === -1 ? SIDE.SELL : SIDE.HOLD;
  if (side === SIDE.HOLD) return hold('SMC: neutral structure');
  let conviction = 0.6;
  const events = raw?.structure?.structure ?? [];
  if (events.length > 0) conviction += 0.2;
  const obs = raw?.obs ?? [];
  if (obs.length > 0 && obs[0]?.range?.top > 0) conviction += 0.1;
  const invalidation = events.length ? events[events.length - 1].price : null;
  return { side, conviction: clamp(conviction), reason: `SMC structure ${side}`, invalidation };
}

/**
 * Dispatch raw indicator output to the matching pure mapper.
 * @param {string} logicType @param {object} raw @param {{price:number, candles:object[]}} ctx
 * @returns {import('./contracts.js').Signal}
 */
export function deriveSignal(logicType, raw, ctx) {
  switch (String(logicType).toUpperCase()) {
    case 'SMC': return fromSMC(raw);
    default: throw new Error(`Unsupported logicType: ${logicType}`);
  }
}
