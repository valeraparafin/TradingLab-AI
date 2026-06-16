# Order-Book Feed (SP1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a live Binance order-book feed that maintains, per symbol, a futures (primary) and spot (confirmation) order book, computes numeric features from each plus the futures tape, exposes a dual-book `getFeatures(symbol)` snapshot, and records every raw frame to disk for offline replay — no trading, gate, or LLM.

**Architecture:** Pure core + thin IO, mirroring `src/backtest/pumpDump.js`. `LocalOrderBook` (pure class) applies a REST snapshot + diff stream with venue-specific sequence rules and tracks READY/STALE. `obFeatures`/`tapeFeatures`/`buildSnapshot` are pure functions over book/tape state. `BinanceDepthClient` and `OrderBookFeed` are thin IO wrappers (websocket + REST, not unit-tested). `Recorder` appends JSONL; `replay` re-drives the pure core from recorded events for bit-for-bit reproducibility.

**Tech Stack:** Node 18+ ESM, `node:assert` test scripts (run with `node tests/<file>.mjs`), the `ws` package for the websocket client (added in Task 8), `node:fs` for recording.

**Spec:** `docs/specs/2026-06-14-orderbook-feed-design.md`

**Conventions:**
- Tests: `tests/test_<name>.mjs`, plain `node:assert`, a `let p=0; const ok=(n)=>{console.log(' ok - '+n); p++};` counter, final `console.log(\`\\n${p} checks passed\`)`. Run a single test with `node tests/test_<name>.mjs`.
- Prices are kept as **string keys** inside `LocalOrderBook` (canonical, exact deletion on size `0`); converted to numbers only for sorting and feature math.
- Every commit ends with the trailer line `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Recorded data under `data/orderbook/**` is **data, not code** — gitignored (Task 9), never committed.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/marketdata/orderbook/LocalOrderBook.js` | Pure class: apply snapshot + diffs (venue sequence rule), top-N book, READY/STALE state. |
| `src/marketdata/orderbook/obFeatures.js` | Pure `computeBookFeatures(book, opts)` → book numbers. |
| `src/marketdata/orderbook/tapeFeatures.js` | Pure `computeTapeFeatures(trades, now, opts)` → tape numbers. |
| `src/marketdata/orderbook/snapshot.js` | Pure `buildSnapshot(args)` → the dual-book `getFeatures` contract. |
| `src/marketdata/orderbook/Recorder.js` | IO: append raw frames as JSONL (`data/orderbook/<sym>/<venue>/<day>.jsonl`). |
| `src/marketdata/orderbook/replay.js` | Re-drive the pure core from recorded events (offline). |
| `src/marketdata/orderbook/BinanceDepthClient.js` | IO: one-venue ws (`@depth@100ms`, `@aggTrade`) + REST snapshot, reconnect/backoff. |
| `src/marketdata/orderbook/OrderBookFeed.js` | IO orchestrator: fut+spot books per symbol → `getFeatures` + event; drives Recorder. |
| `scripts/record-orderbook.mjs` | CLI: record-only mode. |
| `tests/test_local_orderbook.mjs`, `tests/test_ob_features.mjs`, `tests/test_tape_features.mjs`, `tests/test_ob_snapshot.mjs`, `tests/test_ob_recorder.mjs`, `tests/test_ob_replay.mjs` | Unit/integration tests. |

---

## Task 1: LocalOrderBook — snapshot + diff apply (spot rule)

**Files:**
- Create: `src/marketdata/orderbook/LocalOrderBook.js`
- Test: `tests/test_local_orderbook.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/test_local_orderbook.mjs
import assert from 'node:assert';
import { LocalOrderBook, VENUE } from '../src/marketdata/orderbook/LocalOrderBook.js';
let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

// --- spot: snapshot then in-order diffs ---
const spot = new LocalOrderBook({ venue: VENUE.SPOT, depthLimit: 5 });
spot.applySnapshot({ lastUpdateId: 100, bids: [['10.0', '2'], ['9.9', '3']], asks: [['10.1', '1'], ['10.2', '4']] });
assert.strictEqual(spot.state, 'READY', 'snapshot → READY'); ok('snapshot ready');

let b = spot.snapshotBook();
assert.deepStrictEqual(b.bids[0], [10.0, 2], 'best bid is highest price'); ok('best bid sorted');
assert.deepStrictEqual(b.asks[0], [10.1, 1], 'best ask is lowest price'); ok('best ask sorted');

// in-order diff (U <= lastUpdateId+1 <= u): update 10.0 size, add 9.8, remove 10.2
spot.applyDiff({ U: 101, u: 103, b: [['10.0', '5'], ['9.8', '7']], a: [['10.2', '0']] });
assert.strictEqual(spot.state, 'READY', 'in-order diff keeps READY'); ok('diff ready');
assert.strictEqual(spot.lastUpdateId, 103, 'lastUpdateId advances to u'); ok('seq advances');
b = spot.snapshotBook();
assert.deepStrictEqual(b.bids[0], [10.0, 5], 'bid size updated'); ok('bid updated');
assert.ok(!b.asks.some(([px]) => px === 10.2), 'level removed on size 0'); ok('level removed');

console.log(`\n${p} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_local_orderbook.mjs`
Expected: FAIL — `Cannot find module '.../LocalOrderBook.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/marketdata/orderbook/LocalOrderBook.js
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
  }

  applySnapshot({ lastUpdateId, bids, asks }) {
    this.bids = new Map();
    this.asks = new Map();
    for (const [px, q] of bids) this._set(this.bids, px, q);
    for (const [px, q] of asks) this._set(this.asks, px, q);
    this.lastUpdateId = lastUpdateId;
    this.staleReason = null;
    this.state = this._sane() ? 'READY' : 'STALE';
    if (this.state === 'STALE') this.staleReason = 'snapshot_insane';
    return this.state;
  }

  applyDiff(diff) {
    if (this.state !== 'READY') return this.state; // must resync via snapshot first
    const { U, u, b = [], a = [] } = diff;
    if (u <= this.lastUpdateId) return this.state;          // stale diff, ignore
    if (!(U <= this.lastUpdateId + 1)) return this._markStale('seq_gap');
    for (const [px, q] of b) this._set(this.bids, px, q);
    for (const [px, q] of a) this._set(this.asks, px, q);
    this.lastUpdateId = u;
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_local_orderbook.mjs`
Expected: PASS — `7 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/marketdata/orderbook/LocalOrderBook.js tests/test_local_orderbook.mjs
git commit -m "feat(orderbook): LocalOrderBook snapshot + spot diff apply" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: LocalOrderBook — staleness + futures sequence rule

**Files:**
- Modify: `src/marketdata/orderbook/LocalOrderBook.js`
- Test: `tests/test_local_orderbook.mjs` (append cases)

- [ ] **Step 1: Write the failing test (append before the final `console.log`)**

```js
// --- spot: sequence gap → STALE ---
const gap = new LocalOrderBook({ venue: VENUE.SPOT });
gap.applySnapshot({ lastUpdateId: 50, bids: [['1.0', '1']], asks: [['1.1', '1']] });
gap.applyDiff({ U: 60, u: 65, b: [['1.0', '2']], a: [] }); // U(60) > lastUpdateId+1(51)
assert.strictEqual(gap.state, 'STALE', 'seq gap → STALE'); ok('spot seq gap stale');
assert.strictEqual(gap.staleReason, 'seq_gap', 'reason recorded'); ok('stale reason');

// --- spot: stale diff (u <= lastUpdateId) ignored, stays READY ---
const old = new LocalOrderBook({ venue: VENUE.SPOT });
old.applySnapshot({ lastUpdateId: 50, bids: [['1.0', '1']], asks: [['1.1', '1']] });
old.applyDiff({ U: 40, u: 49, b: [['1.0', '9']], a: [] });
assert.strictEqual(old.state, 'READY', 'old diff ignored, stays READY'); ok('stale diff ignored');
assert.strictEqual(old.snapshotBook().bids[0][1], 1, 'old diff did not mutate book'); ok('old diff no-op');

// --- crossed book → STALE ---
const cross = new LocalOrderBook({ venue: VENUE.SPOT });
cross.applySnapshot({ lastUpdateId: 50, bids: [['1.0', '1']], asks: [['1.1', '1']] });
cross.applyDiff({ U: 51, u: 52, b: [['1.2', '1']], a: [] }); // bid 1.2 >= ask 1.1
assert.strictEqual(cross.state, 'STALE', 'crossed book → STALE'); ok('crossed stale');

// --- futures: pu must chain to previous u ---
const fut = new LocalOrderBook({ venue: VENUE.FUT });
fut.applySnapshot({ lastUpdateId: 200, bids: [['5.0', '1']], asks: [['5.1', '1']] });
fut.applyDiff({ pu: 200, U: 201, u: 205, b: [['5.0', '3']], a: [] }); // pu == lastUpdateId
assert.strictEqual(fut.state, 'READY', 'fut chained diff READY'); ok('fut chain ok');
assert.strictEqual(fut.lastUpdateId, 205, 'fut seq advances to u'); ok('fut seq advances');
fut.applyDiff({ pu: 999, U: 206, u: 210, b: [['5.0', '4']], a: [] }); // pu != lastUpdateId(205)
assert.strictEqual(fut.state, 'STALE', 'fut broken chain → STALE'); ok('fut chain break stale');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_local_orderbook.mjs`
Expected: FAIL — futures `pu` chaining not implemented (futures diff treated by spot rule, assertions mismatch).

- [ ] **Step 3: Update `applyDiff` to branch on venue**

Replace the `applyDiff` method body with:

```js
  applyDiff(diff) {
    if (this.state !== 'READY') return this.state; // must resync via snapshot first
    const { U, u, pu, b = [], a = [] } = diff;
    if (this.venue === VENUE.FUT) {
      if (u < this.lastUpdateId) return this.state;        // stale diff, ignore
      if (pu !== this.lastUpdateId) return this._markStale('seq_gap');
    } else {
      if (u <= this.lastUpdateId) return this.state;        // stale diff, ignore
      if (!(U <= this.lastUpdateId + 1)) return this._markStale('seq_gap');
    }
    for (const [px, q] of b) this._set(this.bids, px, q);
    for (const [px, q] of a) this._set(this.asks, px, q);
    this.lastUpdateId = u;
    if (!this._sane()) return this._markStale('crossed');
    return this.state;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_local_orderbook.mjs`
Expected: PASS — `15 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/marketdata/orderbook/LocalOrderBook.js tests/test_local_orderbook.mjs
git commit -m "feat(orderbook): staleness guards + futures pu/u sequence rule" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: obFeatures — computeBookFeatures (pure)

**Files:**
- Create: `src/marketdata/orderbook/obFeatures.js`
- Test: `tests/test_ob_features.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/test_ob_features.mjs
import assert from 'node:assert';
import { computeBookFeatures } from '../src/marketdata/orderbook/obFeatures.js';
let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// book within ±100 bps of mid=100: bids 99.9(size100)+99.0(size50), asks 100.1(size20)+101.0(size10)
const book = {
  ready: true,
  bids: [[99.9, 100], [99.0, 50], [90.0, 999]], // 90.0 is outside 100bps → excluded from depth
  asks: [[100.1, 20], [101.0, 10], [110.0, 999]],
};
const f = computeBookFeatures(book, { depthBps: 100 });
assert.ok(near(f.mid, 100.0), 'mid'); ok('mid');
assert.ok(near(f.spread, 0.2), 'spread = 100.1-99.9'); ok('spread');
// depth (USD = price*size) within window: bids 99.9*100 + 99.0*50 = 9990+4950 = 14940
assert.ok(near(f.bidDepthNbps, 14940), 'bid depth within bps'); ok('bid depth window');
// asks 100.1*20 + 101.0*10 = 2002+1010 = 3012
assert.ok(near(f.askDepthNbps, 3012), 'ask depth within bps'); ok('ask depth window');
assert.ok(f.imbalance > 0 && f.imbalance <= 1, 'imbalance positive (bid-heavy)'); ok('imbalance sign');
// near wall on bid: largest USD among bid levels = 90.0*999 (89910) — raw, not windowed
assert.ok(near(f.nearWallBid.px, 90.0), 'near wall bid is largest USD level'); ok('near wall bid');
assert.ok(f.nearWallBid.distBps > 0, 'wall distance in bps'); ok('wall dist');

// not ready / one-sided → null
assert.strictEqual(computeBookFeatures({ ready: false, bids: [], asks: [] }), null, 'not ready → null'); ok('not ready null');
assert.strictEqual(computeBookFeatures({ ready: true, bids: [[1, 1]], asks: [] }), null, 'one-sided → null'); ok('one-sided null');

console.log(`\n${p} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_ob_features.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// src/marketdata/orderbook/obFeatures.js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_ob_features.mjs`
Expected: PASS — `9 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/marketdata/orderbook/obFeatures.js tests/test_ob_features.mjs
git commit -m "feat(orderbook): computeBookFeatures pure (depth/imbalance/wall)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: tapeFeatures — computeTapeFeatures (pure)

**Files:**
- Create: `src/marketdata/orderbook/tapeFeatures.js`
- Test: `tests/test_tape_features.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/test_tape_features.mjs
import assert from 'node:assert';
import { computeTapeFeatures } from '../src/marketdata/orderbook/tapeFeatures.js';
let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// Binance aggTrade: m=true → buyer is maker → aggressor is the SELLER.
const now = 10000;
const trades = [
  { t: 2000, p: 10, q: 100, m: false }, // OLD (>5s) → dropped
  { t: 6000, p: 10, q: 50, m: false },  // buy aggressor, 500 usd
  { t: 7000, p: 11, q: 10, m: true },   // sell aggressor, 110 usd
  { t: 9000, p: 12, q: 5, m: false },   // buy aggressor, 60 usd
];
const f = computeTapeFeatures(trades, now, { windowMs: 5000 });
assert.ok(near(f.buyVolUsd, 560), 'buy usd = 500+60'); ok('buy vol');
assert.ok(near(f.sellVolUsd, 110), 'sell usd = 110'); ok('sell vol');
assert.ok(near(f.aggressorImbalance, (560 - 110) / 670), 'aggressor imbalance'); ok('imbalance');
assert.strictEqual(f.lastPrice, 12, 'last price is newest in window'); ok('last price');
assert.ok(near(f.printVelocity, 3 / 5), '3 prints over 5s'); ok('velocity');

// empty window → zeros, not NaN
const z = computeTapeFeatures([], now, { windowMs: 5000 });
assert.strictEqual(z.printVelocity, 0, 'empty velocity 0'); ok('empty velocity');
assert.strictEqual(z.aggressorImbalance, 0, 'empty imbalance 0'); ok('empty imbalance');
assert.strictEqual(z.lastPrice, null, 'empty last price null'); ok('empty last price');

console.log(`\n${p} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_tape_features.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// src/marketdata/orderbook/tapeFeatures.js
/**
 * Pure tape (trade-print) features over a trailing window.
 * @param {{t:number,p:number,q:number,m:boolean}[]} trades aggTrades; m=true → buyer is maker → SELL aggressor
 * @param {number} now current time (ms)
 * @param {{windowMs?:number}} [opts]
 */
export function computeTapeFeatures(trades, now, { windowMs = 5000 } = {}) {
  const recent = (trades || []).filter((tr) => now - tr.t <= windowMs);
  if (!recent.length) {
    return { lastPrice: null, printVelocity: 0, aggressorImbalance: 0, buyVolUsd: 0, sellVolUsd: 0 };
  }
  let buyVolUsd = 0, sellVolUsd = 0;
  for (const tr of recent) {
    const usd = tr.p * tr.q;
    if (tr.m) sellVolUsd += usd; // buyer maker → seller aggressed
    else buyVolUsd += usd;       // buyer taker → buyer aggressed
  }
  const total = buyVolUsd + sellVolUsd;
  return {
    lastPrice: recent[recent.length - 1].p,
    printVelocity: recent.length / (windowMs / 1000),
    aggressorImbalance: total > 0 ? (buyVolUsd - sellVolUsd) / total : 0,
    buyVolUsd, sellVolUsd,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_tape_features.mjs`
Expected: PASS — `8 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/marketdata/orderbook/tapeFeatures.js tests/test_tape_features.mjs
git commit -m "feat(orderbook): computeTapeFeatures pure (velocity/aggressor)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: buildSnapshot — dual-book getFeatures contract (pure)

**Files:**
- Create: `src/marketdata/orderbook/snapshot.js`
- Test: `tests/test_ob_snapshot.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/test_ob_snapshot.mjs
import assert from 'node:assert';
import { buildSnapshot } from '../src/marketdata/orderbook/snapshot.js';
let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

const futBook = { ready: true, bids: [[100.0, 10]], asks: [[100.1, 10]] };
const spotBook = { ready: true, bids: [[100.0, 99]], asks: [[100.1, 5]] };
const trades = [{ t: 9000, p: 100, q: 3, m: false }];
const opts = { book: { depthBps: 100 }, tape: { windowMs: 5000 } };

// both books ready
let s = buildSnapshot({ symbol: 'GPSUSDT', ts: 9000, now: 9000, futBook, futTrades: trades, spotBook, opts });
assert.strictEqual(s.ready, true, 'futures ready → ready'); ok('ready');
assert.strictEqual(s.spotReady, true, 'spot ready → spotReady'); ok('spotReady');
assert.strictEqual(s.symbol, 'GPSUSDT', 'symbol'); ok('symbol');
assert.ok(s.futures && typeof s.futures.mid === 'number', 'futures features present'); ok('futures present');
assert.ok('printVelocity' in s.futures, 'tape merged into futures'); ok('tape merged');
assert.ok(s.spot && typeof s.spot.mid === 'number', 'spot features present'); ok('spot present');

// spot absent → spotReady false, spot null, futures still primary
s = buildSnapshot({ symbol: 'GPSUSDT', ts: 9000, now: 9000, futBook, futTrades: trades, spotBook: null, opts });
assert.strictEqual(s.ready, true, 'futures still primary'); ok('fut primary w/o spot');
assert.strictEqual(s.spotReady, false, 'no spot → spotReady false'); ok('no spot');
assert.strictEqual(s.spot, null, 'no spot → spot null'); ok('spot null');

// futures stale → not ready, futures null
s = buildSnapshot({ symbol: 'GPSUSDT', ts: 9000, now: 9000, futBook: { ready: false, bids: [], asks: [] }, futTrades: trades, spotBook, opts });
assert.strictEqual(s.ready, false, 'stale futures → not ready'); ok('stale fut');
assert.strictEqual(s.futures, null, 'stale futures → futures null'); ok('fut null');

console.log(`\n${p} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_ob_snapshot.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// src/marketdata/orderbook/snapshot.js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_ob_snapshot.mjs`
Expected: PASS — `11 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/marketdata/orderbook/snapshot.js tests/test_ob_snapshot.mjs
git commit -m "feat(orderbook): buildSnapshot dual-book getFeatures contract" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Recorder — JSONL append + path layout

**Files:**
- Create: `src/marketdata/orderbook/Recorder.js`
- Test: `tests/test_ob_recorder.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/test_ob_recorder.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Recorder, frameLine } from '../src/marketdata/orderbook/Recorder.js';
let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

// frameLine is pure: stamps t + serializes to one JSON line
const line = frameLine(1718380000123, 'GPSUSDT', 'fut', { k: 'trade', p: '0.0075', q: '14000', m: false });
const parsed = JSON.parse(line);
assert.strictEqual(parsed.t, 1718380000123, 'timestamp'); ok('frame t');
assert.strictEqual(parsed.sym, 'GPSUSDT', 'symbol'); ok('frame sym');
assert.strictEqual(parsed.v, 'fut', 'venue'); ok('frame venue');
assert.strictEqual(parsed.k, 'trade', 'kind passthrough'); ok('frame kind');

// Recorder writes one file per symbol/venue/day under root, appending lines.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'obrec-'));
const rec = new Recorder({ root });
rec.write('GPSUSDT', 'fut', 1718380000123, { k: 'trade', p: '0.0075', q: '14000', m: false });
rec.write('GPSUSDT', 'fut', 1718380000223, { k: 'state', state: 'STALE', reason: 'seq_gap' });
rec.close();

const file = path.join(root, 'GPSUSDT', 'fut', '2024-06-14.jsonl');
assert.ok(fs.existsSync(file), 'file at symbol/venue/day path'); ok('file path');
const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
assert.strictEqual(lines.length, 2, 'two appended lines'); ok('appended');
assert.strictEqual(JSON.parse(lines[1]).state, 'STALE', 'second line content'); ok('line content');

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${p} checks passed`);
```

> Note: the day folder is derived from the frame timestamp in UTC; `1718380000123` is 2024-06-14.

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_ob_recorder.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// src/marketdata/orderbook/Recorder.js
import fs from 'node:fs';
import path from 'node:path';

/** Pure: stamp + serialize one raw frame to a JSONL line. */
export function frameLine(t, sym, venue, frame) {
  return JSON.stringify({ t, sym, v: venue, ...frame });
}

function dayUTC(ms) {
  return new Date(ms).toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Appends raw order-book frames to JSONL, one file per symbol/venue/UTC-day.
 * IO only — keeps append streams open per file key and reuses them.
 */
export class Recorder {
  constructor({ root = 'data/orderbook' } = {}) {
    this.root = root;
    this.streams = new Map(); // fileKey -> WriteStream
  }

  write(sym, venue, t, frame) {
    const day = dayUTC(t);
    const key = `${sym}/${venue}/${day}`;
    let stream = this.streams.get(key);
    if (!stream) {
      const dir = path.join(this.root, sym, venue);
      fs.mkdirSync(dir, { recursive: true });
      stream = fs.createWriteStream(path.join(dir, `${day}.jsonl`), { flags: 'a' });
      this.streams.set(key, stream);
    }
    stream.write(frameLine(t, sym, venue, frame) + '\n');
  }

  close() {
    for (const s of this.streams.values()) s.end();
    this.streams.clear();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_ob_recorder.mjs`
Expected: PASS — `7 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/marketdata/orderbook/Recorder.js tests/test_ob_recorder.mjs
git commit -m "feat(orderbook): Recorder JSONL append by symbol/venue/day" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: replay — re-drive the pure core from recorded events

**Files:**
- Create: `src/marketdata/orderbook/replay.js`
- Test: `tests/test_ob_replay.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/test_ob_replay.mjs
import assert from 'node:assert';
import { LocalOrderBook, VENUE } from '../src/marketdata/orderbook/LocalOrderBook.js';
import { computeBookFeatures } from '../src/marketdata/orderbook/obFeatures.js';
import { replayEvents } from '../src/marketdata/orderbook/replay.js';
let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

// Recorded events (as parsed JSONL frames) for one spot book.
const events = [
  { k: 'snapshot', lastUpdateId: 100, bids: [['10.0', '2'], ['9.9', '3']], asks: [['10.1', '1']] },
  { k: 'depth', U: 101, u: 102, b: [['10.0', '5']], a: [] },
  { k: 'trade', p: '10.05', q: '1', m: false }, // ignored by book replay
];

const stream = replayEvents(events, { venue: VENUE.SPOT, depthLimit: 5, bookOpts: { depthBps: 100 } });
assert.strictEqual(stream.length, 2, 'one feature row per book event (snapshot + depth)'); ok('row count');

// Determinism: hand-driving the same core must reproduce the final feature row.
const b = new LocalOrderBook({ venue: VENUE.SPOT, depthLimit: 5 });
b.applySnapshot({ lastUpdateId: 100, bids: [['10.0', '2'], ['9.9', '3']], asks: [['10.1', '1']] });
b.applyDiff({ U: 101, u: 102, b: [['10.0', '5']], a: [] });
const expected = computeBookFeatures(b.snapshotBook(), { depthBps: 100 });
assert.deepStrictEqual(stream[stream.length - 1], expected, 'replay reproduces hand-driven features'); ok('determinism');

console.log(`\n${p} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_ob_replay.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// src/marketdata/orderbook/replay.js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_ob_replay.mjs`
Expected: PASS — `2 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/marketdata/orderbook/replay.js tests/test_ob_replay.mjs
git commit -m "feat(orderbook): replayEvents re-drives core for reproducibility" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: BinanceDepthClient — one-venue websocket + REST snapshot (IO)

**Files:**
- Create: `src/marketdata/orderbook/BinanceDepthClient.js`
- Modify: `package.json` (add `ws` dependency)

> IO layer — not unit-tested (verified by the Task 9 smoke run). Keep it thin: connect, fetch the REST snapshot, emit raw parsed frames via callbacks. No book logic here.

- [ ] **Step 1: Add the `ws` dependency**

Run: `npm install ws`
Expected: `ws` appears under `dependencies` in `package.json` and `package-lock.json` updates.

- [ ] **Step 2: Write the client**

```js
// src/marketdata/orderbook/BinanceDepthClient.js
import WebSocket from 'ws';

const ENDPOINTS = {
  spot: {
    ws: (sym) => `wss://stream.binance.com:9443/ws/${sym.toLowerCase()}@depth@100ms`,
    rest: (sym, limit) => `https://api.binance.com/api/v3/depth?symbol=${sym.toUpperCase()}&limit=${limit}`,
    hasTape: false,
  },
  fut: {
    ws: (sym) => `wss://fstream.binance.com/ws/${sym.toLowerCase()}@depth@100ms/${sym.toLowerCase()}@aggTrade`,
    rest: (sym, limit) => `https://fapi.binance.com/fapi/v1/depth?symbol=${sym.toUpperCase()}&limit=${limit}`,
    hasTape: true,
  },
};

/**
 * Thin IO for ONE venue: opens the depth (+ futures aggTrade) websocket and fetches the
 * REST snapshot. Emits raw parsed frames through the handlers; all book/sequence logic
 * lives in LocalOrderBook. Reconnects with exponential backoff.
 */
export class BinanceDepthClient {
  constructor({ symbol, venue, depthLimit = 20, onDepth, onTrade, onSnapshot, onStatus, maxBackoffMs = 30000 }) {
    this.symbol = symbol;
    this.venue = venue;
    this.depthLimit = depthLimit;
    this.endpoints = ENDPOINTS[venue];
    this.onDepth = onDepth || (() => {});
    this.onTrade = onTrade || (() => {});
    this.onSnapshot = onSnapshot || (() => {});
    this.onStatus = onStatus || (() => {});
    this.maxBackoffMs = maxBackoffMs;
    this.backoff = 1000;
    this.ws = null;
    this.closed = false;
  }

  async fetchSnapshot() {
    const url = this.endpoints.rest(this.symbol, this.depthLimit);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`snapshot ${this.venue} ${this.symbol} HTTP ${res.status}`);
    const data = await res.json();
    // futures uses E (event time); both use bids/asks + lastUpdateId.
    return { lastUpdateId: data.lastUpdateId, bids: data.bids, asks: data.asks };
  }

  connect() {
    if (this.closed) return;
    const ws = new WebSocket(this.endpoints.ws(this.symbol));
    this.ws = ws;
    ws.on('open', () => { this.backoff = 1000; this.onStatus('open'); });
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.e === 'depthUpdate') {
        this.onDepth({ U: msg.U, u: msg.u, pu: msg.pu, b: msg.b, a: msg.a, t: msg.E });
      } else if (msg.e === 'aggTrade') {
        this.onTrade({ t: msg.T, p: Number(msg.p), q: Number(msg.q), m: msg.m });
      }
    });
    ws.on('close', () => { this.onStatus('close'); this._reconnect(); });
    ws.on('error', () => { try { ws.close(); } catch { /* ignore */ } });
  }

  _reconnect() {
    if (this.closed) return;
    setTimeout(() => this.connect(), this.backoff);
    this.backoff = Math.min(this.backoff * 2, this.maxBackoffMs);
  }

  close() { this.closed = true; if (this.ws) try { this.ws.close(); } catch { /* ignore */ } }
}
```

- [ ] **Step 3: Sanity-check the module loads**

Run: `node -e "import('./src/marketdata/orderbook/BinanceDepthClient.js').then(()=>console.log('loads ok'))"`
Expected: `loads ok` (verifies `ws` is installed and the module parses; no network call).

- [ ] **Step 4: Commit**

```bash
git add src/marketdata/orderbook/BinanceDepthClient.js package.json package-lock.json
git commit -m "feat(orderbook): BinanceDepthClient ws+REST per venue (futures tape)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: OrderBookFeed orchestrator + record-only CLI + gitignore

**Files:**
- Create: `src/marketdata/orderbook/OrderBookFeed.js`
- Create: `scripts/record-orderbook.mjs`
- Modify: `.gitignore` (add `data/orderbook/`)

> IO orchestrator — wires Tasks 1–8 together. Verified by a live smoke run, not a unit test.

- [ ] **Step 1: Write the orchestrator**

```js
// src/marketdata/orderbook/OrderBookFeed.js
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
      onStatus: (s) => { if (s === 'close') { entry.synced[venue] = false; entry.buffers[venue] = []; this._syncVenue(key, venueSymbol, venue, entry); } },
    });
  }

  async _syncVenue(key, venueSymbol, venue, entry) {
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
    for (const entry of this.books.values()) for (const c of entry.clients) c.close();
    if (this.recorder) this.recorder.close();
  }
}
```

- [ ] **Step 2: Write the record-only CLI**

```js
// scripts/record-orderbook.mjs
import { OrderBookFeed } from '../src/marketdata/orderbook/OrderBookFeed.js';

// Usage: node scripts/record-orderbook.mjs --symbols GPSUSDT,SUIUSDT --minutes 2 [--no-spot]
function parseArgs(argv) {
  const out = { symbols: ['GPSUSDT'], minutes: 2, spot: true };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--symbols') out.symbols = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--minutes') out.minutes = Number(argv[++i]);
    else if (a === '--no-spot') out.spot = false;
  }
  return out;
}

const args = parseArgs(process.argv);
const symbols = args.symbols.map((s) => ({ futures: s, spot: args.spot ? s : null }));
const feed = new OrderBookFeed({ symbols, record: true });
feed.start();
console.log(`Recording ${args.symbols.join(', ')} for ${args.minutes} min (spot=${args.spot})...`);

const printTimer = setInterval(() => {
  for (const s of args.symbols) {
    const f = feed.getFeatures(s);
    console.log(`${s} ready=${f.ready} spotReady=${f.spotReady}`, f.futures ? { mid: f.futures.mid, imbalance: f.futures.imbalance, wallBid: f.futures.nearWallBid?.sizeUsd } : null);
  }
}, 10000);

setTimeout(() => {
  clearInterval(printTimer);
  feed.stop();
  console.log('Done. Frames written under data/orderbook/.');
  process.exit(0);
}, args.minutes * 60 * 1000);
```

- [ ] **Step 3: Add the data directory to .gitignore**

Add this line to `.gitignore`:

```
data/orderbook/
```

- [ ] **Step 4: Smoke-run the feed (manual, requires network)**

Run: `node scripts/record-orderbook.mjs --symbols BTCUSDT --minutes 2`
Expected: within ~10s, lines like `BTCUSDT ready=true spotReady=true { mid: <num>, imbalance: <num>, wallBid: <num> }`; after 2 min it prints `Done.` and a file exists at `data/orderbook/BTCUSDT/fut/<today>.jsonl` (and `.../spot/...`). Verify the file is non-empty and contains `"k":"snapshot"` then `"k":"depth"` lines.

> Use BTCUSDT for the smoke test (always liquid on both venues). Illiquid microcaps (GPSUSDT) may have no Binance **spot** listing → expect `spotReady=false`, which is correct behavior, not a failure.

- [ ] **Step 5: Confirm recorded data is ignored by git**

Run: `git status --porcelain data/orderbook/`
Expected: **no output** (the directory is gitignored; nothing staged).

- [ ] **Step 6: Commit**

```bash
git add src/marketdata/orderbook/OrderBookFeed.js scripts/record-orderbook.mjs .gitignore
git commit -m "feat(orderbook): OrderBookFeed orchestrator + record-only CLI" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] Run the full SP1 unit suite and confirm all pass:

```bash
node tests/test_local_orderbook.mjs && node tests/test_ob_features.mjs && node tests/test_tape_features.mjs && node tests/test_ob_snapshot.mjs && node tests/test_ob_recorder.mjs && node tests/test_ob_replay.mjs
```
Expected: each prints `N checks passed` with no `AssertionError`.

- [ ] Confirm no existing tests regressed (the SP1 work is additive and under a new directory):

```bash
node tests/test_pump_dump.mjs && node tests/test_pump_dump_gate.mjs
```
Expected: both still pass.

---

## Self-Review notes (for the controller)

- **Spec coverage:** §Section 1 data flow → Tasks 1–2 (sequence sync per venue) + Task 9 (buffering during sync, fut+spot wiring). §Section 2 feature contract → Tasks 3–5 (book/tape/dual-book). §Section 3 staleness/state machine → Task 2 (STALE transitions) + Task 9 (`_onStale` resync, reconnect resync). §Section 3 recording format → Task 6 (JSONL `t/sym/v/k`, symbol/venue/day path) + Task 9 (snapshot/depth/trade/state frames written). §Section 3 replay → Task 7. §Section 4 tests → Tasks 1–7 unit/integration + Task 9 smoke. Spot-absent / illiquid handling → Task 5 (`spotReady:false`) + Task 9 smoke note.
- **Honesty invariant:** primary readiness = futures (`buildSnapshot` Task 5); stale futures → `ready:false`, `futures:null`. Gate (SP2) consumes this; SP1 never trades.
- **YAGNI deferred to SP2:** wall-eaten dynamics, the gate, the breakout/bounce signals — not in this plan. The internal `LocalOrderBook` Map is not pruned below top-N (output is capped; periodic resync in SP2/ops bounds drift) — acceptable for SP1.
