# RangeFilter Strategy (VMC Swing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the TradingView "Range Filter — B&S Signals" (saved as `strategy/VMC Swing.txt`) into a first-class `RangeFilter` logic type with a signal-driven exit mode (stop-and-reverse), usable by both AI agents and manual bots.

**Architecture:** A pure indicator class (`rangeFilter.js`) following the `donchianTrend.js` pattern, dispatched by `IndicatorManager`, mapped to a `Signal` by `SignalAdapter`. A new `exit_mode: "signal"` (in the logic template) makes the engine close on the opposite filter flip and re-enter by persistent state, with the existing `stop_loss` acting as a uniform protective floor. Task 0 first repairs a pre-existing async regression so the backtest pipeline works.

**Tech Stack:** Node.js ESM, `node:assert` test files run via `node tests/<file>.mjs`, SQLite, existing IndicatorManager / SignalAdapter / SafetyValidator / bot_engine.

**Spec:** [docs/specs/2026-06-16-range-filter-strategy-design.md](../specs/2026-06-16-range-filter-strategy-design.md)

---

## File Structure

**Create:**
- `src/indicators/rangeFilter.js` — pure Range Filter indicator (EMA range size, stepwise filter, direction, CondIni state, fresh flip).
- `src/manual/resolveSignalExit.js` — two pure helpers: `resolveSignalExit` (close on opposite state) and `signalStateSide` (entry side from persistent state).
- `templates/logic/range_filter.json`, `templates/risk/range_filter.json`.
- `tests/test_range_filter.mjs`, `tests/test_range_filter_signal.mjs`, `tests/test_resolve_signal_exit.mjs`, `tests/test_rf_trend_align.mjs`.

**Modify:**
- `src/indicators/index.js` — Task 0 (sync revert + HTF hoist) and `case 'RANGEFILTER'`.
- `bot_engine.js` — Task 0 (fetch HTF candles, pass in) and Task 7 (signal exit + state re-entry).
- `src/core/pipeline.js` — Task 0 (pass `ctx.htfCandles` through, stays sync).
- `src/core/SignalAdapter.js` — `fromRangeFilter` + dispatch case.
- `src/manual/legacyManualSide.js` — `RangeFilter` branch.
- `src/agents/deriveAgentProposal.js` — add `'RANGEFILTER'` to `CORE_LOGIC_TYPES` + comment.
- `src/validators/safety-rules.js`, `src/validators/index.js` — `rf_trend_align` rule.

---

## Task 0: Repair the async `calculate()` regression (revert to sync, hoist HTF fetch)

**Why:** Commit `44665fc` made `IndicatorManager.calculate` `async` and put a network fetch inside it. Every synchronous caller now receives a Promise: `src/core/pipeline.js:16` (backtest engine — must stay pure/sync), `src/agents/deriveAgentProposal.js:44`, `src/registry/ToolRegistry.js:67`, and tests. Fix: make `calculate` sync again and move the HTF candle fetch to the caller.

**Files:**
- Modify: `src/indicators/index.js`
- Modify: `bot_engine.js:~419-420`
- Modify: `src/core/pipeline.js:14-17`
- Test: existing `tests/test_donchian_signal.mjs`, `tests/test_derive_agent_proposal.js`, `tests/test_trend_pullback_signal.mjs`, `tests/test_htf_gate.mjs`

- [ ] **Step 1: Confirm the regression (tests currently broken)**

Run: `node tests/test_donchian_signal.mjs`
Expected: FAIL / assertion error — `raw.side` is `undefined` because `calculate` returns a Promise (the third assertion "IndicatorManager dispatches DonchianTrend" throws).

- [ ] **Step 2: Make `calculate` synchronous and accept pre-fetched HTF candles**

Edit `src/indicators/index.js`. Remove the `marketDataService` import. Replace the async method with a sync one that takes optional `htfCandles`:

```js
import SMC from './smc.js';
import Breakout from './breakout.js';
import WaveTrend from './wave-trend.js';
import Reversal from './reversal.js';
import TrendPullback from './trendPullback.js';
import DonchianTrend from './donchianTrend.js';
import ScalpBreakout from './scalpBreakout.js';

export class IndicatorManager {
  constructor(config) {
    this.config = config;
  }

  /**
   * Calculate indicators for the given logic type. Pure & synchronous: any I/O
   * (e.g. fetching higher-timeframe candles) is the caller's responsibility and
   * passed in via opts.htfCandles.
   * @param {string} type
   * @param {Array} candles
   * @param {{ htfCandles?: Array }} [opts]
   * @returns {Object}
   */
  calculate(type, candles, opts = {}) {
    if (!type) return {};
    const normalizedType = type.toUpperCase();

    let results = {};
    switch (normalizedType) {
      case 'SMC': results = SMC.execute(candles, this.config); break;
      case 'BREAKOUT': results = { channel: Breakout.execute(candles, this.config) }; break;
      case 'VMC_CIPHERB': results = WaveTrend.execute(candles, this.config); break;
      case 'REVERSAL': results = Reversal.execute(candles, this.config); break;
      case 'TRENDPULLBACK': results = TrendPullback.execute(candles, this.config); break;
      case 'DONCHIANTREND': results = DonchianTrend.execute(candles, this.config); break;
      case 'SCALPBREAKOUT': results = ScalpBreakout.execute(candles, this.config); break;
      default: throw new Error(`Unsupported indicator type: ${type}`);
    }

    // HTF bias: caller passes higher-timeframe candles; we derive the trend here
    // synchronously (SMC structural trend). No I/O in this method.
    if (Array.isArray(opts.htfCandles) && opts.htfCandles.length > 0) {
      if (normalizedType === 'SMC') {
        const htfSMC = SMC.execute(opts.htfCandles, this.config);
        results.htf_trend = htfSMC.structure.trend;
      } else {
        results.htf_trend = null;
      }
    }

    return results;
  }
}
```

- [ ] **Step 3: Hoist the HTF fetch into `bot_engine.js`**

In `bot_engine.js`, find the calculate call (~line 419-420):

```js
                if (logicType) {
                  strategyData = await indicatorManager.calculate(logicType, candles, symbol, strategyConfig);
```

Replace with a caller-side fetch that passes the candles in:

```js
                if (logicType) {
                  const htfTf = strategyConfig.htf_timeframe || strategyConfig.htfTimeframe;
                  let htfCandles = null;
                  if (htfTf) {
                    try {
                      htfCandles = await marketDataService.fetchCandles(symbol, htfTf, 500);
                    } catch (error) {
                      console.error(`[Engine] HTF fetch failed for ${symbol} (${htfTf}): ${error.message}`);
                    }
                  }
                  strategyData = await indicatorManager.calculate(logicType, candles, { htfCandles });
```

(`marketDataService` is already imported in `bot_engine.js`. `await` on the now-sync `calculate` is harmless and can be left or dropped; leave it to minimize the diff.)

- [ ] **Step 4: Pass HTF candles through the pure pipeline**

In `src/core/pipeline.js` line 16, forward an optional `ctx.htfCandles` (undefined in backtest → no HTF, which the `htf_trend_filter` rule treats as N/A):

```js
  const raw = new IndicatorManager(ctx.config.logic || {}).calculate(
    ctx.config.logicType,
    ctx.candles,
    { htfCandles: ctx.htfCandles },
  );
```

`evaluateBar` stays synchronous — no signature change.

- [ ] **Step 5: Run the previously-broken tests**

Run: `node tests/test_donchian_signal.mjs && node tests/test_derive_agent_proposal.js && node tests/test_trend_pullback_signal.mjs`
Expected: all PASS (`N passed`). `deriveAgentProposal.js` and `ToolRegistry.js` need no edits — they call `calculate` synchronously and now work again.

- [ ] **Step 6: Run the HTF-related tests to confirm no behavioral regression**

Run: `node tests/test_htf_gate.mjs`
Expected: PASS. (If this test stubbed the old async fetch inside `calculate`, update it to pass `htfCandles` via `calculate(type, candles, { htfCandles })` or via `ctx.htfCandles`; keep the same assertions.)

- [ ] **Step 7: Commit**

```bash
git add src/indicators/index.js bot_engine.js src/core/pipeline.js tests/test_htf_gate.mjs
git commit -m "fix(indicators): revert calculate() to sync, hoist HTF fetch to caller

The HTF feature made IndicatorManager.calculate async with an inline network
fetch, breaking every synchronous caller (backtest pipeline, deriveAgentProposal,
ToolRegistry, signal tests) which received a Promise. calculate() is now pure and
synchronous again; the caller fetches HTF candles and passes them via opts.htfCandles.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 1: RangeFilter indicator

**Files:**
- Create: `src/indicators/rangeFilter.js`
- Test: `tests/test_range_filter.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/test_range_filter.mjs`:

```js
// tests/test_range_filter.mjs
import assert from 'node:assert';
import RangeFilter from '../src/indicators/rangeFilter.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };
const bar = (c) => ({ time: 0, open: c, high: c + 0.5, low: c - 0.5, close: c, volume: 1 });

// --- insufficient candles → HOLD / neutral state ---
{
  const r = RangeFilter.execute([bar(100)], { indicators: { period: 20, multiplier: 3.5 } });
  assert.strictEqual(r.side, 'HOLD', 'insufficient candles → HOLD');
  assert.strictEqual(r.state, 0, 'insufficient candles → neutral state');
  ok('insufficient candles → HOLD/neutral');
}

// --- sustained uptrend → filter rises, state long ---
{
  const candles = [];
  for (let i = 0; i < 60; i++) candles.push(bar(100));      // flat warmup
  for (let i = 1; i <= 40; i++) candles.push(bar(100 + i)); // strong rising leg
  const r = RangeFilter.execute(candles, { indicators: { period: 20, multiplier: 3.5 } });
  assert.strictEqual(r.dir, 1, 'rising filter → dir = 1');
  assert.strictEqual(r.state, 1, 'uptrend → long state');
  ok('uptrend → dir up, long state');
}

// --- uptrend then sharp reversal → flips to short state, fresh SELL flip ---
{
  const candles = [];
  for (let i = 0; i < 60; i++) candles.push(bar(100));
  for (let i = 1; i <= 40; i++) candles.push(bar(100 + i)); // up to 140
  for (let i = 1; i <= 40; i++) candles.push(bar(140 - i)); // back down to 100
  const r = RangeFilter.execute(candles, { indicators: { period: 20, multiplier: 3.5 } });
  assert.strictEqual(r.state, -1, 'after reversal → short state');
  assert.strictEqual(r.dir, -1, 'falling filter → dir = -1');
  ok('reversal → short state');
}

// --- params read from snake_case too (casing policy) ---
{
  const candles = [];
  for (let i = 0; i < 40; i++) candles.push(bar(100));
  const r = RangeFilter.execute(candles, { indicators: { period: 10, multiplier: 2.5, source: 'hl2' } });
  assert.ok(['BUY', 'SELL', 'HOLD'].includes(r.side), 'side is a valid enum value');
  ok('reads alt params/source without throwing');
}

console.log(`\n${passed} passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_range_filter.mjs`
Expected: FAIL — `Cannot find module '../src/indicators/rangeFilter.js'`.

- [ ] **Step 3: Implement the indicator**

Create `src/indicators/rangeFilter.js`:

```js
// src/indicators/rangeFilter.js
/**
 * Range Filter (DonovanWall) — Buy & Sell Signals. Pure port of strategy/VMC Swing.txt.
 * Deterministic; the signal is computed on the last CLOSED candle (no look-ahead).
 *
 * Output contract mirrors donchianTrend.js:
 *   side: 'BUY'|'SELL'|'HOLD'  — fresh-flip side (HOLD between flips)
 *   state: 1|-1|0              — persistent CondIni phase (long/short)
 *   dir: 1|-1|0               — filter direction (Pine fdir)
 *   freshFlip: boolean        — bar where state flips (= Pine BUY/SELL label)
 *   filter, hiBand, loBand, price
 */
const HOLD = { side: 'HOLD', state: 0, dir: 0, freshFlip: false, filter: null, hiBand: null, loBand: null, price: null };

// Pine-style EMA: seed with the first value, then recursive smoothing.
function ema(values, period) {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  const out = [values[0]];
  for (let i = 1; i < values.length; i++) out.push(values[i] * k + out[i - 1] * (1 - k));
  return out;
}

function resolveSource(c, source) {
  switch (source) {
    case 'open': return c.open;
    case 'high': return c.high;
    case 'low': return c.low;
    case 'hl2': return (c.high + c.low) / 2;
    case 'hlc3': return (c.high + c.low + c.close) / 3;
    case 'ohlc4': return (c.open + c.high + c.low + c.close) / 4;
    case 'close':
    default: return c.close;
  }
}

const RangeFilter = {
  execute(candles, config = {}) {
    const ind = config.indicators || {};
    const pick = (cam, sn, def) => {
      const v = [ind[cam], ind[sn]].find((x) => x !== undefined && x !== null);
      return v ?? def;
    };
    const period = pick('period', 'period', 20);
    const multiplier = pick('multiplier', 'multiplier', 3.5);
    const source = pick('source', 'source', 'close');

    if (!Array.isArray(candles) || candles.length < period + 2) return { ...HOLD };

    const src = candles.map((c) => resolveSource(c, source));

    // rng_size: AC = ema(ema(|x - x[1]|, n), 2n-1) * qty
    const absDiff = src.map((x, i) => (i === 0 ? 0 : Math.abs(x - src[i - 1])));
    const avrng = ema(absDiff, period);
    const smoothrng = ema(avrng, period * 2 - 1).map((v) => v * multiplier);

    // rng_filt: stepwise filter that only moves when price exits the ±r band.
    const filt = new Array(src.length);
    filt[0] = src[0];
    for (let i = 1; i < src.length; i++) {
      const r = smoothrng[i];
      const prev = filt[i - 1];
      let f = prev;
      if (src[i] - r > prev) f = src[i] - r;
      if (src[i] + r < prev) f = src[i] + r;
      filt[i] = f;
    }

    // fdir: filter direction, carried forward when flat.
    const fdir = new Array(src.length).fill(0);
    for (let i = 1; i < src.length; i++) {
      fdir[i] = filt[i] > filt[i - 1] ? 1 : filt[i] < filt[i - 1] ? -1 : fdir[i - 1];
    }

    // CondIni state + fresh flip (Pine longCondition/shortCondition).
    let condIni = 0;
    let prevCondIni = 0;
    let freshFlip = false;
    for (let i = 1; i < src.length; i++) {
      const upward = fdir[i] === 1;
      const downward = fdir[i] === -1;
      const longCond = src[i] > filt[i] && upward;
      const shortCond = src[i] < filt[i] && downward;
      prevCondIni = condIni;
      condIni = longCond ? 1 : shortCond ? -1 : condIni;
      if (i === src.length - 1) {
        const longCondition = longCond && prevCondIni === -1;
        const shortCondition = shortCond && prevCondIni === 1;
        freshFlip = longCondition || shortCondition;
      }
    }

    const last = src.length - 1;
    const r = smoothrng[last];
    const state = condIni;
    const side = freshFlip ? (state === 1 ? 'BUY' : state === -1 ? 'SELL' : 'HOLD') : 'HOLD';

    return {
      side,
      state,
      dir: fdir[last],
      freshFlip,
      filter: filt[last],
      hiBand: filt[last] + r,
      loBand: filt[last] - r,
      price: candles[last].close,
    };
  },
};

export default RangeFilter;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_range_filter.mjs`
Expected: PASS — `4 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/indicators/rangeFilter.js tests/test_range_filter.mjs
git commit -m "feat(indicators): add RangeFilter (VMC Swing) indicator

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Register RangeFilter in IndicatorManager

**Files:**
- Modify: `src/indicators/index.js`
- Test: `tests/test_range_filter_signal.mjs` (created in Task 3 covers dispatch; add a quick dispatch assert here)

- [ ] **Step 1: Add the import and switch case**

In `src/indicators/index.js`, add the import near the others:

```js
import RangeFilter from './rangeFilter.js';
```

Add the case in the switch (before `default`):

```js
      case 'RANGEFILTER': results = RangeFilter.execute(candles, this.config); break;
```

- [ ] **Step 2: Verify dispatch in a node one-liner**

Run:
```bash
node -e "import('./src/indicators/index.js').then(({IndicatorManager})=>{const c=[];for(let i=0;i<60;i++)c.push({time:0,open:100,high:100.5,low:99.5,close:100,volume:1});for(let i=1;i<=40;i++)c.push({time:0,open:100+i,high:100+i,low:100+i,close:100+i,volume:1});const r=new IndicatorManager({indicators:{period:20,multiplier:3.5}}).calculate('RangeFilter',c);console.log('state',r.state,'dir',r.dir);}) "
```
Expected: prints `state 1 dir 1` (uptrend).

- [ ] **Step 3: Commit**

```bash
git add src/indicators/index.js
git commit -m "feat(indicators): dispatch RANGEFILTER in IndicatorManager

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: SignalAdapter mapper for RangeFilter

**Files:**
- Modify: `src/core/SignalAdapter.js`
- Test: `tests/test_range_filter_signal.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/test_range_filter_signal.mjs`:

```js
// tests/test_range_filter_signal.mjs
import assert from 'node:assert';
import { deriveSignal } from '../src/core/SignalAdapter.js';
import { SIDE } from '../src/core/contracts.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

// --- BUY raw → BUY signal; fresh flip lifts conviction; invalidation = loBand ---
{
  const raw = { side: 'BUY', state: 1, freshFlip: true, loBand: 95, hiBand: 105 };
  const sig = deriveSignal('RangeFilter', raw, { price: 101, candles: [] });
  assert.strictEqual(sig.side, SIDE.BUY, 'BUY raw → BUY signal');
  assert.ok(sig.conviction > 0.6, 'fresh flip raises conviction above base');
  assert.strictEqual(sig.invalidation, 95, 'BUY invalidation = loBand');
  ok('fromRangeFilter maps BUY with fresh flip');
}

// --- HOLD raw → HOLD ---
{
  const sig = deriveSignal('RangeFilter', { side: 'HOLD', state: 0 }, { price: 100, candles: [] });
  assert.strictEqual(sig.side, SIDE.HOLD, 'HOLD raw → HOLD');
  ok('fromRangeFilter maps HOLD');
}

// --- SELL raw → SELL; invalidation = hiBand ---
{
  const raw = { side: 'SELL', state: -1, freshFlip: false, loBand: 95, hiBand: 105 };
  const sig = deriveSignal('RangeFilter', raw, { price: 99, candles: [] });
  assert.strictEqual(sig.side, SIDE.SELL, 'SELL raw → SELL signal');
  assert.strictEqual(sig.invalidation, 105, 'SELL invalidation = hiBand');
  ok('fromRangeFilter maps SELL');
}

console.log(`\n${passed} passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_range_filter_signal.mjs`
Expected: FAIL — `Unsupported logicType: RangeFilter` thrown by `deriveSignal`.

- [ ] **Step 3: Implement the mapper**

In `src/core/SignalAdapter.js`, add the mapper after `fromScalpBreakout`:

```js
/** RangeFilter: execute() resolved side from the fresh flip; conviction +0.1 on a fresh flip. */
function fromRangeFilter(raw) {
  const side = raw?.side ?? SIDE.HOLD;
  if (side === SIDE.HOLD) return hold('RangeFilter: no flip / neutral');
  const conviction = clamp(0.6 + (raw?.freshFlip ? 0.1 : 0), 0, 1);
  const invalidation = side === SIDE.BUY ? (raw?.loBand ?? null) : (raw?.hiBand ?? null);
  return { side, conviction, reason: `RangeFilter ${side}`, invalidation };
}
```

Add the dispatch case in `deriveSignal` (before `default`):

```js
    case 'RANGEFILTER': return fromRangeFilter(raw);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_range_filter_signal.mjs`
Expected: PASS — `3 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/core/SignalAdapter.js tests/test_range_filter_signal.mjs
git commit -m "feat(signal): map RangeFilter raw output to Signal

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: legacy manual side branch + AI core-type registration

**Files:**
- Modify: `src/manual/legacyManualSide.js`
- Modify: `src/agents/deriveAgentProposal.js`
- Test: `tests/test_legacy_manual_side.js`

- [ ] **Step 1: Add a failing assertion to the legacy manual side test**

In `tests/test_legacy_manual_side.js`, add a case (match the file's existing assertion style):

```js
// RangeFilter: side comes straight from strategyData.side
{
  assert.strictEqual(legacyManualSide('RangeFilter', { side: 'SELL' }, 100), 'SELL', 'RangeFilter passes through SELL');
  assert.strictEqual(legacyManualSide('RangeFilter', { side: 'HOLD' }, 100), 'BUY', 'RangeFilter HOLD → legacy default BUY');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_legacy_manual_side.js`
Expected: FAIL — RangeFilter falls through to the default `BUY`, so the `'SELL'` assertion fails.

- [ ] **Step 3: Implement the branch**

In `src/manual/legacyManualSide.js`, add before `return side;`:

```js
  } else if (logicType === 'RangeFilter') {
    side = strategyData.side === 'SELL' ? 'SELL' : 'BUY';
```

(Append as an `else if` to the existing chain so the `SMC`/`Breakout` branches are unaffected.)

- [ ] **Step 4: Register RangeFilter for AI agents**

In `src/agents/deriveAgentProposal.js`, update the set and its comment:

```js
// The logic types the shared core supports.
// KEEP IN SYNC with the switch in src/indicators/index.js (IndicatorManager.calculate)
// and src/core/SignalAdapter.js (deriveSignal).
const CORE_LOGIC_TYPES = new Set(['SMC', 'BREAKOUT', 'VMC_CIPHERB', 'REVERSAL', 'RANGEFILTER']);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node tests/test_legacy_manual_side.js && node tests/test_derive_agent_proposal.js`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add src/manual/legacyManualSide.js src/agents/deriveAgentProposal.js tests/test_legacy_manual_side.js
git commit -m "feat(routing): wire RangeFilter into legacy manual side + AI core types

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `rf_trend_align` safety rule

**Files:**
- Modify: `src/validators/safety-rules.js`
- Modify: `src/validators/index.js`
- Test: `tests/test_rf_trend_align.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/test_rf_trend_align.mjs`:

```js
// tests/test_rf_trend_align.mjs
import assert from 'node:assert';
import { rf_trend_align } from '../src/validators/safety-rules.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

// --- dir up + BUY state → pass ---
{
  const res = rf_trend_align(101, 100, { dir: 1, state: 1 }, {});
  assert.strictEqual(res.pass, true, 'dir up & long state → pass');
  ok('rf_trend_align passes when aligned (long)');
}

// --- dir up but short state → fail ---
{
  const res = rf_trend_align(99, 100, { dir: 1, state: -1 }, {});
  assert.strictEqual(res.pass, false, 'dir up but short state → fail');
  ok('rf_trend_align fails on mismatch');
}

console.log(`\n${passed} passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_rf_trend_align.mjs`
Expected: FAIL — `rf_trend_align is not a function` (not yet exported).

- [ ] **Step 3: Implement the rule**

In `src/validators/safety-rules.js`, add (top-level export, matching the style of `htf_trend_filter`):

```js
export const rf_trend_align = (price, open, data, config) => {
  const dir = data.dir ?? 0;
  const state = data.state ?? 0;
  const aligned = dir !== 0 && dir === state;
  return {
    label: "RF Trend Align",
    required: "Filter direction matches trade side",
    actual: dir === 1 ? "Filter up" : dir === -1 ? "Filter down" : "Filter flat",
    pass: aligned,
    score: aligned ? 1.0 : 0.0,
  };
};
```

- [ ] **Step 4: Wire the rule into the validator**

In `src/validators/index.js`, add a weight (near `htfTrendFilter`):

```js
      rfTrendAlign: 2.0,
```

Extend the rule-id resolution chain to map `rf_trend_align` (it already special-cases ids; add this one):

```js
      const ruleId = check.id === "momentum_shift" ? "momentum_shift"
        : check.id === "htf_trend_filter" ? "htf_trend_filter"
        : check.id === "confirmation_choch" ? "confirmation_choch"
        : check.id === "rf_trend_align" ? "rf_trend_align"
        : check.id;
```

(If `rules` is an imported namespace of `safety-rules.js`, `rules.rf_trend_align` resolves automatically once exported — confirm by reading the top of `src/validators/index.js` and matching its lookup style.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `node tests/test_rf_trend_align.mjs`
Expected: PASS — `2 passed`.

- [ ] **Step 6: Commit**

```bash
git add src/validators/safety-rules.js src/validators/index.js tests/test_rf_trend_align.mjs
git commit -m "feat(validators): add rf_trend_align safety rule

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Signal-exit helpers (pure)

**Files:**
- Create: `src/manual/resolveSignalExit.js`
- Test: `tests/test_resolve_signal_exit.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/test_resolve_signal_exit.mjs`:

```js
// tests/test_resolve_signal_exit.mjs
import assert from 'node:assert';
import { resolveSignalExit, signalStateSide } from '../src/manual/resolveSignalExit.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

// --- not signal mode → never exits by signal ---
{
  const r = resolveSignalExit({ exitMode: 'sl_tp', positionSide: 'BUY', strategyData: { state: -1 } });
  assert.strictEqual(r.exit, false, 'sl_tp mode → no signal exit');
  ok('resolveSignalExit: sl_tp mode never exits');
}

// --- signal mode, opposite state → exit ---
{
  const r = resolveSignalExit({ exitMode: 'signal', positionSide: 'BUY', strategyData: { state: -1 } });
  assert.strictEqual(r.exit, true, 'long position + short state → exit');
  ok('resolveSignalExit: opposite state exits');
}

// --- signal mode, aligned state → hold ---
{
  const r = resolveSignalExit({ exitMode: 'signal', positionSide: 'BUY', strategyData: { state: 1 } });
  assert.strictEqual(r.exit, false, 'long position + long state → hold');
  ok('resolveSignalExit: aligned state holds');
}

// --- signalStateSide maps persistent state to a side ---
{
  assert.strictEqual(signalStateSide({ state: 1 }), 'BUY', 'state 1 → BUY');
  assert.strictEqual(signalStateSide({ state: -1 }), 'SELL', 'state -1 → SELL');
  assert.strictEqual(signalStateSide({ state: 0 }), 'HOLD', 'state 0 → HOLD');
  ok('signalStateSide maps state → side');
}

console.log(`\n${passed} passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_resolve_signal_exit.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helpers**

Create `src/manual/resolveSignalExit.js`:

```js
// src/manual/resolveSignalExit.js
/**
 * Pure helpers for the signal-driven exit mode (stop-and-reverse).
 * The engine wires these in; they do no I/O.
 */

/** Persistent-state side: long state → BUY, short state → SELL, neutral → HOLD. */
export function signalStateSide(strategyData = {}) {
  const state = strategyData.state ?? 0;
  return state === 1 ? 'BUY' : state === -1 ? 'SELL' : 'HOLD';
}

/**
 * Decide whether an open position should close because the indicator state flipped.
 * @param {{ exitMode: string, positionSide: 'BUY'|'SELL', strategyData: object }} args
 * @returns {{ exit: boolean, reason: string }}
 */
export function resolveSignalExit({ exitMode, positionSide, strategyData = {} }) {
  if (exitMode !== 'signal') return { exit: false, reason: 'not signal mode' };
  const desired = signalStateSide(strategyData);
  if (desired !== 'HOLD' && desired !== positionSide) {
    return { exit: true, reason: `signal flip to ${desired}` };
  }
  return { exit: false, reason: 'state aligned' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_resolve_signal_exit.mjs`
Expected: PASS — `4 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/manual/resolveSignalExit.js tests/test_resolve_signal_exit.mjs
git commit -m "feat(manual): add pure signal-exit + state-side helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Wire signal-exit + state re-entry into bot_engine

**Files:**
- Modify: `bot_engine.js` (active-position branch ~288-400; entry side ~453-468)

**Context:** The active-position branch currently only checks SL/TP and never recomputes the indicator. We add: (a) in `exit_mode: "signal"`, recompute the indicator and close on an opposite state flip (protective `stop_loss` still honored); (b) when flat in signal mode, derive the entry side from persistent state so the next cycle re-enters the opposite side.

- [ ] **Step 1: Import the helpers**

At the top of `bot_engine.js`, add:

```js
import { resolveSignalExit, signalStateSide } from "./src/manual/resolveSignalExit.js";
```

- [ ] **Step 2: Compute indicator state inside the active-position branch (signal mode only)**

In the active-position branch, just after `let exitTriggered = false; let exitType = ""; let exitPrice = price;` (~line 297), add a signal-exit check. It reuses the same `logicType` resolution used in the flat branch:

```js
              const exitMode = strategyConfig.logic?.exit_mode || strategyConfig.exit_mode || "sl_tp";
              if (exitMode === "signal") {
                const logicType = strategyConfig.logic?.type || null;
                if (logicType) {
                  const sigData = await indicatorManager.calculate(logicType, candles, {});
                  const sigExit = resolveSignalExit({
                    exitMode,
                    positionSide: activePosition.side,
                    strategyData: sigData,
                  });
                  if (sigExit.exit) {
                    exitTriggered = true;
                    exitType = "Signal Flip";
                  }
                }
              }
```

(The existing SL block runs after this; in signal mode `take_profit` will be `null` so the TP branch never fires, while the protective `stop_loss` branch still does — giving the uniform protective floor.)

- [ ] **Step 3: Use persistent state for entry side in signal mode**

In the flat branch, after `side = entry.side;` (~line 468), override for signal mode so re-entry follows the persistent state rather than requiring a fresh flip:

```js
                const exitMode = strategyConfig.logic?.exit_mode || strategyConfig.exit_mode || "sl_tp";
                if (exitMode === "signal") {
                  const stateSide = signalStateSide(strategyData);
                  if (stateSide === "HOLD") {
                    const skipMsg = `⏭️  No entry for ${symbol}: RangeFilter state neutral`;
                    console.log(skipMsg);
                    await logEventSimple(strategyId, "CHECK", skipMsg);
                    continue;
                  }
                  side = stateSide;
                }
```

- [ ] **Step 4: Manual smoke run (paper trading)**

Run: `node tests/test_bot_engine_sl.mjs`
Expected: PASS — confirms the SL/TP exit path (sl_tp mode) is unchanged by the added branch.

- [ ] **Step 5: Commit**

```bash
git add bot_engine.js
git commit -m "feat(engine): signal-driven exit + state re-entry for exit_mode=signal

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Logic + risk templates

**Files:**
- Create: `templates/logic/range_filter.json`
- Create: `templates/risk/range_filter.json`

- [ ] **Step 1: Create the logic template**

Create `templates/logic/range_filter.json`:

```json
{
  "name": "Range Filter (VMC Swing)",
  "type": "RangeFilter",
  "exit_mode": "signal",
  "indicators": {
    "source": "close",
    "period": 20,
    "multiplier": 3.5
  },
  "safety_checks": [
    { "id": "rf_trend_align", "description": "Filter direction must match the trade side" }
  ]
}
```

- [ ] **Step 2: Create the risk template**

First read an existing risk template's exact shape:

Run: `node -e "console.log(require('fs').readFileSync('templates/risk/conservative.json','utf8'))"`
Expected: prints the JSON; mirror its keys.

Create `templates/risk/range_filter.json` (match the key set of `conservative.json`; the values below encode a wide protective stop with no fixed TP):

```json
{
  "name": "Range Filter Risk",
  "risk_per_trade_percent": 1,
  "stop_loss_percent": 8,
  "take_profit_percent": null,
  "max_open_positions": 3,
  "max_trades_per_day": 20,
  "min_risk_reward_ratio": 0
}
```

- [ ] **Step 3: Verify templates load via the resolver**

Run: `node tests/test_resolver.js`
Expected: PASS (the resolver test suite still passes with the new template files present).

- [ ] **Step 4: Verify templates appear in the API list**

Run: `node -e "import('fs').then(fs=>{const l=fs.readdirSync('templates/logic');const r=fs.readdirSync('templates/risk');console.log('logic has range_filter:', l.includes('range_filter.json'));console.log('risk has range_filter:', r.includes('range_filter.json'));})"`
Expected: both `true`. (The frontend dropdowns read these directories via the server template endpoint — no frontend change needed.)

- [ ] **Step 5: Commit**

```bash
git add templates/logic/range_filter.json templates/risk/range_filter.json
git commit -m "feat(templates): add Range Filter logic + risk templates

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Backtest validation (required)

**Files:** none (uses `backtest/run-backtest.js`; read `backtest/README.md` first).

- [ ] **Step 1: Read the runbook**

Read `backtest/README.md` for flags, the sizing/leverage caveat, and the HTF gate before running.

- [ ] **Step 2: Run the signal-exit backtest on a trending market**

Run (adjust symbol/tf/equity per the runbook; `--logic RangeFilter` selects the new type):
```bash
node backtest/run-backtest.js --symbol BTCUSDT --tf 4H --logic RangeFilter --equity 200 --riskPerTrade 0.10 --sl 0.08
```
Expected: completes; prints PnL / maxDD / trades. Capture the numbers.

- [ ] **Step 3: Run a fixed-TP control for comparison**

Run the same cell with a fixed TP to represent the sl_tp baseline (R:R ~1:2):
```bash
node backtest/run-backtest.js --symbol BTCUSDT --tf 4H --logic RangeFilter --equity 200 --riskPerTrade 0.10 --sl 0.03 --tp 0.06
```
Expected: completes; capture PnL / maxDD / trades.

> Note: if `run-backtest.js` does not yet route `exit_mode` from the logic template into the pure pipeline, the signal-exit may not engage in backtest. If so, confirm whether the backtest engine reads `exit_mode`; if it does not, record this as a follow-up (signal-exit wiring in the backtest shell) rather than forcing it here — the live engine path (Task 7) is the primary target. Report the finding either way.

- [ ] **Step 4: Record results in the research log**

Create `docs/research/2026-06-16-range-filter.md` summarizing: parameters used, signal-exit vs fixed-TP PnL/maxDD/trade-count, and whether the "no profit cap on trends" hypothesis held.

- [ ] **Step 5: Commit**

```bash
git add docs/research/2026-06-16-range-filter.md
git commit -m "docs(research): RangeFilter signal-exit vs fixed-TP backtest results

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review notes

- **Spec coverage:** §2 indicator → Task 1; §3 integration (5 points) → Tasks 2-5; §4 signal exit/re-entry → Tasks 6-7; §5 uniform protective stop → Task 7 (TP null + SL honored) + Task 8 risk template; §6 templates → Task 8; §7 AI/manual wiring → Tasks 4 + 8; §8 async fix → Task 0; §9 testing/backtests → per-task tests + Task 9.
- **Open assumption to verify during implementation:** the exact rule-lookup mechanism in `src/validators/index.js` (Task 5 Step 4) and the exact key set of risk templates (Task 8 Step 2) — both call for reading the existing file first and matching its shape.
- **Backtest caveat:** the pure pipeline does not currently read `exit_mode` (Task 0 only forwards `htfCandles`). Task 9 Step 3 surfaces this explicitly; live-engine signal exit (Task 7) is the primary deliverable.
