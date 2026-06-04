# Phase 6a — Manual Path on Shared Signal Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `bot_engine.js`'s entry-side decision onto the pure signal core (`deriveSignal`) behind a default-OFF feature flag, with golden-master characterization tests proving parity except the three documented fixes.

**Architecture:** Extract the verbatim legacy side rule into a pure `legacyManualSide` function; add a pure `resolveEntrySide` seam that picks legacy (flag OFF) or core (flag ON, with `HOLD`→skip); edit `bot_engine.js` exactly once to call the seam. The position-lock / exit shell is untouched.

**Tech Stack:** Node.js ESM, plain `node:assert` test scripts (no framework, no new deps), SQLite-backed engine (not touched here).

**Spec:** `docs/superpowers/specs/2026-06-04-phase6a-manual-signal-core-design.md`

---

## File Structure

- **Create** `src/manual/legacyManualSide.js` — pure function reproducing the legacy `bot_engine` side rule verbatim (BUY default; SMC trend mapping; Breakout channel mapping; everything else → BUY).
- **Create** `src/manual/resolveEntrySide.js` — pure seam: given a resolved `useSignalCore` boolean, returns `{ side }` (legacy) or `{ side }` / `{ skip, reason }` (core, where `HOLD` → skip).
- **Modify** `bot_engine.js` — replace the inline `let side = "BUY"; if (logicType) {...}` block (lines ~448–467) with a single call to `resolveEntrySide`; add one import.
- **Create** `tests/test_legacy_manual_side.js` — pins `legacyManualSide` to the verbatim rule.
- **Create** `tests/test_manual_characterization.js` — golden-master: `legacyManualSide` vs `deriveSignal` across §5 fixtures.
- **Create** `tests/test_manual_flag_routing.js` — pins the `resolveEntrySide` seam (OFF/ON/HOLD-skip).

---

## Task 1: Extract the legacy side rule into a pure function

**Files:**
- Create: `src/manual/legacyManualSide.js`
- Test: `tests/test_legacy_manual_side.js`

This function reproduces `bot_engine.js` lines 448–467 **verbatim** (minus console.logs). It is the OFF-path behavior; pinning it byte-for-byte is the safety net.

- [ ] **Step 1: Write the failing test**

Create `tests/test_legacy_manual_side.js`:

```js
// tests/test_legacy_manual_side.js
import assert from 'node:assert';
import { legacyManualSide } from '../src/manual/legacyManualSide.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

// No logicType → default BUY
assert.strictEqual(legacyManualSide(null, {}, 100), 'BUY'); ok('null logicType → BUY');
assert.strictEqual(legacyManualSide(undefined, {}, 100), 'BUY'); ok('undefined logicType → BUY');

// SMC: trend drives side, neutral defaults to BUY (the legacy bug, preserved here)
assert.strictEqual(legacyManualSide('SMC', { structure: { trend: 1 } }, 100), 'BUY'); ok('SMC trend 1 → BUY');
assert.strictEqual(legacyManualSide('SMC', { structure: { trend: -1 } }, 100), 'SELL'); ok('SMC trend -1 → SELL');
assert.strictEqual(legacyManualSide('SMC', { structure: { trend: 0 } }, 100), 'BUY'); ok('SMC neutral → BUY (legacy)');
assert.strictEqual(legacyManualSide('SMC', {}, 100), 'BUY'); ok('SMC no structure → BUY');

// Breakout: only when channel.active; inside channel defaults to BUY (legacy bug, preserved)
assert.strictEqual(legacyManualSide('Breakout', { channel: { active: true, top: 110, bottom: 90 } }, 120), 'BUY'); ok('Breakout above top → BUY');
assert.strictEqual(legacyManualSide('Breakout', { channel: { active: true, top: 110, bottom: 90 } }, 80), 'SELL'); ok('Breakout below bottom → SELL');
assert.strictEqual(legacyManualSide('Breakout', { channel: { active: true, top: 110, bottom: 90 } }, 100), 'BUY'); ok('Breakout inside → BUY (legacy)');
assert.strictEqual(legacyManualSide('Breakout', { channel: { active: false, top: 110, bottom: 90 } }, 120), 'BUY'); ok('Breakout inactive → BUY (legacy)');

// Other logic types have no legacy side branch → always BUY
assert.strictEqual(legacyManualSide('VMC_CipherB', { wtCrossDown: true }, 100), 'BUY'); ok('VMC_CipherB → BUY (legacy, no branch)');
assert.strictEqual(legacyManualSide('Reversal', { rejection: { type: 'bearish' } }, 100), 'BUY'); ok('Reversal → BUY (legacy, no branch)');

console.log(`\n${passed} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_legacy_manual_side.js`
Expected: FAIL — `Cannot find module '.../src/manual/legacyManualSide.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/manual/legacyManualSide.js`:

```js
// src/manual/legacyManualSide.js
/**
 * Verbatim reproduction of bot_engine.js's legacy entry-side rule (lines ~448-467).
 * Pure; preserves the known "default to BUY" behavior on neutral/unhandled cases —
 * the OFF (feature-flag) path, pinned so any drift is caught by tests.
 *
 * @param {string|null} logicType - resolved strategy logic type ("SMC" | "Breakout" | ...)
 * @param {object} strategyData - the IndicatorManager.calculate(...) result
 * @param {number} price - latest close price
 * @returns {'BUY'|'SELL'} never HOLD — legacy always commits to a side
 */
export function legacyManualSide(logicType, strategyData = {}, price) {
  let side = 'BUY'; // Default side
  if (!logicType) return side;

  if (logicType === 'Breakout' && strategyData.channel?.active) {
    side = price > strategyData.channel.top
      ? 'BUY'
      : (price < strategyData.channel.bottom ? 'SELL' : 'BUY');
  } else if (logicType === 'SMC') {
    side = strategyData.structure?.trend === 1
      ? 'BUY'
      : (strategyData.structure?.trend === -1 ? 'SELL' : 'BUY');
  }
  return side;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_legacy_manual_side.js`
Expected: PASS — `12 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/manual/legacyManualSide.js tests/test_legacy_manual_side.js
git commit -m "refactor(manual): extract legacy entry-side rule as pure legacyManualSide

Verbatim reproduction of bot_engine's inline side logic, pinned by tests.
No behavior change; bot_engine still uses its inline copy until Task 4.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Characterization golden-master (legacy vs core)

**Files:**
- Test: `tests/test_manual_characterization.js`

Compares the real OFF code (`legacyManualSide`) against the pure core (`deriveSignal`) on a fixture battery covering every §5 row. Asserts the **exact** core side per fixture and records which are equal vs the three documented diffs. No production code changes.

Reference — `deriveSignal(logicType, raw, ctx)` upper-cases `logicType` and dispatches: `SMC→fromSMC(raw)`, `VMC_CIPHERB→fromWaveTrend(raw)`, `BREAKOUT→fromBreakout(raw, ctx)`, `REVERSAL→fromReversal(raw)`. Returned `signal.side` is `'BUY'|'SELL'|'HOLD'`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_manual_characterization.js`:

```js
// tests/test_manual_characterization.js
// Golden-master: the new core (deriveSignal) must match the legacy bot_engine
// side decision EXCEPT the three documented intentional fixes:
//   #1 neutral/inactive → HOLD (was BUY)
//   #2 VMC_CipherB gains a real wt-cross side (was always BUY)
//   #3 Reversal gains a real rejection side (was always BUY)
import assert from 'node:assert';
import { legacyManualSide } from '../src/manual/legacyManualSide.js';
import { deriveSignal } from '../src/core/SignalAdapter.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

// Each case: logicType, raw indicator data, price, expected legacy side, expected core side, diff?
const cases = [
  // ---- SMC ----
  { name: 'SMC trend 1', logicType: 'SMC', raw: { structure: { trend: 1, structure: [] }, obs: [] }, price: 100, legacy: 'BUY', core: 'BUY', diff: false },
  { name: 'SMC trend -1', logicType: 'SMC', raw: { structure: { trend: -1, structure: [] }, obs: [] }, price: 100, legacy: 'SELL', core: 'SELL', diff: false },
  { name: 'SMC neutral (#1)', logicType: 'SMC', raw: { structure: { trend: 0, structure: [] }, obs: [] }, price: 100, legacy: 'BUY', core: 'HOLD', diff: true },

  // ---- Breakout ----
  { name: 'Breakout above top', logicType: 'Breakout', raw: { channel: { active: true, top: 110, bottom: 90 } }, price: 120, legacy: 'BUY', core: 'BUY', diff: false },
  { name: 'Breakout below bottom', logicType: 'Breakout', raw: { channel: { active: true, top: 110, bottom: 90 } }, price: 80, legacy: 'SELL', core: 'SELL', diff: false },
  { name: 'Breakout inside (#1)', logicType: 'Breakout', raw: { channel: { active: true, top: 110, bottom: 90 } }, price: 100, legacy: 'BUY', core: 'HOLD', diff: true },
  { name: 'Breakout inactive (#1)', logicType: 'Breakout', raw: { channel: { active: false, top: 110, bottom: 90 } }, price: 120, legacy: 'BUY', core: 'HOLD', diff: true },

  // ---- VMC_CipherB (#2) ----
  { name: 'VMC wtCrossUp', logicType: 'VMC_CipherB', raw: { wtCrossUp: true, mfi: 50, stochRsi: { k: 50 }, stc: 50 }, price: 100, legacy: 'BUY', core: 'BUY', diff: false },
  { name: 'VMC wtCrossDown (#2)', logicType: 'VMC_CipherB', raw: { wtCrossDown: true, mfi: 50, stochRsi: { k: 50 }, stc: 50 }, price: 100, legacy: 'BUY', core: 'SELL', diff: true },
  { name: 'VMC no cross (#2)', logicType: 'VMC_CipherB', raw: { mfi: 50, stochRsi: { k: 50 }, stc: 50 }, price: 100, legacy: 'BUY', core: 'HOLD', diff: true },

  // ---- Reversal (#3) ----
  { name: 'Reversal bullish', logicType: 'Reversal', raw: { rejection: { type: 'bullish', low: 95, high: 105 } }, price: 100, legacy: 'BUY', core: 'BUY', diff: false },
  { name: 'Reversal bearish (#3)', logicType: 'Reversal', raw: { rejection: { type: 'bearish', low: 95, high: 105 } }, price: 100, legacy: 'BUY', core: 'SELL', diff: true },
  { name: 'Reversal no rejection (#3)', logicType: 'Reversal', raw: {}, price: 100, legacy: 'BUY', core: 'HOLD', diff: true },
];

let diffCount = 0;
for (const c of cases) {
  const legacySide = legacyManualSide(c.logicType, c.raw, c.price);
  const coreSide = deriveSignal(c.logicType, c.raw, { price: c.price, candles: [] }).side;
  assert.strictEqual(legacySide, c.legacy, `${c.name}: legacy side`);
  assert.strictEqual(coreSide, c.core, `${c.name}: core side`);
  const isDiff = legacySide !== coreSide;
  assert.strictEqual(isDiff, c.diff, `${c.name}: diff flag (legacy=${legacySide} core=${coreSide})`);
  if (isDiff) diffCount++;
  ok(`${c.name} (legacy ${legacySide} / core ${coreSide}${isDiff ? ' — documented diff' : ''})`);
}

// Exactly the documented diffs, no more, no less
assert.strictEqual(diffCount, 7, 'exactly 7 documented diffs across the battery');
ok('diff count == 7 (no undocumented divergence)');

console.log(`\n${passed} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails (or surfaces a real mismatch)**

Run: `node tests/test_manual_characterization.js`
Expected: PASS if `deriveSignal` behaves as the spec §5 table says. If it FAILS, do not edit the test to match — investigate whether `SignalAdapter` diverges from the spec and resolve before continuing (this test is the contract).

Note: this task has no failing-implementation phase because both `legacyManualSide` (Task 1) and `deriveSignal` (Phase 1) already exist; the test *characterizes* them. Treat a green run as the deliverable.

- [ ] **Step 3: Commit**

```bash
git add tests/test_manual_characterization.js
git commit -m "test(manual): golden-master legacy side vs signal core

Locks parity between bot_engine's legacy side rule and deriveSignal,
asserting exactly the 7 documented intentional diffs (neutral->HOLD,
WaveTrend side, Reversal side).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: The flag-resolving seam (`resolveEntrySide`)

**Files:**
- Create: `src/manual/resolveEntrySide.js`
- Test: `tests/test_manual_flag_routing.js`

A pure helper (no env, no DB) that takes an already-resolved `useSignalCore` boolean and returns either a side or a skip directive. Keeping env-reading out of this function makes it trivially testable; `bot_engine` resolves the boolean and passes it in (Task 4).

- [ ] **Step 1: Write the failing test**

Create `tests/test_manual_flag_routing.js`:

```js
// tests/test_manual_flag_routing.js
import assert from 'node:assert';
import { resolveEntrySide } from '../src/manual/resolveEntrySide.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

const smcNeutral = { structure: { trend: 0, structure: [] }, obs: [] };
const smcBull = { structure: { trend: 1, structure: [] }, obs: [] };

// OFF → legacy side, never skips (legacy commits to a side)
{
  const r = resolveEntrySide({ logicType: 'SMC', strategyData: smcNeutral, price: 100, candles: [], useSignalCore: false });
  assert.strictEqual(r.skip, false); assert.strictEqual(r.side, 'BUY');
  ok('OFF + SMC neutral → legacy BUY, no skip');
}

// ON → core side
{
  const r = resolveEntrySide({ logicType: 'SMC', strategyData: smcBull, price: 100, candles: [], useSignalCore: true });
  assert.strictEqual(r.skip, false); assert.strictEqual(r.side, 'BUY');
  ok('ON + SMC bullish → core BUY');
}

// ON + HOLD → skip with reason, no side
{
  const r = resolveEntrySide({ logicType: 'SMC', strategyData: smcNeutral, price: 100, candles: [], useSignalCore: true });
  assert.strictEqual(r.skip, true);
  assert.strictEqual(r.side, null);
  assert.ok(typeof r.reason === 'string' && r.reason.length > 0, 'reason present');
  ok('ON + SMC neutral → skip (HOLD)');
}

// ON + core SELL → side SELL, no skip
{
  const r = resolveEntrySide({ logicType: 'SMC', strategyData: { structure: { trend: -1, structure: [] }, obs: [] }, price: 100, candles: [], useSignalCore: true });
  assert.strictEqual(r.skip, false); assert.strictEqual(r.side, 'SELL');
  ok('ON + SMC bearish → core SELL');
}

console.log(`\n${passed} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_manual_flag_routing.js`
Expected: FAIL — `Cannot find module '.../src/manual/resolveEntrySide.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/manual/resolveEntrySide.js`:

```js
// src/manual/resolveEntrySide.js
import { legacyManualSide } from './legacyManualSide.js';
import { deriveSignal } from '../core/SignalAdapter.js';

/**
 * Resolve the entry side for the manual path, choosing source by the feature flag.
 * Pure: the caller resolves `useSignalCore` (env / per-strategy config) and passes it in.
 *
 * @param {object} args
 * @param {string|null} args.logicType
 * @param {object} args.strategyData - IndicatorManager.calculate(...) result
 * @param {number} args.price
 * @param {object[]} args.candles
 * @param {boolean} args.useSignalCore - false → legacy rule; true → pure core
 * @returns {{ side: 'BUY'|'SELL', skip: false } | { side: null, skip: true, reason: string }}
 */
export function resolveEntrySide({ logicType, strategyData, price, candles, useSignalCore }) {
  if (!useSignalCore) {
    return { side: legacyManualSide(logicType, strategyData, price), skip: false };
  }
  const signal = deriveSignal(logicType, strategyData, { price, candles });
  if (signal.side === 'HOLD') {
    return { side: null, skip: true, reason: signal.reason || 'signal core HOLD' };
  }
  return { side: signal.side, skip: false };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_manual_flag_routing.js`
Expected: PASS — `4 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/manual/resolveEntrySide.js tests/test_manual_flag_routing.js
git commit -m "feat(manual): add resolveEntrySide flag seam (legacy vs signal core)

Pure helper: OFF -> legacyManualSide; ON -> deriveSignal, with HOLD
surfaced as a skip directive. Not yet wired into bot_engine (Task 4).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Wire `bot_engine.js` to the seam behind the flag (the one live edit)

**Files:**
- Modify: `bot_engine.js` (add import near line 7; replace the side block at lines ~448–467)

This is the only change to live trading code. Flag default OFF ⇒ byte-identical to today (proven by Tasks 1–3). ON ⇒ core decides; `HOLD` skips the entry for this symbol.

- [ ] **Step 1: Add the import**

In `bot_engine.js`, find the existing import:

```js
import { IndicatorManager } from "./src/indicators/index.js";
```

Add immediately after it:

```js
import { resolveEntrySide } from "./src/manual/resolveEntrySide.js";
```

- [ ] **Step 2: Replace the inline side block**

Find this exact block (around lines 448–467):

```js
              let strategyData = {};
              let side = "BUY"; // Default side
              if (logicType) {
                strategyData = indicatorManager.calculate(logicType, candles);

                if (logicType === "Breakout" && strategyData.channel?.active) {
                  console.log(
                    `  Channel Active: Top $${strategyData.channel.top.toFixed(2)} | Bottom $${strategyData.channel.bottom.toFixed(2)}`,
                  );
                  side = price > strategyData.channel.top ? "BUY" : (price < strategyData.channel.bottom ? "SELL" : "BUY");
                } else if (logicType === "SMC") {
                  console.log(
                    `  Trend: ${strategyData.structure?.trend === 1 ? "BULLISH" : strategyData.structure?.trend === -1 ? "BEARISH" : "NEUTRAL"}`,
                  );
                  console.log(
                    `  OBs detected: ${strategyData.obs?.length || 0} | FVGs detected: ${strategyData.fvgs?.length || 0}`,
                  );
                  side = strategyData.structure?.trend === 1 ? "BUY" : (strategyData.structure?.trend === -1 ? "SELL" : "BUY");
                }
              }
```

Replace it with (preserves the operator-facing console.logs; routes the decision through the seam; `HOLD` on the ON path skips this symbol's entry this cycle):

```js
              let strategyData = {};
              let side = "BUY"; // Default side
              if (logicType) {
                strategyData = indicatorManager.calculate(logicType, candles);

                // Operator-facing visibility (unchanged from legacy logging).
                if (logicType === "Breakout" && strategyData.channel?.active) {
                  console.log(
                    `  Channel Active: Top $${strategyData.channel.top.toFixed(2)} | Bottom $${strategyData.channel.bottom.toFixed(2)}`,
                  );
                } else if (logicType === "SMC") {
                  console.log(
                    `  Trend: ${strategyData.structure?.trend === 1 ? "BULLISH" : strategyData.structure?.trend === -1 ? "BEARISH" : "NEUTRAL"}`,
                  );
                  console.log(
                    `  OBs detected: ${strategyData.obs?.length || 0} | FVGs detected: ${strategyData.fvgs?.length || 0}`,
                  );
                }

                // Feature flag: per-strategy config overrides the global env (default OFF).
                const useSignalCore =
                  strategyConfig.useSignalCore ??
                  (process.env.USE_SIGNAL_CORE_MANUAL === "true");

                const entry = resolveEntrySide({
                  logicType,
                  strategyData,
                  price,
                  candles,
                  useSignalCore,
                });

                if (entry.skip) {
                  const skipMsg = `⏭️  No entry for ${symbol}: signal core returned HOLD (${entry.reason})`;
                  console.log(skipMsg);
                  await logEventSimple(strategyId, "CHECK", skipMsg);
                  continue; // skip to next symbol in the watchlist — no spurious entry
                }

                side = entry.side;
              }
```

Note: the `continue` lands in the `for (const symbol of watchlist)` loop (opened ~line 285), so a `HOLD` cleanly skips only this symbol's entry, leaving the position-lock / exit branch and all other symbols untouched.

- [ ] **Step 3: Run the full test suite to verify nothing regressed**

Run each (from repo root):

```bash
node tests/test_legacy_manual_side.js
node tests/test_manual_characterization.js
node tests/test_manual_flag_routing.js
node tests/test_resolver.js
node tests/test_backtest_service.js
node tests/test_backtest_repo_listgroups.js
node tests/test_backtest_routes.js
node tests/test_backtest_integration.js
node tests/test_futures_integration.js
```

Expected: every script prints its `N checks passed` / success line and exits 0. No `AssertionError`, no stack traces.

- [ ] **Step 4: Sanity-check the engine still parses/boots its module graph**

Run: `node --check bot_engine.js`
Expected: no output, exit 0 (syntax valid). The import resolves because `src/manual/resolveEntrySide.js` exists from Task 3.

- [ ] **Step 5: Register edits to keep the code index fresh**

Call `register_edit` with: `bot_engine.js`, `src/manual/legacyManualSide.js`, `src/manual/resolveEntrySide.js`.

- [ ] **Step 6: Commit**

```bash
git add bot_engine.js
git commit -m "feat(manual): route bot_engine entry side through signal core behind flag

USE_SIGNAL_CORE_MANUAL (env, default OFF) / strategyConfig.useSignalCore
selects legacy vs deriveSignal. OFF is byte-identical to today; ON makes
HOLD skip the entry. Position-lock and exit logic untouched.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review (completed during planning)

**Spec coverage:**
- Spec §3.1 (extract `legacyManualSide`) → Task 1. ✓
- Spec §3.2 (characterization legacy vs core, documented diffs) → Task 2. ✓
- Spec §3.3 (flag `USE_SIGNAL_CORE_MANUAL` + per-strategy override; ON routes core; HOLD short-circuits) → Task 3 (seam) + Task 4 (env/config resolution + skip). ✓
- Spec §3.4 (shell regression — lock/exit untouched) → Task 4 leaves the position branch unedited; `continue` only skips entry. Covered by "no behavioral edit" + full-suite run. ✓
- Spec §5 diff table → Task 2 fixtures cover every row; `diffCount === 7` guards against undocumented divergence. ✓
- Spec §3 out-of-scope (RiskPolicy unification, AI agent, frontend) → not touched by any task. ✓

**Placeholder scan:** no TBD/TODO; every code step has complete code and exact commands. ✓

**Type/name consistency:** `legacyManualSide(logicType, strategyData, price)`, `resolveEntrySide({logicType, strategyData, price, candles, useSignalCore})` returning `{side, skip, reason?}`, and `deriveSignal(logicType, raw, {price, candles}).side` are used identically across Tasks 1–4. ✓
