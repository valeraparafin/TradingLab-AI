export const VENUE = { SPOT: 'spot', FUT: 'fut' };

/**
 * A live local order book for one venue. Pure: callers feed it parsed snapshot/diff
 * events; it holds sorted top-N state and a READY/STALE flag. Prices are kept as string
 * keys (canonical, exact deletion on size 0); converted to numbers only for output.
 */
export class LocalOrderBook {
  constructor({ venue = VENUE.SPOT, depthLimit = 20 } = {}) {
    this.venue = venue;
    this.depthLimit = depthLimit;
    this.bids = new Map(); // priceStr -> sizeNum
    this.asks = new Map();
    this.lastUpdateId = null;
    this.state = 'INIT';   // INIT | READY | STALE
    this.staleReason = null;
    this.seeded = false;
  }

  applySnapshot({ lastUpdateId, bids, asks }) {
    this.bids = new Map();
    this.asks = new Map();
    for (const [px, q] of bids) this._set(this.bids, px, q);
    for (const [px, q] of asks) this._set(this.asks, px, q);
    this.lastUpdateId = lastUpdateId;
    this.staleReason = null;
    this.seeded = false;
    this.state = this._sane() ? 'READY' : 'STALE';
    if (this.state === 'STALE') this.staleReason = 'snapshot_insane';
    return this.state;
  }

  applyDiff(diff) {
    if (this.state !== 'READY') return this.state; // must resync via snapshot first
    const { U, u, pu, b = [], a = [] } = diff;
    if (this.venue === VENUE.FUT) {
      if (u < this.lastUpdateId) return this.state;        // stale diff, ignore
      // First diff after a snapshot seeds via range overlap (u >= lastUpdateId, guaranteed
      // by the ignore above); only subsequent diffs chain by pu === previous u.
      if (this.seeded && pu !== this.lastUpdateId) return this._markStale('seq_gap');
    } else {
      if (u <= this.lastUpdateId) return this.state;        // stale diff, ignore
      if (!(U <= this.lastUpdateId + 1)) return this._markStale('seq_gap');
    }
    for (const [px, q] of b) this._set(this.bids, px, q);
    for (const [px, q] of a) this._set(this.asks, px, q);
    this.lastUpdateId = u;
    this.seeded = true;
    if (!this._sane()) return this._markStale('crossed');
    return this.state;
  }

  _set(side, priceStr, qtyStr) {
    const q = Number(qtyStr);
    if (!(q > 0)) side.delete(priceStr);
    else side.set(priceStr, q);
  }

  _markStale(reason) { this.state = 'STALE'; this.staleReason = reason; return this.state; }

  _sortedBids() { return [...this.bids.entries()].map(([px, q]) => [Number(px), q]).sort((x, y) => y[0] - x[0]); }
  _sortedAsks() { return [...this.asks.entries()].map(([px, q]) => [Number(px), q]).sort((x, y) => x[0] - y[0]); }

  bestBid() { const b = this._sortedBids(); return b.length ? b[0][0] : null; }
  bestAsk() { const a = this._sortedAsks(); return a.length ? a[0][0] : null; }

  _sane() {
    const bb = this.bestBid(), ba = this.bestAsk();
    return bb != null && ba != null && bb < ba;
  }

  /** Top-N numeric book + readiness flag. */
  snapshotBook() {
    return {
      ready: this.state === 'READY',
      state: this.state,
      bids: this._sortedBids().slice(0, this.depthLimit),
      asks: this._sortedAsks().slice(0, this.depthLimit),
    };
  }
}
