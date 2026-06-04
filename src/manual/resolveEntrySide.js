// src/manual/resolveEntrySide.js
import { legacyManualSide } from './legacyManualSide.js';
import { deriveSignal } from '../core/SignalAdapter.js';

/**
 * Resolve the entry side for the manual path, choosing source by the feature flag.
 * Pure: the caller resolves `useSignalCore` (env / per-strategy config) and passes it in.
 *
 * @param {object} args
 * @param {string|null} args.logicType
 * @param {object} args.strategyData - IndicatorManager.calculate(...) result
 * @param {number} args.price
 * @param {object[]} args.candles
 * @param {boolean} args.useSignalCore - false → legacy rule; true → pure core
 * @returns {{ side: 'BUY'|'SELL', skip: false } | { side: null, skip: true, reason: string }}
 */
export function resolveEntrySide({ logicType, strategyData, price, candles, useSignalCore }) {
  if (!useSignalCore) {
    return { side: legacyManualSide(logicType, strategyData, price), skip: false };
  }
  // deriveSignal throws on an unsupported/unknown logicType. On the live ON path
  // that must not crash the trading loop: treat it as a logged config error and
  // skip the entry (no trade), exactly as the spec (§4) prescribes.
  let signal;
  try {
    signal = deriveSignal(logicType, strategyData, { price, candles });
  } catch (err) {
    return { side: null, skip: true, reason: `unsupported logicType for signal core: ${err.message}` };
  }
  if (signal.side === 'HOLD') {
    return { side: null, skip: true, reason: signal.reason || 'signal core HOLD' };
  }
  return { side: signal.side, skip: false };
}
