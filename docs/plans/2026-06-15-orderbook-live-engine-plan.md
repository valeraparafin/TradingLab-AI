# Live OB Engine (Layer 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A persistent, fast-ticking order-book engine that evaluates the breakout gate live, logs every signal with its forward outcome, and records thinned order-book snapshots to disk — the foundation that accumulates the validation dataset while the PC is on.

**Architecture:** A `LiveObEngine` wraps an injected feed (live `OrderBookFeed` in production, a stub in tests) and a candles provider. Per symbol it keeps a rolling higher-TF level, tracks `prevMid`, and on a fast tick runs the existing pure `breakoutSignal` + `withOrderBookGate`. PERMITs are logged to `data/orderbook/signals/<day>.jsonl`, scheduled for a forward-outcome write at `horizonMs`, and buffered in memory for Layer 2's drain. A separate slower record tick persists thinned near-mid snapshots + new trades. No live wiring to `/ai` yet (that is Layer 2).

**Tech Stack:** Node ESM, `node:assert` tests (no framework), existing `src/marketdata/orderbook/*` pure units, `toolRegistry.get_candles` for candles.

**Scope note:** This is Layer 1 of the spec `docs/specs/2026-06-15-orderbook-live-agent-design.md`. Layer 2 (orchestrator drain, RiskPolicy mapping, cockpit lens, agent config) is a separate plan written after the Layer-1 checkpoint.

---

### Task 1: Higher-timeframe ladder

**Files:**
- Create: `src/marketdata/orderbook/htfLadder.js`
- Test: `tests/test_htf_ladder.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/test_htf_ladder.mjs
import assert from 'node:assert';
import { higherTf } from '../src/marketdata/orderbook/htfLadder.js';

let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

assert.equal(higherTf('5m', 1), '15m'); ok('5m +1 -> 15m');
assert.equal(higherTf('15m', 1), '30m'); ok('15m +1 -> 30m');
assert.equal(higherTf('15m', 2), '1h'); ok('15m +2 -> 1h');
assert.equal(higherTf('1m', 1), '5m'); ok('1m +1 -> 5m');
assert.equal(higherTf('1d', 1), '1d'); ok('top rung clamps to 1d');
assert.equal(higherTf('5m', 0), '5m'); ok('step 0 -> same tf');
assert.equal(higherTf('7m', 1), '15m'); ok('unknown tf snaps up to next known rung');

console.log(`\n${p} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_htf_ladder.mjs`
Expected: FAIL — `Cannot find module '.../htfLadder.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/marketdata/orderbook/htfLadder.js
// Fixed timeframe ladder. The base TF is what the agent trades on; the level TF is `step`
// rungs higher (significant structure). `higherTf` clamps at the top rung.
const LADDER = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];

/**
 * @param {string} baseTf one of the ladder rungs (unknown values snap up to the next known rung)
 * @param {number} step rungs to climb (default 1; 0 returns the base unchanged)
 * @returns {string}
 */
export function higherTf(baseTf, step = 1) {
  let i = LADDER.indexOf(baseTf);
  if (i === -1) {
    // Unknown TF: find the first rung strictly above it by minute-size, fall back to base.
    const mins = (tf) => ({ '1m': 1, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '4h': 240, '1d': 1440 }[tf]);
    const b = mins(baseTf);
    if (b == null) return baseTf;
    i = LADDER.findIndex((tf) => mins(tf) > b);
    if (i === -1) return '1d';
    return LADDER[Math.min(i + Math.max(0, step - 1), LADDER.length - 1)];
  }
  return LADDER[Math.min(i + Math.max(0, step), LADDER.length - 1)];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_htf_ladder.mjs`
Expected: PASS — `7 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/marketdata/orderbook/htfLadder.js tests/test_htf_ladder.mjs
git commit -m "feat(ob-engine): higher-timeframe ladder helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Expose near-mid raw books from the feed

**Files:**
- Modify: `src/marketdata/orderbook/OrderBookFeed.js` (add `getRawBooks` method after `getFeatures`, ~line 113)
- Test: `tests/test_feed_raw_books.mjs`

The thinned recorder needs the near-mid book levels + recent trades, which `getFeatures` (computed
features only) does not expose. `LocalOrderBook.snapshotBook()` already returns the depth-limited
(top-20) book — near-mid by construction.

- [ ] **Step 1: Write the failing test**

```js
// tests/test_feed_raw_books.mjs
import assert from 'node:assert';
import { OrderBookFeed } from '../src/marketdata/orderbook/OrderBookFeed.js';
import { LocalOrderBook, VENUE } from '../src/marketdata/orderbook/LocalOrderBook.js';

let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

const feed = new OrderBookFeed({ symbols: [{ futures: 'TESTUSDT', spot: 'TESTUSDT' }], record: false });

// Unknown symbol -> null (no crash).
assert.equal(feed.getRawBooks('NOPEUSDT'), null); ok('unknown symbol -> null');

// Seed a synced book directly (bypass network) and read it back.
const fut = new LocalOrderBook({ venue: VENUE.FUT, depthLimit: 20 });
fut.applySnapshot({ lastUpdateId: 1, bids: [['100', '5']], asks: [['101', '4']] });
feed.books.set('TESTUSDT', { fut, spot: null, trades: [{ t: 10, p: 100.5, q: 1, m: false }], clients: [], buffers: { fut: [], spot: [] }, synced: { fut: true, spot: false } });

const raw = feed.getRawBooks('TESTUSDT');
assert.ok(raw.fut && Array.isArray(raw.fut.bids), 'fut book present'); ok('fut book shape');
assert.equal(raw.spot, null); ok('spot null when absent');
assert.equal(raw.trades.length, 1); ok('trades passed through');

console.log(`\n${p} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_feed_raw_books.mjs`
Expected: FAIL — `feed.getRawBooks is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add this method to `OrderBookFeed` immediately after `getFeatures` (before `stop()`):

```js
  /** Near-mid raw books + recent tape for one symbol (for the thinned recorder). null if unknown. */
  getRawBooks(futuresSymbol) {
    const entry = this.books.get(futuresSymbol);
    if (!entry) return null;
    return {
      fut: entry.fut ? entry.fut.snapshotBook() : null,
      spot: entry.spot ? entry.spot.snapshotBook() : null,
      trades: entry.trades,
    };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_feed_raw_books.mjs`
Expected: PASS — `4 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/marketdata/orderbook/OrderBookFeed.js tests/test_feed_raw_books.mjs
git commit -m "feat(ob-engine): expose near-mid raw books from the feed

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Signal/outcome log formatters

**Files:**
- Create: `src/marketdata/orderbook/obSignalLog.js`
- Test: `tests/test_ob_signal_log.mjs`

Pure formatters for the JSONL log lines + the realized-bps helper (the forward-outcome math,
mirroring `replayScore.scoreSignals`'s per-signal calc, kept pure for direct testing).

- [ ] **Step 1: Write the failing test**

```js
// tests/test_ob_signal_log.mjs
import assert from 'node:assert';
import { signalRecord, outcomeRecord, outcomeBps } from '../src/marketdata/orderbook/obSignalLog.js';

let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

// outcomeBps: BUY winner net of cost.
const buy = outcomeBps({ entryMid: 100, exitMid: 100.5, side: 'BUY', costBps: 5 });
assert.ok(Math.abs(buy.grossBps - 50) < 1e-9, 'gross 50'); ok('BUY gross bps');
assert.ok(Math.abs(buy.netBps - 45) < 1e-9, 'net 45'); ok('BUY net bps (cost subtracted)');
assert.equal(buy.win, true); ok('BUY win flag');

// SELL: price down is a win.
const sell = outcomeBps({ entryMid: 100, exitMid: 99.5, side: 'SELL', costBps: 5 });
assert.ok(Math.abs(sell.grossBps - 50) < 1e-9, 'sell gross 50'); ok('SELL gross bps mirrored');
assert.equal(sell.win, true); ok('SELL win flag');

// signalRecord shape.
const sig = { side: 'BUY', setup: 'breakout', conviction: 0.6, rationale: 'x', invalidation: { backInsideRange: 99 } };
const sr = signalRecord({ t: 1000, sym: 'SUIUSDT', sig, entryMid: 100, level: { resistance: 99.8, support: 98 } });
assert.equal(sr.type, 'signal'); assert.equal(sr.sym, 'SUIUSDT'); assert.equal(sr.entryMid, 100);
assert.equal(sr.invalidation, 99); ok('signalRecord extracts numeric invalidation');

// outcomeRecord shape.
const or = outcomeRecord({ t: 2000, sym: 'SUIUSDT', side: 'BUY', entryMid: 100, exitMid: 100.5, horizonMs: 60000, costBps: 5 });
assert.equal(or.type, 'outcome'); assert.ok(Math.abs(or.netBps - 45) < 1e-9); assert.equal(or.win, true);
ok('outcomeRecord computes net bps');

console.log(`\n${p} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_ob_signal_log.mjs`
Expected: FAIL — `Cannot find module '.../obSignalLog.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/marketdata/orderbook/obSignalLog.js
// Pure formatters for the live signal/outcome JSONL log + the forward-outcome math.
// Mirrors the per-signal calc in replayScore.scoreSignals, kept pure for the live engine.

/** Realized move of a signal over a horizon, net of round-trip cost. */
export function outcomeBps({ entryMid, exitMid, side, costBps = 5 }) {
  const dir = side === 'SELL' ? -1 : 1;
  const grossBps = (dir * (exitMid - entryMid) / entryMid) * 1e4;
  const netBps = grossBps - costBps;
  return { grossBps, netBps, win: netBps > 0 };
}

/** One 'signal' log line. `sig` is a breakoutSignal result; invalidation flattened to its number. */
export function signalRecord({ t, sym, sig, entryMid, level }) {
  return {
    t, type: 'signal', sym,
    side: sig.side, setup: sig.setup, conviction: sig.conviction,
    entryMid,
    invalidation: sig.invalidation ? sig.invalidation.backInsideRange : null,
    level: level ? { resistance: level.resistance, support: level.support } : null,
    rationale: sig.rationale,
  };
}

/** One 'outcome' log line, computed from entry/exit mids. */
export function outcomeRecord({ t, sym, side, entryMid, exitMid, horizonMs, costBps = 5 }) {
  const { grossBps, netBps, win } = outcomeBps({ entryMid, exitMid, side, costBps });
  return { t, type: 'outcome', sym, side, entryMid, exitMid, horizonMs, grossBps, netBps, win };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_ob_signal_log.mjs`
Expected: PASS — `8 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/marketdata/orderbook/obSignalLog.js tests/test_ob_signal_log.mjs
git commit -m "feat(ob-engine): signal/outcome log formatters + realized-bps helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Engine core — tick, signal emission, buffer/drain

**Files:**
- Create: `src/marketdata/orderbook/liveObEngine.js`
- Test: `tests/test_live_ob_engine_tick.mjs`

The engine takes an **injected** feed (`getFeatures`, `getRawBooks`, `start`, `stop`) and a
`candlesProvider(sym, tf)` so it is unit-testable without network. This task implements: per-symbol
state, `setLevel`, `_evaluate` (one tick), buffer + `drainSignals`, `getStats`, `getLatestFeatures`.
Recording (Task 5) and outcome scheduling (Task 6) build on this. No timers yet — `_evaluate` is
called directly by the test.

- [ ] **Step 1: Write the failing test**

```js
// tests/test_live_ob_engine_tick.mjs
import assert from 'node:assert';
import { LiveObEngine } from '../src/marketdata/orderbook/liveObEngine.js';

let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

// A feature snapshot helper: bid-heavy book + buy-aggressed tape (confirms a BUY breakout).
const feat = (mid, ready = true) => ({
  ready, spotReady: false, ts: 1000, symbol: 'SUIUSDT',
  futures: { mid, spread: mid * 0.0001, imbalance: 0.5, microprice: mid, aggressorImbalance: 0.5, printVelocity: 3, nearWallBid: null, nearWallAsk: null },
  spot: null,
});

// Fake feed driven by a queue of feature snapshots.
function fakeFeed(seq) {
  let i = 0;
  return {
    started: false, stopped: false,
    start() { this.started = true; },
    stop() { this.stopped = true; },
    getFeatures() { return seq[Math.min(i, seq.length - 1)]; },
    getRawBooks() { return { fut: { bids: [], asks: [] }, spot: null, trades: [] }; },
    advance() { i++; },
  };
}

const feed = fakeFeed([feat(99.5), feat(100.5)]); // below level, then crosses above
const engine = new LiveObEngine({
  feed,
  candlesProvider: async () => [],
  symbols: ['SUIUSDT'],
  opts: { baseTf: '5m', htfStep: 1, imbThresh: 0.10, record: false },
});

// Level set directly (candle refresh is Task 7 wiring).
engine.setLevel('SUIUSDT', { resistance: 100, support: 98, coiled: false });

// Tick 1: prevMid null -> no signal, prevMid seeded.
engine._evaluate('SUIUSDT');
assert.equal(engine.drainSignals('SUIUSDT').length, 0); ok('first tick seeds prevMid, no signal');

// Tick 2: mid crosses 100 with book+tape confirm -> one PERMITted signal.
feed.advance();
engine._evaluate('SUIUSDT');
const drained = engine.drainSignals('SUIUSDT');
assert.equal(drained.length, 1, 'one signal'); ok('cross emits a signal');
assert.equal(drained[0].side, 'BUY'); ok('signal side BUY');

// Drain clears the buffer.
assert.equal(engine.drainSignals('SUIUSDT').length, 0); ok('drain clears buffer');

// Stats reflect the emission.
assert.equal(engine.getStats().SUIUSDT.signals, 1); ok('stats count signals');

// Not-ready tick is skipped (no crash, no signal).
const feed2 = fakeFeed([feat(99.5, false)]);
const e2 = new LiveObEngine({ feed: feed2, candlesProvider: async () => [], symbols: ['SUIUSDT'], opts: { record: false } });
e2.setLevel('SUIUSDT', { resistance: 100, support: 98, coiled: false });
e2._evaluate('SUIUSDT');
assert.equal(e2.drainSignals('SUIUSDT').length, 0); ok('not-ready tick skipped');

console.log(`\n${p} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_live_ob_engine_tick.mjs`
Expected: FAIL — `Cannot find module '.../liveObEngine.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/marketdata/orderbook/liveObEngine.js
import { breakoutSignal } from './breakoutSignal.js';
import { withOrderBookGate } from './obGate.js';
import { signalRecord } from './obSignalLog.js';

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
      this._onSignal?.(sym, rec); // hook for logging + outcome scheduling (Task 6)
    }
    st.prevMid = feat.futures.mid;
    return rec;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_live_ob_engine_tick.mjs`
Expected: PASS — `8 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/marketdata/orderbook/liveObEngine.js tests/test_live_ob_engine_tick.mjs
git commit -m "feat(ob-engine): live engine core — tick, signal emission, buffer/drain

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Thinned recording — obsnap + new trades

**Files:**
- Modify: `src/marketdata/orderbook/liveObEngine.js` (add recorder + `_recordTick`)
- Test: `tests/test_live_ob_engine_record.mjs`

Each record tick writes one compact `obsnap` frame per symbol (near-mid books + computed features)
plus any **new** trades since the last record tick (dedup by trade timestamp). Reuses the existing
`Recorder` (one fd per symbol/venue/day). Deep-book noise is never persisted.

- [ ] **Step 1: Write the failing test**

```js
// tests/test_live_ob_engine_record.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LiveObEngine } from '../src/marketdata/orderbook/liveObEngine.js';

let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'obrec-'));

let trades = [{ t: 100, p: 1.5, q: 10, m: false }];
const feed = {
  start() {}, stop() {},
  getFeatures: () => ({ ready: true, ts: 1000, symbol: 'SUIUSDT', futures: { mid: 1.5, imbalance: 0.2, spread: 0.0001, microprice: 1.5, aggressorImbalance: 0.2, printVelocity: 2 }, spot: null }),
  getRawBooks: () => ({ fut: { bids: [['1.49', '10']], asks: [['1.51', '8']] }, spot: null, trades }),
};
const engine = new LiveObEngine({
  feed, candlesProvider: async () => [], symbols: ['SUIUSDT'],
  opts: { record: true, recorderRoot: root },
});

engine._recordTick('SUIUSDT');
const day = new Date(1000).toISOString().slice(0, 10);
const file = path.join(root, 'SUIUSDT', 'fut', `${day}.jsonl`);
let lines = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
assert.ok(lines.some((l) => l.k === 'obsnap'), 'obsnap written'); ok('obsnap frame written');
assert.ok(lines.some((l) => l.k === 'trade' && l.p === 1.5), 'trade written'); ok('new trade written');

// Second tick with no new trades -> obsnap added, trade NOT duplicated.
engine._recordTick('SUIUSDT');
lines = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
assert.equal(lines.filter((l) => l.k === 'trade').length, 1); ok('trade not duplicated');
assert.equal(lines.filter((l) => l.k === 'obsnap').length, 2); ok('second obsnap added');

// A newer trade is picked up on the next tick.
trades = trades.concat([{ t: 200, p: 1.52, q: 5, m: true }]);
engine._recordTick('SUIUSDT');
lines = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
assert.equal(lines.filter((l) => l.k === 'trade').length, 2); ok('new trade picked up');

engine.stop();
console.log(`\n${p} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_live_ob_engine_record.mjs`
Expected: FAIL — `engine._recordTick is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add the import at the top of `liveObEngine.js`:

```js
import { Recorder } from './Recorder.js';
```

In the constructor, after the `_gated` assignment, add:

```js
    this.recorder = this.o.record ? new Recorder({ root: this.o.recorderRoot }) : null;
```

Add these methods to the class:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_live_ob_engine_record.mjs`
Expected: PASS — `5 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/marketdata/orderbook/liveObEngine.js tests/test_live_ob_engine_record.mjs
git commit -m "feat(ob-engine): thinned recording — obsnap + dedup new trades

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Signal logging + forward-outcome scheduling

**Files:**
- Modify: `src/marketdata/orderbook/liveObEngine.js` (add signal log + outcome scheduling)
- Test: `tests/test_live_ob_engine_outcome.mjs`

On each PERMIT: append a `signal` line to `data/orderbook/signals/<day>.jsonl`, and after `horizonMs`
append an `outcome` line (entry vs live exit mid, net of cost) and fold it into stats. To stay
testable without real time, the horizon timer is created through an injectable `schedule` fn
(default `setTimeout`); the test passes a synchronous stub.

- [ ] **Step 1: Write the failing test**

```js
// tests/test_live_ob_engine_outcome.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LiveObEngine } from '../src/marketdata/orderbook/liveObEngine.js';

let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'obout-'));
let mid = 100;
const feed = {
  start() {}, stop() {},
  getFeatures: () => ({ ready: true, ts: 1000, symbol: 'SUIUSDT', futures: { mid, spread: 0.01, imbalance: 0.5, microprice: mid, aggressorImbalance: 0.5, printVelocity: 3 }, spot: null }),
  getRawBooks: () => ({ fut: { bids: [], asks: [] }, spot: null, trades: [] }),
};

// Synchronous schedule stub: capture the callback so the test fires it after moving the price.
let fire = null;
const schedule = (cb) => { fire = cb; return 0; };

const engine = new LiveObEngine({
  feed, candlesProvider: async () => [], symbols: ['SUIUSDT'],
  opts: { record: true, recorderRoot: root, signalsRoot: path.join(root, 'signals'), horizonMs: 60000, costBps: 5 },
  schedule,
});
engine.setLevel('SUIUSDT', { resistance: 100, support: 98, coiled: false });

engine._evaluate('SUIUSDT');          // seed prevMid (99? no — mid=100, prevMid=100)
mid = 100.5;                          // cross above 100
engine._evaluate('SUIUSDT');          // PERMIT -> signal logged + outcome scheduled

const day = new Date(1000).toISOString().slice(0, 10);
const sigFile = path.join(root, 'signals', `${day}.jsonl`);
let lines = fs.readFileSync(sigFile, 'utf8').trim().split('\n').map(JSON.parse);
assert.ok(lines.some((l) => l.type === 'signal' && l.side === 'BUY'), 'signal logged'); ok('signal line written');

// Move price up, fire the horizon callback -> outcome line + stats update.
mid = 101;
assert.ok(typeof fire === 'function', 'outcome scheduled'); ok('outcome scheduled');
fire();
lines = fs.readFileSync(sigFile, 'utf8').trim().split('\n').map(JSON.parse);
const outcome = lines.find((l) => l.type === 'outcome');
assert.ok(outcome && outcome.netBps > 0, 'positive net bps outcome'); ok('outcome line written, net bps > 0');
assert.equal(engine.getStats().SUIUSDT.resolved, 1); ok('stats resolved incremented');
assert.equal(engine.getStats().SUIUSDT.wins, 1); ok('stats wins incremented');

engine.stop();
console.log(`\n${p} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_live_ob_engine_outcome.mjs`
Expected: FAIL — outcome not scheduled / `signals` file missing.

- [ ] **Step 3: Write minimal implementation**

Add imports to `liveObEngine.js`:

```js
import fs from 'node:fs';
import path from 'node:path';
import { outcomeRecord } from './obSignalLog.js';
```

Extend `DEF` with `signalsRoot: 'data/orderbook/signals'`.

In the constructor signature accept `schedule`: `constructor({ feed, candlesProvider, symbols, opts = {}, schedule } = {})` and store `this.schedule = schedule || ((cb, ms) => setTimeout(cb, ms));`. Also init per-symbol `_outcomeTimers`: in the state loop add `_outcomeTimers: []` to each entry.

Add a private append helper and wire the `_onSignal` hook (referenced in Task 4's `_evaluate`):

```js
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
      if (exitMid == null) return; // unresolved — leave it out
      const out = outcomeRecord({ t: Date.now(), sym, side: rec.side, entryMid, exitMid, horizonMs: this.o.horizonMs, costBps: this.o.costBps });
      this._appendSignals(out);
      st.stats.resolved++;
      if (out.win) st.stats.wins++;
      st.stats.netBpsSum += out.netBps;
    }, this.o.horizonMs);
    st._outcomeTimers.push(id);
  }
```

Note: `_onSignal` is defined as a real method now (Task 4 called `this._onSignal?.(...)`, which resolves to this method).

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_live_ob_engine_outcome.mjs`
Expected: PASS — `6 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/marketdata/orderbook/liveObEngine.js tests/test_live_ob_engine_outcome.mjs
git commit -m "feat(ob-engine): signal logging + forward-outcome scheduling

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Timers + candle refresh + standalone runner

**Files:**
- Modify: `src/marketdata/orderbook/liveObEngine.js` (add `start()` with timers + `_refreshCandles`)
- Create: `scripts/run-ob-engine.mjs`
- Test: `tests/test_live_ob_engine_start.mjs`

`start()` wires the three intervals (eval tick, record tick, candle refresh), kicks an immediate
candle refresh + feed start. `_refreshCandles` pulls higher-TF candles via the injected provider and
recomputes the level with `levelFromCandles`. The runner wires the real `OrderBookFeed` +
`toolRegistry.get_candles` and prints stats periodically.

- [ ] **Step 1: Write the failing test**

```js
// tests/test_live_ob_engine_start.mjs
import assert from 'node:assert';
import { LiveObEngine } from '../src/marketdata/orderbook/liveObEngine.js';

let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

// Candle provider returns a structure that yields a level via levelFromCandles (>= lookback+1 bars).
const bars = Array.from({ length: 25 }, (_, i) => ({ time: i, high: 100 + i * 0.01, low: 98, open: 99, close: 99, volume: 1 }));
let providerCalls = 0;
const feed = { started: false, start() { this.started = true; }, stop() {}, getFeatures: () => ({ ready: false }), getRawBooks: () => null };

const engine = new LiveObEngine({
  feed,
  candlesProvider: async (sym, tf) => { providerCalls++; assert.equal(tf, '15m'); return bars; },
  symbols: ['SUIUSDT'],
  opts: { baseTf: '5m', htfStep: 1, lookback: 20, record: false, tickMs: 999999, recordIntervalMs: 999999, candleRefreshMs: 999999 },
});

await engine._refreshCandles('SUIUSDT');
assert.equal(providerCalls, 1); ok('candle provider called with higher TF (15m)');
const level = engine.state.get('SUIUSDT').level;
assert.ok(level && level.resistance != null, 'level computed'); ok('level recomputed from higher-TF candles');

engine.start();
assert.equal(feed.started, true); ok('start() starts the feed');
engine.stop();
ok('stop() runs clean');

console.log(`\n${p} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_live_ob_engine_start.mjs`
Expected: FAIL — `engine._refreshCandles is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add imports to `liveObEngine.js`:

```js
import { levelFromCandles } from './levels.js';
import { higherTf } from './htfLadder.js';
```

Add methods:

```js
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
    this.feed.start?.();
    for (const s of this.symbols) this._refreshCandles(s);
    this._tickTimer = setInterval(() => { for (const s of this.symbols) this._evaluate(s); }, this.o.tickMs);
    this._recordTimer = setInterval(() => { for (const s of this.symbols) this._recordTick(s); }, this.o.recordIntervalMs);
    this._candleTimer = setInterval(() => { for (const s of this.symbols) this._refreshCandles(s); }, this.o.candleRefreshMs);
  }
```

Create the runner:

```js
// scripts/run-ob-engine.mjs
// Standalone Layer-1 runner: live OB engine over a symbol set, thinned recording + signal/outcome
// log under data/orderbook/. Watch data/orderbook/signals/<day>.jsonl grow. Layer 2 wires this into
// /ai; this script just accumulates the validation dataset while it runs.
// Usage: node scripts/run-ob-engine.mjs --symbols SUIUSDT,GPSUSDT --base 5m --htfStep 1 --imb 0.10
import { OrderBookFeed } from '../src/marketdata/orderbook/OrderBookFeed.js';
import { LiveObEngine } from '../src/marketdata/orderbook/liveObEngine.js';
import { toolRegistry } from '../src/registry/ToolRegistry.js';

function arg(name, def) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; }

const symbols = arg('symbols', 'SUIUSDT,GPSUSDT,TONUSDT,WIFUSDT,WLDUSDT').split(',').map((s) => s.trim()).filter(Boolean);
const baseTf = arg('base', '5m');
const htfStep = Number(arg('htfStep', '1'));
const imbThresh = Number(arg('imb', '0.10'));

const feed = new OrderBookFeed({ symbols: symbols.map((s) => ({ futures: s, spot: s })), record: false });
const candlesProvider = async (sym, tf) => {
  const res = await toolRegistry.executeTool('get_candles', { symbol: sym, timeframe: tf, limit: 50 });
  return res.success ? res.data : [];
};

const engine = new LiveObEngine({ feed, candlesProvider, symbols, opts: { baseTf, htfStep, imbThresh, record: true } });
engine.start();
console.log(`[ob-engine] live on ${symbols.join(', ')} | base=${baseTf} htfStep=${htfStep} imb=${imbThresh}`);

setInterval(() => {
  const stats = engine.getStats();
  for (const s of symbols) {
    const st = stats[s];
    console.log(`  ${s} ticks=${st.ticks} signals=${st.signals} resolved=${st.resolved} wins=${st.wins} netBpsSum=${st.netBpsSum.toFixed(1)}`);
  }
}, 30_000);

process.on('SIGINT', () => { engine.stop(); console.log('\n[ob-engine] stopped.'); process.exit(0); });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_live_ob_engine_start.mjs`
Expected: PASS — `5 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/marketdata/orderbook/liveObEngine.js scripts/run-ob-engine.mjs tests/test_live_ob_engine_start.mjs
git commit -m "feat(ob-engine): timers + candle refresh + standalone runner

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Live smoke run + regression + memory/graph

**Files:**
- No code changes (verification + docs only)

- [ ] **Step 1: Run the full orderbook test suite**

Run: `node tests/test_htf_ladder.mjs && node tests/test_feed_raw_books.mjs && node tests/test_ob_signal_log.mjs && node tests/test_live_ob_engine_tick.mjs && node tests/test_live_ob_engine_record.mjs && node tests/test_live_ob_engine_outcome.mjs && node tests/test_live_ob_engine_start.mjs`
Expected: every file prints `N checks passed`, no assertion errors.

- [ ] **Step 2: Live smoke run (~10 min)**

Run: `node scripts/run-ob-engine.mjs --symbols SUIUSDT,TONUSDT,WLDUSDT --base 5m --imb 0.10`
Expected: stats lines every 30s with `ticks` climbing; within minutes `data/orderbook/signals/<day>.jsonl`
exists and `data/orderbook/<sym>/fut/<day>.jsonl` carries `obsnap` + `trade` frames. Stop with Ctrl-C.
Confirm volume is thinned (obsnap roughly once/sec/symbol, not the @100ms firehose).

- [ ] **Step 3: Sanity-check the recorded format is replayable**

Verify a recorded `obsnap` line has `features.mid`, `features.imbalance`, `features.aggressorImbalance`,
`features.printVelocity` populated (these are what a future re-sweep reads). If tape features are 0,
the spot tape is not flowing — check spot ticker matches (see [project-orderbook-feed]).

- [ ] **Step 4: Update memory + graph**

Append to `project_orderbook_feed.md`: Layer 1 (live engine) built — `liveObEngine.js` (fast eval tick +
thinned obsnap recording + signal/outcome log under `data/orderbook/signals/`), relative HTF ladder
(`htfLadder.js`), `OrderBookFeed.getRawBooks`. Note Layer 2 (cockpit wiring) is the next plan, gated on
this accumulating data. Then run `graphify update .`.

- [ ] **Step 5: Commit**

```bash
git add docs/
git commit -m "docs(ob-engine): Layer 1 verification notes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Layer-1 Checkpoint

After Task 8, **pause**. The engine should be accumulating signals + outcomes + thinned snapshots
live. Confirm the signal log grows over a few hours before starting the Layer 2 plan (orchestrator
drain → RiskPolicy mapping → real Order-Flow cockpit lens → agent config surface). Writing Layer 2's
detailed task code now would be speculative against an engine API that this plan is still settling.
