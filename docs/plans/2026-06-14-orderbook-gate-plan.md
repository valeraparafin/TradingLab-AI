# SP2a — Order-Book Gate + Breakout-Confirm Signal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn SP1's live order-book features into a deterministic breakout-confirm trading signal plus a veto gate (`withOrderBookGate`), as pure testable units, with an offline replay harness for feedback.

**Architecture:** Three pure functions — `levelFromCandles` (candles define the level), `breakoutSignal` (the order book confirms impulse on a level cross), `withOrderBookGate` (final veto, mirrors `withPumpDumpGate`) — plus a pure replay core (`replaySignals` + `framesToSnapshots`) and a thin CLI that drives it from recorded SP1 JSONL. No LLM, no live wiring, no real money (SP3/SP4).

**Tech Stack:** Node.js ESM, no test framework (plain `node:assert` + a `let p=0; ok()` counter, run via `node tests/<file>.mjs`). Reuses SP1 modules under `src/marketdata/orderbook/` and `SIDE` from `src/core/contracts.js`.

**Spec:** `docs/specs/2026-06-14-orderbook-gate-design.md` (local/untracked).

**Conventions:**
- Commit trailer EXACTLY: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- Specs/plans stay LOCAL/untracked — never `git add docs/`.
- `feat.futures` is the PRIMARY book (drives `ready`, carries the tape); `feat.spot` is soft confirmation.
- Recorded line shape (from SP1 Recorder): `{ t, sym, v, k, ... }` where `v` ∈ `{'fut','spot'}` and
  `k`: `'snapshot'` → `{lastUpdateId,bids,asks}`, `'depth'` → `{U,u,pu,b,a}`,
  `'trade'` → `{p,q,m}`, `'state'` → `{state,reason}`.

---

### Task 1: `levelFromCandles` — candle-defined breakout level

**Files:**
- Create: `src/marketdata/orderbook/levels.js`
- Test: `tests/test_ob_levels.mjs`

Reuses the proven coil/pinch approach from `src/indicators/scalpBreakout.js` (resistance = highest high
of the prior `lookback` bars excluding the current bar; support = lowest low; `coiled` = recent range
has tightened vs the preceding window).

- [ ] **Step 1: Write the failing test**

```js
// tests/test_ob_levels.mjs
import assert from 'node:assert';
import { levelFromCandles } from '../src/marketdata/orderbook/levels.js';
let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

const bar = (h, l) => ({ time: 0, open: (h + l) / 2, high: h, low: l, close: (h + l) / 2, volume: 1 });

// too few candles → nulls
let r = levelFromCandles([bar(10, 9)], { lookback: 20 });
assert.strictEqual(r.resistance, null); assert.strictEqual(r.support, null); assert.strictEqual(r.coiled, false);
ok('too few candles → nulls');

// resistance/support from the prior lookback bars (current bar excluded)
const flat = Array.from({ length: 21 }, () => bar(110, 90)); // every range = 20
r = levelFromCandles(flat, { lookback: 20, pinchBars: 6, pinchRatio: 0.7 });
assert.strictEqual(r.resistance, 110); assert.strictEqual(r.support, 90);
ok('resistance/support from prior bars');
// recent range (20) is NOT <= 0.7 * earlier range (20) → not coiled
assert.strictEqual(r.coiled, false);
ok('flat ranges → not coiled');

// coiled: first 14 bars wide (range 40), last 7 tight (range 10)
const wide = Array.from({ length: 14 }, () => bar(120, 80));
const tight = Array.from({ length: 7 }, () => bar(105, 95));
r = levelFromCandles([...wide, ...tight], { lookback: 20, pinchBars: 6, pinchRatio: 0.7 });
assert.strictEqual(r.resistance, 120); assert.strictEqual(r.support, 80);
assert.strictEqual(r.coiled, true);
ok('tightening range → coiled');

console.log(`\n${p} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_ob_levels.mjs`
Expected: FAIL — `Cannot find module '.../levels.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/marketdata/orderbook/levels.js
const rangeOf = (arr) => Math.max(...arr.map((c) => c.high)) - Math.min(...arr.map((c) => c.low));

/**
 * Candle-defined breakout level: resistance/support over the prior `lookback` bars
 * (current bar excluded) and whether the range has coiled (pinch). The order book
 * confirms the *break*; candles only define the level. Mirrors src/indicators/scalpBreakout.js.
 * @param {{high:number,low:number}[]} candles
 * @param {{lookback?:number, pinchBars?:number, pinchRatio?:number}} [opts]
 * @returns {{resistance:number|null, support:number|null, coiled:boolean}}
 */
export function levelFromCandles(candles, { lookback = 20, pinchBars = 6, pinchRatio = 0.7 } = {}) {
  if (!candles || candles.length < lookback + 1) {
    return { resistance: null, support: null, coiled: false };
  }
  const prior = candles.slice(candles.length - lookback - 1, candles.length - 1); // lookback bars, excl current
  const resistance = Math.max(...prior.map((c) => c.high));
  const support = Math.min(...prior.map((c) => c.low));
  const recent = prior.slice(-pinchBars);
  const earlier = prior.slice(-2 * pinchBars, -pinchBars);
  const coiled = earlier.length === 0 ? true : rangeOf(recent) <= pinchRatio * rangeOf(earlier);
  return { resistance, support, coiled };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_ob_levels.mjs`
Expected: PASS — `4 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/marketdata/orderbook/levels.js tests/test_ob_levels.mjs
git commit -m "feat(ob-gate): levelFromCandles — candle-defined breakout level + coil

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `breakoutSignal` — order-book-confirmed breakout signal

**Files:**
- Create: `src/marketdata/orderbook/breakoutSignal.js`
- Test: `tests/test_breakout_signal.mjs`

Pure function of `(candle level + one SP1 snapshot + prevMid)`. Triggers on a mid *cross* of the level,
confirms with book imbalance + tape aggression + thin opposite side + live tape. Spot is a SOFT
confirmation (boosts/penalizes conviction, never blocks). No money numbers.

- [ ] **Step 1: Write the failing test**

```js
// tests/test_breakout_signal.mjs
import assert from 'node:assert';
import { breakoutSignal } from '../src/marketdata/orderbook/breakoutSignal.js';
let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

const LEVEL = { resistance: 100, support: 90, coiled: true };

// build a futures-primary snapshot; spotImb!=null adds a spot confirm book
const feat = ({ imb = 0.5, agg = 0.5, vel = 5, ask = 100, bid = 200, mid = 105, spread = 0.1, spotImb = null } = {}) => ({
  ready: true, spotReady: spotImb != null, ts: 1000,
  futures: {
    mid, spread, microprice: mid, bidDepthNbps: bid, askDepthNbps: ask,
    imbalance: imb, aggressorImbalance: agg, printVelocity: vel,
    nearWallBid: null, nearWallAsk: null, lastPrice: mid, buyVolUsd: 0, sellVolUsd: 0,
  },
  spot: spotImb != null ? { mid, spread, imbalance: spotImb, bidDepthNbps: bid, askDepthNbps: ask } : null,
});

// BUY confirm: cross above resistance, bid-heavy, buyers aggressing, thin asks, live tape
let s = breakoutSignal({ level: LEVEL, feat: feat(), prevMid: 99 });
assert.ok(s && s.side === 'BUY' && s.setup === 'breakout'); ok('BUY confirm fires');
assert.deepStrictEqual(s.invalidation, { backInsideRange: 100 }); ok('invalidation = broken level');

// SELL confirm: cross below support (mid 85), ask-heavy, sellers aggressing, thin bids
const fsell = feat({ imb: -0.5, agg: -0.5, mid: 85, bid: 100, ask: 200 });
s = breakoutSignal({ level: LEVEL, feat: fsell, prevMid: 91 });
assert.ok(s && s.side === 'SELL'); ok('SELL confirm fires');

// trigger but book contradicts (imbalance negative on a BUY cross) → null
s = breakoutSignal({ level: LEVEL, feat: feat({ imb: -0.5 }), prevMid: 99 });
assert.strictEqual(s, null); ok('trigger but book contradicts → null');

// dead tape (printVelocity below floor) → null
s = breakoutSignal({ level: LEVEL, feat: feat({ vel: 0.1 }), prevMid: 99 });
assert.strictEqual(s, null); ok('dead tape → null');

// no prevMid (first tick) → null
s = breakoutSignal({ level: LEVEL, feat: feat(), prevMid: null });
assert.strictEqual(s, null); ok('no prevMid → null');

// not ready → null
s = breakoutSignal({ level: LEVEL, feat: { ready: false, futures: null }, prevMid: 99 });
assert.strictEqual(s, null); ok('not ready → null');

// conviction: spot agree boosts, spot disagree penalizes, spot missing still fires
const base = breakoutSignal({ level: LEVEL, feat: feat(), prevMid: 99 });
const boosted = breakoutSignal({ level: LEVEL, feat: feat({ spotImb: 0.5 }), prevMid: 99 });
const penalized = breakoutSignal({ level: LEVEL, feat: feat({ spotImb: -0.5 }), prevMid: 99 });
assert.ok(base && base.conviction > 0); ok('spot missing → futures-only signal fires');
assert.ok(boosted.conviction > base.conviction); ok('spot agree boosts conviction');
assert.ok(penalized.conviction < base.conviction); ok('spot disagree penalizes conviction');

console.log(`\n${p} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_breakout_signal.mjs`
Expected: FAIL — `Cannot find module '.../breakoutSignal.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/marketdata/orderbook/breakoutSignal.js
import { SIDE } from '../../core/contracts.js';

const DEF = { imbThresh: 0.15, aggThresh: 0.15, minVelocity: 0.5, spotBoost: 0.1, spotPenalty: 0.15 };
const clamp01 = (x) => Math.max(0, Math.min(1, x));

/**
 * Deterministic breakout-confirm signal. Candles define the level; the order book + tape
 * confirm a mid *cross* has impulse. Spot is a SOFT confirm (conviction only, never blocks).
 * @param {{level:{resistance:number|null,support:number|null}, feat:object,
 *          prevMid:number|null, opts?:object}} args
 *   feat = one SP1 snapshot: {ready, spotReady, ts, futures, spot}
 * @returns {{side:string, setup:'breakout', conviction:number, rationale:string,
 *            invalidation:{backInsideRange:number}} | null}
 */
export function breakoutSignal({ level, feat, prevMid, opts = {} }) {
  const o = { ...DEF, ...opts };
  if (!feat || !feat.ready || !feat.futures) return null;
  if (prevMid == null) return null;
  if (!level || level.resistance == null || level.support == null) return null;

  const f = feat.futures;
  const mid = f.mid;

  // Trigger: detect the cross, not merely "currently beyond".
  let side = null, brokenLevel = null;
  if (prevMid <= level.resistance && mid > level.resistance) { side = SIDE.BUY; brokenLevel = level.resistance; }
  else if (prevMid >= level.support && mid < level.support) { side = SIDE.SELL; brokenLevel = level.support; }
  if (!side) return null;

  // Book confirm (BUY: dir=+1; SELL mirrors all signs via dir=-1).
  const dir = side === SIDE.BUY ? 1 : -1;
  const imbOk = dir * f.imbalance > o.imbThresh;
  const aggOk = dir * f.aggressorImbalance > o.aggThresh;
  const thinOpp = side === SIDE.BUY ? f.askDepthNbps < f.bidDepthNbps : f.bidDepthNbps < f.askDepthNbps;
  const velOk = f.printVelocity >= o.minVelocity;
  if (!(imbOk && aggOk && thinOpp && velOk)) return null;

  // Base conviction from alignment strength of book imbalance + tape aggression.
  const align = (Math.min(Math.abs(f.imbalance), 1) + Math.min(Math.abs(f.aggressorImbalance), 1)) / 2;
  let conviction = clamp01(align);

  // Spot SOFT-confirm.
  if (feat.spotReady && feat.spot) {
    const spotDir = dir * feat.spot.imbalance;
    if (spotDir > o.imbThresh) conviction += o.spotBoost;
    else if (spotDir < -o.imbThresh) conviction -= o.spotPenalty;
    conviction = clamp01(conviction);
  }

  return {
    side,
    setup: 'breakout',
    conviction,
    rationale: `breakout ${side} thru ${brokenLevel}: imb=${f.imbalance.toFixed(2)} agg=${f.aggressorImbalance.toFixed(2)} vel=${f.printVelocity.toFixed(1)}`,
    invalidation: { backInsideRange: brokenLevel },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_breakout_signal.mjs`
Expected: PASS — `9 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/marketdata/orderbook/breakoutSignal.js tests/test_breakout_signal.mjs
git commit -m "feat(ob-gate): breakoutSignal — book-confirmed breakout with soft spot confirm

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `withOrderBookGate` — final veto decorator

**Files:**
- Create: `src/marketdata/orderbook/obGate.js`
- Test: `tests/test_ob_gate.mjs`

Mirrors `src/backtest/pumpDumpGate.js`: wraps a `decide(ctx, account) → {signal, decision}`, passes
non-PERMIT through untouched, vetoes a PERMIT → DENY when the book is not ready, the spread is too wide,
or the book contradicts the signal's side. Reads the SP1 snapshot from `ctx.feat`.

- [ ] **Step 1: Write the failing test**

```js
// tests/test_ob_gate.mjs
import assert from 'node:assert';
import { withOrderBookGate } from '../src/marketdata/orderbook/obGate.js';
let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

const featOk = { ready: true, futures: { mid: 100, spread: 0.05, imbalance: 0.5 } };
const permitBuy = () => ({ signal: { side: 'BUY' }, decision: { decision: 'PERMIT', order: { side: 'BUY' } } });

let g = withOrderBookGate(permitBuy);
assert.strictEqual(g({ feat: featOk }, {}).decision.decision, 'PERMIT'); ok('clean PERMIT passes');

// BUY but imbalance < 0 → contradiction
assert.strictEqual(
  g({ feat: { ready: true, futures: { mid: 100, spread: 0.05, imbalance: -0.3 } } }, {}).decision.reason,
  'ob gate: book contradicts side'); ok('BUY + negative imbalance → DENY');

// book not ready
assert.strictEqual(g({ feat: { ready: false } }, {}).decision.decision, 'DENY'); ok('not ready → DENY');

// wide spread: 8bps of mid 100 = 0.08; spread 0.2 exceeds it
assert.strictEqual(
  g({ feat: { ready: true, futures: { mid: 100, spread: 0.2, imbalance: 0.5 } } }, {}).decision.reason,
  'ob gate: spread too wide'); ok('wide spread → DENY');

// inner HOLD / DENY pass through unchanged
g = withOrderBookGate(() => ({ signal: null, decision: { decision: 'HOLD' } }));
assert.strictEqual(g({ feat: featOk }, {}).decision.decision, 'HOLD'); ok('inner HOLD preserved');
g = withOrderBookGate(() => ({ signal: {}, decision: { decision: 'DENY', reason: 'x' } }));
assert.strictEqual(g({ feat: featOk }, {}).decision.reason, 'x'); ok('inner DENY preserved');

console.log(`\n${p} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_ob_gate.mjs`
Expected: FAIL — `Cannot find module '.../obGate.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/marketdata/orderbook/obGate.js
import { SIDE } from '../../core/contracts.js';

/**
 * Wrap a decide fn so a PERMIT survives only when the live order book confirms it.
 * Reads the SP1 snapshot from ctx.feat. Inner DENY/HOLD/non-PERMIT pass through.
 * Same {signal, decision} shape as withPumpDumpGate / withHtfGate so it composes.
 * @param {(ctx:object, account:object)=>{signal:object, decision:object}} decide
 * @param {{maxSpreadBps?:number}} [opts]
 */
export function withOrderBookGate(decide, opts = {}) {
  const maxSpreadBps = opts.maxSpreadBps ?? 8;
  return (ctx, account) => {
    const result = decide(ctx, account);
    const d = result && result.decision;
    if (!d || d.decision !== 'PERMIT' || !d.order) return result;

    const feat = ctx && ctx.feat;
    if (!feat || !feat.ready || !feat.futures) {
      return { signal: result.signal, decision: { decision: 'DENY', reason: 'ob gate: book not ready' } };
    }
    const f = feat.futures;
    if (f.spread / f.mid > maxSpreadBps / 10000) {
      return { signal: result.signal, decision: { decision: 'DENY', reason: 'ob gate: spread too wide' } };
    }
    const side = result.signal && result.signal.side;
    if ((side === SIDE.BUY && f.imbalance < 0) || (side === SIDE.SELL && f.imbalance > 0)) {
      return { signal: result.signal, decision: { decision: 'DENY', reason: 'ob gate: book contradicts side' } };
    }
    return result;
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_ob_gate.mjs`
Expected: PASS — `6 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/marketdata/orderbook/obGate.js tests/test_ob_gate.mjs
git commit -m "feat(ob-gate): withOrderBookGate veto decorator (mirrors withPumpDumpGate)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `replaySignals` — pure replay core (snapshots → signals)

**Files:**
- Create: `src/marketdata/orderbook/replaySignals.js`
- Test: `tests/test_ob_signal_replay.mjs`

Pure core that drives a sequence of SP1 feature snapshots + candles through `levelFromCandles` →
`breakoutSignal` → `withOrderBookGate`, tracking `prevMid` across snapshots and collecting the PERMITted
signals. (`framesToSnapshots` in Task 5 lands in the same file.)

- [ ] **Step 1: Write the failing test**

```js
// tests/test_ob_signal_replay.mjs
import assert from 'node:assert';
import { replaySignals } from '../src/marketdata/orderbook/replaySignals.js';
let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

const bar = (h, l) => ({ time: 0, open: (h + l) / 2, high: h, low: l, close: (h + l) / 2, volume: 1 });
const candles = Array.from({ length: 21 }, () => bar(100, 90)); // resistance 100, support 90

const snap = (mid) => ({
  ready: true, spotReady: false, ts: mid,
  futures: {
    mid, spread: 0.01, microprice: mid, bidDepthNbps: 200, askDepthNbps: 100,
    imbalance: 0.5, aggressorImbalance: 0.5, printVelocity: 5,
    nearWallBid: null, nearWallAsk: null, lastPrice: mid,
  },
  spot: null,
});

// below resistance, then cross above → exactly one BUY signal
const sigs = replaySignals([snap(99), snap(101)], candles);
assert.strictEqual(sigs.length, 1); ok('one breakout signal on the cross');
assert.strictEqual(sigs[0].side, 'BUY'); ok('signal is BUY');
assert.strictEqual(sigs[0].ts, 101); ok('signal carries snapshot ts');

console.log(`\n${p} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_ob_signal_replay.mjs`
Expected: FAIL — `Cannot find module '.../replaySignals.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/marketdata/orderbook/replaySignals.js
import { levelFromCandles } from './levels.js';
import { breakoutSignal } from './breakoutSignal.js';
import { withOrderBookGate } from './obGate.js';

/**
 * Pure replay core: drive feature snapshots + candles through the SP2a pipeline and
 * collect PERMITted signals. The candle level is computed once from `candles` (the
 * reference the live mid must cross); `prevMid` is tracked across snapshots.
 * @param {object[]} snapshots SP1 feature snapshots in time order
 * @param {{high:number,low:number}[]} candles
 * @param {{level?:object, signal?:object, gate?:object}} [opts]
 * @returns {Array<{ts:number, side:string, setup:string, conviction:number, rationale:string, invalidation:object}>}
 */
export function replaySignals(snapshots, candles, opts = {}) {
  const level = levelFromCandles(candles, opts.level);
  const decide = (ctx) => {
    const sig = breakoutSignal({ level, feat: ctx.feat, prevMid: ctx.prevMid, opts: opts.signal });
    if (!sig) return { signal: null, decision: { decision: 'HOLD' } };
    return { signal: sig, decision: { decision: 'PERMIT', order: { side: sig.side } } };
  };
  const gated = withOrderBookGate(decide, opts.gate);

  const out = [];
  let prevMid = null;
  for (const feat of snapshots) {
    const r = gated({ feat, prevMid }, {});
    if (r.signal && r.decision.decision === 'PERMIT') {
      out.push({ ts: feat.ts, ...r.signal });
    }
    if (feat.ready && feat.futures) prevMid = feat.futures.mid;
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_ob_signal_replay.mjs`
Expected: PASS — `3 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/marketdata/orderbook/replaySignals.js tests/test_ob_signal_replay.mjs
git commit -m "feat(ob-gate): replaySignals — pure snapshot→signal replay core

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `framesToSnapshots` — rebuild dual-book snapshots from recorded frames

**Files:**
- Modify: `src/marketdata/orderbook/replaySignals.js` (add `framesToSnapshots` export)
- Test: `tests/test_ob_signal_replay.mjs` (extend)

Pure: takes parsed, time-ordered SP1 frames for BOTH venues, re-drives two `LocalOrderBook`s and a
rolling futures tape, and emits a dual-book feature snapshot (via SP1 `buildSnapshot`) at each
**futures** book event (futures is primary). Spot snapshots/diffs update the spot book but do not emit;
trade frames feed the tape only.

- [ ] **Step 1: Write the failing test (append to tests/test_ob_signal_replay.mjs, before the final console.log)**

```js
// --- framesToSnapshots ---
import { framesToSnapshots } from '../src/marketdata/orderbook/replaySignals.js';

const frames = [
  { t: 1, sym: 'X', v: 'fut',  k: 'snapshot', lastUpdateId: 10, bids: [['100', '5']], asks: [['101', '5']] },
  { t: 2, sym: 'X', v: 'spot', k: 'snapshot', lastUpdateId: 20, bids: [['100', '9']], asks: [['101', '9']] },
  { t: 3, sym: 'X', v: 'fut',  k: 'trade', p: 100.5, q: 10, m: false },
  { t: 4, sym: 'X', v: 'fut',  k: 'depth', U: 11, u: 12, pu: 10, b: [['100', '6']], a: [['101', '4']] },
];
const snaps = framesToSnapshots(frames, { symbol: 'X' });
assert.strictEqual(snaps.length, 2); ok('snapshot emitted only on futures book events');
assert.strictEqual(snaps[1].ready, true); ok('futures ready after depth applied');
assert.strictEqual(snaps[1].spotReady, true); ok('spot confirmed after its snapshot');
assert.strictEqual(snaps[1].futures.lastPrice, 100.5); ok('futures tape merged into snapshot');
```

(Update the final line's expected count: `6 checks passed`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_ob_signal_replay.mjs`
Expected: FAIL — `framesToSnapshots is not a function` (export missing).

- [ ] **Step 3: Add the implementation to `src/marketdata/orderbook/replaySignals.js`**

Add these imports at the top of the file (alongside the existing imports):

```js
import { LocalOrderBook, VENUE } from './LocalOrderBook.js';
import { buildSnapshot } from './snapshot.js';
```

Append this export to the file:

```js
/**
 * Re-drive both venue books from parsed, time-ordered frames and emit a dual-book feature
 * snapshot at each FUTURES book event (futures is primary). Spot events update the spot book
 * but do not emit; futures trade frames feed the rolling tape only. Pure: callers parse the JSONL.
 * @param {object[]} frames parsed lines {t, sym, v, k, ...} for BOTH venues, time-ordered
 * @param {{symbol:string, depthLimit?:number, bookOpts?:object, tapeOpts?:object, tapeWindowMs?:number}} cfg
 * @returns {object[]} SP1 feature snapshots
 */
export function framesToSnapshots(frames, { symbol, depthLimit = 20, bookOpts = {}, tapeOpts = {}, tapeWindowMs = 5000 } = {}) {
  const fut = new LocalOrderBook({ venue: VENUE.FUT, depthLimit });
  const spot = new LocalOrderBook({ venue: VENUE.SPOT, depthLimit });
  let trades = [];
  const out = [];

  for (const ev of frames) {
    const book = ev.v === VENUE.SPOT ? spot : fut;
    if (ev.k === 'snapshot') {
      book.applySnapshot({ lastUpdateId: ev.lastUpdateId, bids: ev.bids, asks: ev.asks });
    } else if (ev.k === 'depth') {
      book.applyDiff({ U: ev.U, u: ev.u, pu: ev.pu, b: ev.b || [], a: ev.a || [] });
    } else if (ev.k === 'trade' && ev.v === VENUE.FUT) {
      trades.push({ t: ev.t, p: ev.p, q: ev.q, m: ev.m });
      trades = trades.filter((tr) => ev.t - tr.t <= tapeWindowMs);
      continue; // trade frames feed the tape, never emit
    } else {
      continue; // state frames, spot trades, etc.
    }
    if (ev.v !== VENUE.FUT) continue; // emit only on a futures book event

    out.push(buildSnapshot({
      symbol, ts: ev.t, now: ev.t,
      futBook: fut.snapshotBook(),
      futTrades: trades,
      spotBook: spot.snapshotBook(),
      opts: { book: bookOpts, tape: tapeOpts },
    }));
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_ob_signal_replay.mjs`
Expected: PASS — `6 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/marketdata/orderbook/replaySignals.js tests/test_ob_signal_replay.mjs
git commit -m "feat(ob-gate): framesToSnapshots — rebuild dual-book snapshots from recorded frames

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: `replay-ob-signal` CLI — offline feedback harness (thin IO)

**Files:**
- Create: `scripts/replay-ob-signal.mjs`

Thin IO adapter: reads recorded SP1 JSONL (one file per venue), merges by time, rebuilds snapshots via
`framesToSnapshots`, computes signals via `replaySignals`, and prints them. All logic lives in the pure
units; this file only does argv + file IO + printing. No unit test (IO glue); verified by smoke run.

- [ ] **Step 1: Write the CLI**

```js
// scripts/replay-ob-signal.mjs
// Offline replay: recorded SP1 JSONL + candles → breakout signals (no live wiring, no orders).
// Usage: node scripts/replay-ob-signal.mjs --fut <fut.jsonl> --candles <ohlc.json> [--spot <spot.jsonl>] [--symbol SYM]
import fs from 'node:fs';
import { framesToSnapshots, replaySignals } from '../src/marketdata/orderbook/replaySignals.js';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const futFile = arg('fut');
const spotFile = arg('spot');           // optional
const candlesFile = arg('candles');
const symbol = arg('symbol', 'UNKNOWN');

if (!futFile || !candlesFile) {
  console.error('usage: node scripts/replay-ob-signal.mjs --fut <fut.jsonl> --candles <ohlc.json> [--spot <spot.jsonl>] [--symbol SYM]');
  process.exit(1);
}

const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

let frames = readJsonl(futFile);
if (spotFile) frames = frames.concat(readJsonl(spotFile));
frames.sort((a, b) => a.t - b.t);

const candles = JSON.parse(fs.readFileSync(candlesFile, 'utf8'));
const snapshots = framesToSnapshots(frames, { symbol });
const signals = replaySignals(snapshots, candles);

console.log(`symbol=${symbol} frames=${frames.length} snapshots=${snapshots.length} signals=${signals.length}`);
for (const s of signals) {
  console.log(`${new Date(s.ts).toISOString()} ${s.side} conv=${s.conviction.toFixed(2)} :: ${s.rationale}`);
}
```

- [ ] **Step 2: Smoke-run against recorded data**

First record a short window (if no data exists yet):
Run: `node scripts/record-orderbook.mjs --symbols BTCUSDT --minutes 2`

Then replay (candles file = any OHLC JSON array `[{time,open,high,low,close,volume},...]`; reuse a scout downloader or a hand-made file):
Run:
```bash
node scripts/replay-ob-signal.mjs \
  --fut data/orderbook/BTCUSDT/fut/<DAY>.jsonl \
  --spot data/orderbook/BTCUSDT/spot/<DAY>.jsonl \
  --candles <ohlc.json> --symbol BTCUSDT
```
Expected: a summary line `symbol=BTCUSDT frames=… snapshots=… signals=…` and zero or more signal lines.
Success = it runs without error and `snapshots` > 0 (signals may legitimately be 0 if no breakout crossed during the window).

- [ ] **Step 3: Commit**

```bash
git add scripts/replay-ob-signal.mjs
git commit -m "feat(ob-gate): replay-ob-signal CLI — offline breakout-signal feedback harness

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] **Run the full SP2a + SP1 order-book suite (regression-clean):**

```bash
node tests/test_ob_levels.mjs && \
node tests/test_breakout_signal.mjs && \
node tests/test_ob_gate.mjs && \
node tests/test_ob_signal_replay.mjs && \
node tests/test_local_orderbook.mjs && \
node tests/test_ob_features.mjs && \
node tests/test_tape_features.mjs && \
node tests/test_ob_snapshot.mjs && \
node tests/test_ob_recorder.mjs && \
node tests/test_ob_replay.mjs
```
Expected: every file prints `N checks passed`, no assertion failures.

- [ ] **Update graph:** `graphify update .`

- [ ] **Finish:** invoke `superpowers:finishing-a-development-branch`.
