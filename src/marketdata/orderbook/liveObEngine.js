// src/marketdata/orderbook/liveObEngine.js
import { breakoutSignal } from './breakoutSignal.js';
import { withOrderBookGate } from './obGate.js';
import { signalRecord } from './obSignalLog.js';
import { Recorder } from './Recorder.js';

const DEF = {
  baseTf: '5m', htfStep: 1,
  imbThresh: 0.10, aggThresh: 0.15, minVelocity: 0.5,
  maxSpreadBps: 8, horizonMs: 60_000, costBps: 5,
  tickMs: 1000, recordIntervalMs: 1000, candleRefreshMs: 30_000,
  lookback: 20, bufferMax: 50, record: true, recorderRoot: 'data/orderbook',
};

/**
 * Persistent live order-book engine. Injected `feed` (getFeatures/getRawBooks/start/stop) and
 * `candlesProvider(sym, tf)` keep it unit-testable without network. Per symbol: rolling level,
 * prevMid, a ring buffer of recent PERMITted signals (for Layer 2's drain), and stats.
 */
export class LiveObEngine {
  constructor({ feed, candlesProvider, symbols, opts = {} }) {
    this.feed = feed;
    this.candlesProvider = candlesProvider;
    this.symbols = symbols;
    this.o = { ...DEF, ...opts };
    this.state = new Map(); // sym -> { level, prevMid, candles, buffer, lastTradeT, stats }
    for (const s of symbols) {
      this.state.set(s, {
        level: null, prevMid: null, candles: [], buffer: [], lastTradeT: 0,
        stats: { ticks: 0, signals: 0, resolved: 0, wins: 0, netBpsSum: 0 },
      });
    }
    // decide+gate pair mirrors replaySignals: candles define the level, the book confirms.
    this._gated = withOrderBookGate((ctx) => {
      const sig = breakoutSignal({
        level: ctx.level, feat: ctx.feat, prevMid: ctx.prevMid,
        opts: { imbThresh: this.o.imbThresh, aggThresh: this.o.aggThresh, minVelocity: this.o.minVelocity },
      });
      if (!sig) return { signal: null, decision: { decision: 'HOLD' } };
      return { signal: sig, decision: { decision: 'PERMIT', order: { side: sig.side } } };
    }, { maxSpreadBps: this.o.maxSpreadBps });
    this.recorder = this.o.record ? new Recorder({ root: this.o.recorderRoot }) : null;
  }

  setLevel(sym, level) { const st = this.state.get(sym); if (st) st.level = level; }
  getLatestFeatures(sym) { return this.feed.getFeatures(sym); }
  getStats() { const out = {}; for (const [s, st] of this.state) out[s] = { ...st.stats }; return out; }

  drainSignals(sym) {
    const st = this.state.get(sym);
    if (!st) return [];
    const out = st.buffer;
    st.buffer = [];
    return out;
  }

  /** One evaluation tick for a symbol. Returns the emitted signal record or null. */
  _evaluate(sym) {
    const st = this.state.get(sym);
    if (!st) return null;
    const feat = this.feed.getFeatures(sym);
    if (!feat || !feat.ready || !feat.futures) return null;
    st.stats.ticks++;
    if (!st.level) { st.prevMid = feat.futures.mid; return null; }

    const r = this._gated({ feat, prevMid: st.prevMid, level: st.level }, {});
    let rec = null;
    if (r.signal && r.decision.decision === 'PERMIT') {
      rec = signalRecord({ t: feat.ts, sym, sig: r.signal, entryMid: feat.futures.mid, level: st.level });
      st.buffer.push(rec);
      if (st.buffer.length > this.o.bufferMax) st.buffer.shift();
      st.stats.signals++;
      this._onSignal?.(sym, rec); // hook for logging + outcome scheduling (a later task)
    }
    st.prevMid = feat.futures.mid;
    return rec;
  }

  /** Thinned persistence: one near-mid obsnap + any new trades since the last record tick. */
  _recordTick(sym) {
    if (!this.recorder) return;
    const st = this.state.get(sym);
    const feat = this.feed.getFeatures(sym);
    const raw = this.feed.getRawBooks(sym);
    if (!feat || !feat.ready || !raw) return;
    const t = feat.ts;
    this.recorder.write(sym, 'fut', t, {
      k: 'obsnap',
      fut: raw.fut, spot: raw.spot,
      features: feat.futures, spotFeatures: feat.spot || null,
    });
    for (const tr of raw.trades || []) {
      if (tr.t > st.lastTradeT) {
        this.recorder.write(sym, 'fut', tr.t, { k: 'trade', p: tr.p, q: tr.q, m: tr.m });
        st.lastTradeT = tr.t;
      }
    }
  }

  stop() {
    if (this._tickTimer) clearInterval(this._tickTimer);
    if (this._recordTimer) clearInterval(this._recordTimer);
    if (this._candleTimer) clearInterval(this._candleTimer);
    for (const st of this.state.values()) for (const id of st._outcomeTimers || []) clearTimeout(id);
    this.feed.stop?.();
    if (this.recorder) this.recorder.close();
  }
}
