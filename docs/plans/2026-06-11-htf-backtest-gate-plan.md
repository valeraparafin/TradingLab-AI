# HTF Backtest Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in `--htf` flag to `backtest/run-backtest.js` that denies backtest entries taken against the higher-timeframe emaBand trend, leaving live trading and strategy configs untouched.

**Architecture:** A pure decorator `withHtfGate(decide, opts)` wraps the decision function the simulator already accepts as a parameter (`simulate(p, decide)`). The wrapper runs the inner `decide` (`evaluateBar`), and when it returns a PERMIT whose order side runs against the HTF emaBand verdict, flips it to DENY. The backtest CLI builds the wrapped `decide` only when `--htf` is present. Live (`bot_engine.js`) calls `evaluateBar` directly, never through `simulate`, so it is unaffected by construction.

**Tech Stack:** Node ESM, existing `aggregateHTF`/`classifyHTFTrend` building blocks, standalone `node tests/*.mjs` harness with a manual `ok()` counter.

**Spec:** `docs/specs/2026-06-11-htf-backtest-gate-design.md` (local, gitignored).

> **Doc handling:** The spec and this plan live under `docs/` but are gitignored per the user's instruction. Every `git add` below stages ONLY source and test files — never `docs/`.

---

## File Structure

- **Create** `src/backtest/htfGate.js` — exports `bucketOf(side, verdict)` and `withHtfGate(decide, opts)`. Sole responsibility: the gate decorator. Depends on `src/core/aggregateHTF.js`, `src/core/classifyHTFTrend.js`.
- **Create** `tests/test_htf_gate.mjs` — unit tests for the decorator and `bucketOf`.
- **Modify** `backtest/run-backtest.js` (`main()` only, around lines 143–152) — read `--htf*` flags, build the wrapped `decide`, pass it into `runOne`. No signature changes; `runOne` already forwards `p.decide` to `simulate`.

---

## Task 1: HTF gate decorator

**Files:**
- Create: `src/backtest/htfGate.js`
- Test: `tests/test_htf_gate.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/test_htf_gate.mjs`:

```js
// tests/test_htf_gate.mjs
import assert from 'node:assert';
import { withHtfGate, bucketOf } from '../src/backtest/htfGate.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

const HOUR = 3600000;
const mk = (t, c) => ({ time: t, open: c, high: c + 1, low: c - 1, close: c, volume: 1 });
// ratio:1 → each LTF candle is its own HTF bucket; the final (forming) bucket is dropped.
const series = (n, fn) => Array.from({ length: n }, (_, i) => mk(i * HOUR, fn(i)));
const falling = series(40, (i) => 100 - i); // emaBand DOWN
const rising  = series(40, (i) => 60 + i);  // emaBand UP
const flat    = series(40, () => 100);      // emaBand NEUTRAL
const thin    = series(5, (i) => 100 - i);  // < emaPeriod HTF bars → NEUTRAL

const opts = { ratio: 1, emaPeriod: 10, band: 0.005 };
const ctx = (candles) => ({ candles, config: { logicType: 'SMC', logic: {} }, symbol: 'BTCUSDT', timeframe: '1H' });

// Fixed result objects so passthrough can be asserted by reference identity.
const permit = (side) => {
  const r = { signal: { side }, decision: { decision: 'PERMIT', order: { side, sizeUSD: 100, entryPrice: 50, slPrice: 49, tpPrice: 52 } } };
  return () => r;
};
const denyInner = () => {
  const r = { signal: {}, decision: { decision: 'DENY', reason: 'inner' } };
  return () => r;
};

// --- against → DENY (BUY while HTF is DOWN) ---
{
  const out = withHtfGate(permit('BUY'), opts)(ctx(falling), {});
  assert.strictEqual(out.decision.decision, 'DENY', 'BUY against DOWN → DENY');
  assert.match(out.decision.reason, /HTF gate/, 'reason names the HTF gate');
  ok('against → DENY');
}

// --- with → passthrough (SELL while HTF is DOWN), identical result object ---
{
  const inner = permit('SELL');
  const out = withHtfGate(inner, opts)(ctx(falling), {});
  assert.strictEqual(out, inner(), 'with-trend result passes through unchanged (same ref)');
  ok('with → passthrough');
}

// --- neutral → passthrough (flat HTF) ---
{
  const inner = permit('BUY');
  const out = withHtfGate(inner, opts)(ctx(flat), {});
  assert.strictEqual(out, inner(), 'NEUTRAL HTF → passthrough');
  ok('neutral → passthrough');
}

// --- rising HTF: SELL is against → DENY, BUY is with → pass (symmetry) ---
{
  const denied = withHtfGate(permit('SELL'), opts)(ctx(rising), {});
  assert.strictEqual(denied.decision.decision, 'DENY', 'SELL against UP → DENY');
  const innerBuy = permit('BUY');
  const passed2 = withHtfGate(innerBuy, opts)(ctx(rising), {});
  assert.strictEqual(passed2, innerBuy(), 'BUY with UP → passthrough');
  ok('rising-HTF symmetry');
}

// --- inner DENY → passthrough, no HTF reason injected ---
{
  const inner = denyInner();
  const out = withHtfGate(inner, opts)(ctx(falling), {});
  assert.strictEqual(out, inner(), 'inner DENY passes through');
  assert.strictEqual(out.decision.reason, 'inner', 'reason untouched');
  ok('inner DENY → passthrough');
}

// --- thin HTF history → NEUTRAL → passthrough ---
{
  const inner = permit('BUY');
  const out = withHtfGate(inner, opts)(ctx(thin), {});
  assert.strictEqual(out, inner(), 'insufficient HTF bars → passthrough');
  ok('thin history → passthrough');
}

// --- bucketOf truth table ---
{
  assert.strictEqual(bucketOf('BUY', 'UP'), 'with');
  assert.strictEqual(bucketOf('BUY', 'DOWN'), 'against');
  assert.strictEqual(bucketOf('SELL', 'UP'), 'against');
  assert.strictEqual(bucketOf('SELL', 'DOWN'), 'with');
  assert.strictEqual(bucketOf('BUY', 'NEUTRAL'), 'neutral');
  assert.strictEqual(bucketOf('SELL', 'NEUTRAL'), 'neutral');
  ok('bucketOf truth table');
}

console.log(`\n${passed} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_htf_gate.mjs`
Expected: FAIL — `Cannot find module '../src/backtest/htfGate.js'` (file not created yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/backtest/htfGate.js`:

```js
// src/backtest/htfGate.js
import { aggregateHTF } from '../core/aggregateHTF.js';
import { classifyHTFTrend } from '../core/classifyHTFTrend.js';

/** with/against/neutral for a trade side given an UP/DOWN/NEUTRAL HTF verdict. */
export function bucketOf(side, verdict) {
  if (verdict === 'NEUTRAL') return 'neutral';
  if (verdict === 'UP') return side === 'BUY' ? 'with' : 'against';
  return side === 'SELL' ? 'with' : 'against'; // DOWN
}

/**
 * Wrap a decide function with an HTF emaBand gate (backtest-only). When the inner decision
 * is a PERMIT whose order side runs AGAINST the HTF emaBand trend, flip it to DENY; `with`
 * and `neutral` pass through unchanged, as does any inner DENY. Pure and deterministic: the
 * HTF verdict is derived from ctx.candles via closed-only aggregation (no look-ahead).
 *
 * @param {(ctx:object, account:object)=>{signal:object, decision:object}} decide inner fn (e.g. evaluateBar)
 * @param {{ratio:number, emaPeriod:number, band:number}} opts
 * @returns {(ctx:object, account:object)=>{signal:object, decision:object}}
 */
export function withHtfGate(decide, opts) {
  const { ratio, emaPeriod, band } = opts;
  return (ctx, account) => {
    const result = decide(ctx, account);
    const d = result && result.decision;
    if (!d || d.decision !== 'PERMIT' || !d.order) return result;

    const htf = aggregateHTF(ctx.candles, ratio);
    const verdict = classifyHTFTrend(htf, { emaPeriod, band }).emaBand;
    if (bucketOf(d.order.side, verdict) === 'against') {
      return {
        signal: result.signal,
        decision: { decision: 'DENY', reason: `HTF gate: ${d.order.side} against ${verdict} trend (emaBand)` },
      };
    }
    return result;
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_htf_gate.mjs`
Expected: PASS — `7 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/backtest/htfGate.js tests/test_htf_gate.mjs
git commit -m "feat(backtest): HTF emaBand gate decorator (withHtfGate)"
```

(Do not `git add docs/` — the spec/plan are gitignored.)

---

## Task 2: Wire `--htf` flags into the backtest CLI

**Files:**
- Modify: `backtest/run-backtest.js` (`main()`, between the `buildCosts` call at line 144 and the `runOne` call at line 148)

- [ ] **Step 1: Add the flag-driven decorator in `main()`**

In `backtest/run-backtest.js`, `main()` currently reads (lines 143–152):

```js
  const guardrails = buildGuardrails(args, spec);
  const costs = buildCosts(args, spec);

  const btDb = await openBacktestDb(path.join(process.cwd(), 'backtest.db'));
  const btRepo = new BacktestRepo(btDb);
  const { runId, metrics } = await runOne(btRepo, {
    label, logicType, symbol, tf, lookback, leverage,
    candles, spec, realRows, guardrails, costs,
    fundingMode, fundingRate: fundingRateArg, group: args.group ?? null,
  });
```

Replace that block with:

```js
  const guardrails = buildGuardrails(args, spec);
  const costs = buildCosts(args, spec);

  // Opt-in HTF gate (backtest-only). Bare `--htf` parses to args.htf === true.
  let decide; // undefined → simulate() uses its default evaluateBar
  if (args.htf) {
    const { withHtfGate } = await import('../src/backtest/htfGate.js');
    const { evaluateBar } = await import('../src/core/pipeline.js');
    const htfOpts = {
      ratio: args.htfRatio != null ? Number(args.htfRatio) : 4,
      emaPeriod: args.htfEma != null ? Number(args.htfEma) : 50,
      band: args.htfBand != null ? Number(args.htfBand) : 0.005,
    };
    decide = withHtfGate(evaluateBar, htfOpts);
    console.log(`[backtest] HTF gate ON (emaBand, ratio=${htfOpts.ratio}, ema=${htfOpts.emaPeriod}, band=${htfOpts.band})`);
  }

  const btDb = await openBacktestDb(path.join(process.cwd(), 'backtest.db'));
  const btRepo = new BacktestRepo(btDb);
  const { runId, metrics } = await runOne(btRepo, {
    label, logicType, symbol, tf, lookback, leverage,
    candles, spec, realRows, guardrails, costs,
    fundingMode, fundingRate: fundingRateArg, group: args.group ?? null,
    decide,
  });
```

The only change to the `runOne` argument object is the added `decide` field; `runOne` already forwards `p.decide` to `simulate` at line 79.

- [ ] **Step 2: Verify the gate-off path is unchanged (regression)**

Run the existing suite — no shared code was modified, so all must still pass:

```bash
node tests/test_htf_gate.mjs
node tests/test_aggregate_htf.mjs
node tests/test_classify_htf_trend.mjs
node tests/test_analyze_htf_filter.mjs
node tests/test_simulator.js
```

Expected: every file prints its `N checks passed` line with no assertion errors.

- [ ] **Step 3: Manual verification — gate ON vs OFF**

Requires `market_data.db` populated for the cell. Run the same cell twice:

```bash
node backtest/run-backtest.js --symbol BTCUSDT --tf 1H --logic VMC_CIPHERB --from 2024-06-01
node backtest/run-backtest.js --symbol BTCUSDT --tf 1H --logic VMC_CIPHERB --from 2024-06-01 --htf
```

Expected:
- The second run prints `[backtest] HTF gate ON (emaBand, ratio=4, ema=50, band=0.005)`.
- The `--htf` run reports **fewer trades** and **reduced gross loss** than the gate-off run (the gate removes the `against` bucket — the measurement's deep loss center for VMC).
- A sanity cross-check on SMC (gate inert): `--logic SMC` with vs without `--htf` should be near-identical in trade count (`against` ≈ 0). If SMC trade counts differ by more than a couple of trades, the gate is mis-wired — investigate before proceeding.

If `market_data.db` lacks that cell, substitute any symbol/tf/logic present in the DB; the qualitative checks (gate-ON log line, fewer-or-equal trades, run completes) still apply.

- [ ] **Step 4: Commit**

```bash
git add backtest/run-backtest.js
git commit -m "feat(backtest): --htf CLI flags to enable the HTF gate"
```

(Do not `git add docs/`.)

---

## Self-Review

**1. Spec coverage:**
- Decorator `withHtfGate` + `bucketOf` (spec "The decorator") → Task 1. ✓
- emaBand-only, PERMIT→DENY on `against`, with/neutral/thin/inner-DENY pass through, no look-ahead (spec "Architecture", "Error handling") → Task 1 impl + tests. ✓
- CLI `--htf/--htfRatio/--htfEma/--htfBand`, `main()`-only edit, `runOne` unchanged (spec "CLI integration") → Task 2 Step 1. ✓
- Testing strategy: against→DENY, with/neutral/inner-DENY/thin → pass, bucketOf table, plus regression (spec "Testing strategy") → Task 1 tests + Task 2 Step 2. ✓
- Manual verification gate ON vs OFF, SMC inert cross-check (spec "Verification") → Task 2 Step 3. ✓
- Out-of-scope items (evaluateBar/RiskPolicy/bot_engine/htf_location/strategy configs/BREAKOUT) → not touched by any task. ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to". All code blocks are complete and copy-pasteable. ✓

**3. Type consistency:** `withHtfGate(decide, opts)` and `bucketOf(side, verdict)` signatures identical in test (Task 1 Step 1), implementation (Task 1 Step 3), and CLI use (Task 2 Step 1). `opts` shape `{ratio, emaPeriod, band}` consistent across all three. Verdict strings `UP|DOWN|NEUTRAL` and bucket strings `with|against|neutral` consistent. ✓
