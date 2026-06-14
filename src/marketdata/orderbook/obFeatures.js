/**
 * Pure order-book features from a numeric top-N book snapshot.
 * @param {{ready:boolean, bids:[number,number][], asks:[number,number][]}} book sorted: bids desc, asks asc
 * @param {{depthBps?:number}} [opts] depth window half-width in basis points of mid
 * @returns {object|null} null when the book is not ready or one-sided
 */
export function computeBookFeatures(book, { depthBps = 30 } = {}) {
  if (!book || !book.ready || !book.bids?.length || !book.asks?.length) return null;
  const bestBid = book.bids[0][0], bestAsk = book.asks[0][0];
  const bbSize = book.bids[0][1], baSize = book.asks[0][1];
  const mid = (bestBid + bestAsk) / 2;
  const spread = bestAsk - bestBid;
  const microprice = (bestBid * baSize + bestAsk * bbSize) / (bbSize + baSize);

  const lo = mid * (1 - depthBps / 10000);
  const hi = mid * (1 + depthBps / 10000);
  const sumUsd = (levels, min, max) =>
    levels.reduce((s, [px, q]) => (px >= min && px <= max ? s + px * q : s), 0);
  const bidDepthNbps = sumUsd(book.bids, lo, mid);
  const askDepthNbps = sumUsd(book.asks, mid, hi);
  const denom = bidDepthNbps + askDepthNbps;
  const imbalance = denom > 0 ? (bidDepthNbps - askDepthNbps) / denom : 0;

  const nearWall = (levels) => {
    let best = null;
    for (const [px, q] of levels) {
      const sizeUsd = px * q;
      if (!best || sizeUsd > best.sizeUsd) best = { px, sizeUsd, distBps: Math.abs(px - mid) / mid * 10000 };
    }
    return best;
  };

  return {
    mid, spread, microprice, bidDepthNbps, askDepthNbps, imbalance,
    nearWallBid: nearWall(book.bids), nearWallAsk: nearWall(book.asks),
  };
}
