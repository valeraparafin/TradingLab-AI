import { LocalOrderBook } from './LocalOrderBook.js';
import { computeBookFeatures } from './obFeatures.js';

/**
 * Re-drive the pure core from recorded book events and emit the feature stream.
 * Trade frames are ignored here (book-only replay); a feature row is produced per
 * snapshot/depth event so the output mirrors what the live book computed.
 * @param {object[]} events parsed JSONL frames for ONE venue
 * @param {{venue:string, depthLimit?:number, bookOpts?:object}} cfg
 */
export function replayEvents(events, { venue, depthLimit = 20, bookOpts = {} } = {}) {
  const book = new LocalOrderBook({ venue, depthLimit });
  const out = [];
  for (const ev of events) {
    if (ev.k === 'snapshot') {
      book.applySnapshot({ lastUpdateId: ev.lastUpdateId, bids: ev.bids, asks: ev.asks });
    } else if (ev.k === 'depth') {
      book.applyDiff({ U: ev.U, u: ev.u, pu: ev.pu, b: ev.b || [], a: ev.a || [] });
    } else {
      continue; // trade / state frames are not book events
    }
    out.push(computeBookFeatures(book.snapshotBook(), bookOpts));
  }
  return out;
}
