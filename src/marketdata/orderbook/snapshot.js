import { computeBookFeatures } from './obFeatures.js';
import { computeTapeFeatures } from './tapeFeatures.js';

/**
 * Pure builder for the dual-book getFeatures contract.
 * Futures is primary (drives `ready` + carries the tape); spot is confirmation (`spotReady`).
 * @param {{symbol:string, ts:number, now:number,
 *          futBook:object, futTrades:object[], spotBook:object|null,
 *          opts:{book?:object, tape?:object}}} args
 */
export function buildSnapshot({ symbol, ts, now, futBook, futTrades, spotBook, opts = {} }) {
  const futFeat = computeBookFeatures(futBook, opts.book);
  const ready = futFeat != null;
  const tape = computeTapeFeatures(futTrades, now, opts.tape);
  const spotFeat = computeBookFeatures(spotBook, opts.book);
  const spotReady = spotFeat != null;
  return {
    ready,
    spotReady,
    ts,
    symbol,
    futures: ready ? { ...futFeat, ...tape } : null,
    spot: spotReady ? spotFeat : null,
  };
}
