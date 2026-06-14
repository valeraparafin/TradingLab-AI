import { LocalOrderBook, VENUE } from './LocalOrderBook.js';
import { BinanceDepthClient } from './BinanceDepthClient.js';
import { buildSnapshot } from './snapshot.js';
import { Recorder } from './Recorder.js';

/**
 * Live dual-book feed. Per symbol it runs a futures (primary) + spot (confirmation)
 * LocalOrderBook fed by a BinanceDepthClient each, keeps a rolling futures tape, exposes
 * getFeatures(symbol), and records every raw frame via Recorder.
 *
 * Diff buffering during the initial REST sync: events arriving before the snapshot are
 * buffered, then applied in order once the snapshot lands (Binance canonical procedure).
 */
export class OrderBookFeed {
  constructor({ symbols, depthLimit = 20, tapeWindowMs = 5000, depthBps = 30, record = true, recorderRoot = 'data/orderbook' } = {}) {
    // symbols: [{ futures:'GPSUSDT', spot:'GPSUSDT'|null }]
    this.symbols = symbols;
    this.depthLimit = depthLimit;
    this.opts = { book: { depthBps }, tape: { windowMs: tapeWindowMs } };
    this.recorder = record ? new Recorder({ root: recorderRoot }) : null;
    this.books = new Map(); // futuresSymbol -> { fut, spot, trades, clients, buffers }
    this.stopped = false;
  }

  start() {
    for (const pair of this.symbols) this._startSymbol(pair);
  }

  _startSymbol(pair) {
    const key = pair.futures;
    const entry = {
      fut: new LocalOrderBook({ venue: VENUE.FUT, depthLimit: this.depthLimit }),
      spot: pair.spot ? new LocalOrderBook({ venue: VENUE.SPOT, depthLimit: this.depthLimit }) : null,
      trades: [],
      clients: [],
      buffers: { fut: [], spot: [] },
      synced: { fut: false, spot: false },
    };
    this.books.set(key, entry);

    entry.clients.push(this._venueClient(key, pair.futures, 'fut', entry));
    if (pair.spot) entry.clients.push(this._venueClient(key, pair.spot, 'spot', entry));
    for (const c of entry.clients) c.connect();
    this._syncVenue(key, pair.futures, 'fut', entry);
    if (pair.spot) this._syncVenue(key, pair.spot, 'spot', entry);
  }

  _book(entry, venue) { return venue === 'fut' ? entry.fut : entry.spot; }

  _venueClient(key, venueSymbol, venue, entry) {
    return new BinanceDepthClient({
      symbol: venueSymbol,
      venue,
      depthLimit: this.depthLimit,
      onDepth: (d) => {
        if (this.recorder) this.recorder.write(key, venue, d.t || Date.now(), { k: 'depth', U: d.U, u: d.u, pu: d.pu, b: d.b, a: d.a });
        if (!entry.synced[venue]) { entry.buffers[venue].push(d); return; }
        const before = this._book(entry, venue).state;
        const after = this._book(entry, venue).applyDiff({ U: d.U, u: d.u, pu: d.pu, b: d.b, a: d.a });
        if (after === 'STALE' && before !== 'STALE') this._onStale(key, venueSymbol, venue, entry);
      },
      onTrade: (tr) => {
        if (this.recorder) this.recorder.write(key, venue, tr.t, { k: 'trade', p: tr.p, q: tr.q, m: tr.m });
        entry.trades.push(tr);
        const cutoff = Date.now() - this.opts.tape.windowMs * 4;
        while (entry.trades.length && entry.trades[0].t < cutoff) entry.trades.shift();
      },
      onStatus: (s) => { if (s === 'close' && !this.stopped) { entry.synced[venue] = false; entry.buffers[venue] = []; this._syncVenue(key, venueSymbol, venue, entry); } },
    });
  }

  async _syncVenue(key, venueSymbol, venue, entry) {
    if (this.stopped) return;
    const client = entry.clients.find((c) => c.venue === venue);
    try {
      const snap = await client.fetchSnapshot();
      if (this.recorder) this.recorder.write(key, venue, Date.now(), { k: 'snapshot', lastUpdateId: snap.lastUpdateId, bids: snap.bids, asks: snap.asks });
      this._book(entry, venue).applySnapshot(snap);
      const buffered = entry.buffers[venue];
      entry.buffers[venue] = [];
      for (const d of buffered) {
        if (d.u <= snap.lastUpdateId) continue; // pre-snapshot diff
        this._book(entry, venue).applyDiff({ U: d.U, u: d.u, pu: d.pu, b: d.b, a: d.a });
      }
      entry.synced[venue] = true;
      if (this._book(entry, venue).state === 'STALE') this._onStale(key, venueSymbol, venue, entry);
    } catch (e) {
      setTimeout(() => this._syncVenue(key, venueSymbol, venue, entry), 2000); // retry snapshot
    }
  }

  _onStale(key, venueSymbol, venue, entry) {
    if (this.recorder) this.recorder.write(key, venue, Date.now(), { k: 'state', state: 'STALE', reason: this._book(entry, venue).staleReason });
    entry.synced[venue] = false;
    entry.buffers[venue] = [];
    this._syncVenue(key, venueSymbol, venue, entry);
  }

  /** Dual-book feature snapshot for one (futures) symbol. */
  getFeatures(futuresSymbol) {
    const entry = this.books.get(futuresSymbol);
    if (!entry) return { ready: false, spotReady: false, ts: Date.now(), symbol: futuresSymbol, futures: null, spot: null };
    const now = Date.now();
    return buildSnapshot({
      symbol: futuresSymbol,
      ts: now,
      now,
      futBook: entry.fut.snapshotBook(),
      futTrades: entry.trades,
      spotBook: entry.spot ? entry.spot.snapshotBook() : null,
      opts: this.opts,
    });
  }

  stop() {
    this.stopped = true;
    for (const entry of this.books.values()) for (const c of entry.clients) c.close();
    if (this.recorder) this.recorder.close();
  }
}
