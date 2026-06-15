// src/marketdata/orderbook/liveObEngine.js
import fs from 'node:fs';
import path from 'node:path';
import { breakoutSignal } from './breakoutSignal.js';
import { withOrderBookGate } from './obGate.js';
import { signalRecord, outcomeRecord } from './obSignalLog.js';
import { Recorder } from './Recorder.js';
import { levelFromCandles } from './levels.js';
import { higherTf } from './htfLadder.js';

const DEF = {
  baseTf: '5m', htfStep: 1,
  imbThresh: 0.10, aggThresh: 0.15, minVelocity: 0.5,
  maxSpreadBps: 8, horizonMs: 60_000, costBps: 5,
  tickMs: 1000, recordIntervalMs: 1000, candleRefreshMs: 30_000,
  lookback: 20, bufferMax: 50, record: true, recorderRoot: 'data/orderbook',
  signalsRoot: 'data/orderbook/signals',
};

/**
 * Persistent live order-book engine. Injected `feed` (getFeatures/getRawBooks/start/stop) and
 * `candlesProvider(sym, tf)` keep it unit-testable without network. Per symbol: rolling level,
 * prevMid, a ring buffer of recent PERMITted signals (for Layer 2's drain), and stats.
 */
export class LiveObEngine {
  constructor({ feed, candlesProvider, symbols, opts = {}, schedule } = {}) {
    this.feed = feed;
    this.candlesProvider = candlesProvider;
    this.symbols = symbols;
    this.o = { ...DEF, ...opts };
    // Default schedule unrefs so a pending outcome timer never keeps the process alive on its own
    // (the feed sockets + interval timers own the lifecycle). Tests inject a synchronous stub.
    this.schedule = schedule || ((cb, ms) => { const id = setTimeout(cb, ms); id.unref?.(); return id; });
    this.state = new Map(); // sym -> { level, prevMid, candles, buffer, lastTradeT, stats }
    for (const s of symbols) {
      this.state.set(s, {
        level: null, prevMid: null, candles: [], buffer: [], lastTradeT: 0,
        stats: { ticks: 0, signals: 0, resolved: 0, wins: 0, netBpsSum: 0 },
        _outcomeTimers: [],
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
      this._onSignal(sym, rec); // logs the signal + schedules its forward-outcome write
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

  _appendSignals(line) {
    const day = new Date(line.t).toISOString().slice(0, 10);
    fs.mkdirSync(this.o.signalsRoot, { recursive: true });
    fs.appendFileSync(path.join(this.o.signalsRoot, `${day}.jsonl`), JSON.stringify(line) + '\n');
  }

  _onSignal(sym, rec) {
    this._appendSignals(rec);
    const st = this.state.get(sym);
    const entryMid = rec.entryMid;
    const id = this.schedule(() => {
      const feat = this.feed.getFeatures(sym);
      const exitMid = feat && feat.futures ? feat.futures.mid : null;
      const idx = st._outcomeTimers.indexOf(id);
      if (idx !== -1) st._outcomeTimers.splice(idx, 1); // prune fired timer — bounded array over long runs
      if (exitMid == null) return; // unresolved — leave it out
      // Stamp the outcome at horizon-close time (signal t + horizon): deterministic, keeps the
      // signal+outcome pair in the same daily file, resolution time recoverable.
      const out = outcomeRecord({ t: rec.t + this.o.horizonMs, sym, side: rec.side, entryMid, exitMid, horizonMs: this.o.horizonMs, costBps: this.o.costBps });
      this._appendSignals(out);
      st.stats.resolved++;
      if (out.win) st.stats.wins++;
      st.stats.netBpsSum += out.netBps;
    }, this.o.horizonMs);
    st._outcomeTimers.push(id);
  }

  async _refreshCandles(sym) {
    const tf = higherTf(this.o.baseTf, this.o.htfStep);
    try {
      const candles = await this.candlesProvider(sym, tf);
      if (Array.isArray(candles) && candles.length) {
        const st = this.state.get(sym);
        st.candles = candles;
        st.level = levelFromCandles(candles, { lookback: this.o.lookback });
      }
    } catch (e) {
      console.warn(`[ob-engine] candle refresh failed for ${sym}: ${e.message}`);
    }
  }

  start() {
    if (this._tickTimer) return; // already running — never double-wire timers
    this.feed.start?.();
    for (const s of this.symbols) this._refreshCandles(s);
    this._tickTimer = setInterval(() => { for (const s of this.symbols) this._evaluate(s); }, this.o.tickMs);
    this._recordTimer = setInterval(() => { for (const s of this.symbols) this._recordTick(s); }, this.o.recordIntervalMs);
    this._candleTimer = setInterval(() => { for (const s of this.symbols) this._refreshCandles(s); }, this.o.candleRefreshMs);
  }

  stop() {
    if (this._tickTimer) clearInterval(this._tickTimer);
    if (this._recordTimer) clearInterval(this._recordTimer);
    if (this._candleTimer) clearInterval(this._candleTimer);
    this._tickTimer = this._recordTimer = this._candleTimer = null; // allow a clean restart
    for (const st of this.state.values()) {
      for (const id of st._outcomeTimers) clearTimeout(id);
      st._outcomeTimers = [];
    }
    this.feed.stop?.();
    if (this.recorder) this.recorder.close();
  }
}
