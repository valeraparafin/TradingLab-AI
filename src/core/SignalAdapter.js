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

/** WaveTrend: wt cross drives side; MFI / StochRSI / STC confluence add conviction. */
function fromWaveTrend(raw) {
  const side = raw?.wtCrossUp ? SIDE.BUY : raw?.wtCrossDown ? SIDE.SELL : SIDE.HOLD;
  if (side === SIDE.HOLD) return hold('WaveTrend: no cross');
  let conviction = 0.5;
  const mfi = raw?.mfi ?? 50;
  if ((side === SIDE.BUY && mfi > 50) || (side === SIDE.SELL && mfi < 50)) conviction += 0.2;
  const k = raw?.stochRsi?.k ?? 50; // 0..100
  if ((side === SIDE.BUY && k < 80) || (side === SIDE.SELL && k > 20)) conviction += 0.15;
  const stc = raw?.stc ?? 50; // 0..100
  if ((side === SIDE.BUY && stc > 50) || (side === SIDE.SELL && stc < 50)) conviction += 0.15;
  return { side, conviction: clamp(conviction), reason: `WaveTrend cross ${side}`, invalidation: null };
}

/** Breakout: needs the latest price to decide direction relative to the channel. */
function fromBreakout(raw, ctx) {
  const ch = raw?.channel;
  if (!ch || !ch.active) return hold('Breakout: channel inactive');
  const price = ctx.price;
  let side = SIDE.HOLD;
  if (price > ch.top) side = SIDE.BUY;
  else if (price < ch.bottom) side = SIDE.SELL;
  if (side === SIDE.HOLD) return hold('Breakout: price inside channel');
  const width = ch.top - ch.bottom;
  const dist = side === SIDE.BUY ? price - ch.top : ch.bottom - price;
  const conviction = clamp(0.55 + (width > 0 ? dist / width : 0), 0, 0.9);
  const invalidation = side === SIDE.BUY ? ch.bottom : ch.top;
  return { side, conviction, reason: `Breakout ${side}`, invalidation };
}

/**
 * Dispatch raw indicator output to the matching pure mapper.
 * @param {string} logicType @param {object} raw @param {{price:number, candles:object[]}} ctx
 * @returns {import('./contracts.js').Signal}
 */
export function deriveSignal(logicType, raw, ctx) {
  switch (String(logicType).toUpperCase()) {
    case 'SMC': return fromSMC(raw);
    case 'VMC_CIPHERB': return fromWaveTrend(raw);
    case 'BREAKOUT': return fromBreakout(raw, ctx);
    default: throw new Error(`Unsupported logicType: ${logicType}`);
  }
}
