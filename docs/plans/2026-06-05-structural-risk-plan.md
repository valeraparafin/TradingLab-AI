# Structural Risk Implementation Plan (Spec 2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `minRiskRewardRatio` gate the *actual setup* — when a numeric structural `invalidation` is present, the risk leg is the entry→invalidation distance, not the fixed stop percent — while keeping every existing behavior otherwise (the gate only adds DENYs).

**Architecture:** A new pure helper `computeSetupRR` does the percent geometry. `RiskPolicy` calls it and DENYs when `setupRR < minRiskRewardRatio`; when there is no valid numeric invalidation it falls back to the current config-ratio check. The two callers (`pipeline.js`, `AgentOrchestrator.js`) pass `invalidation` through `ctx`. A cross-field schema refinement (Guard 1) rejects templates whose `TP/SL` ratio can never meet their own `minRiskRewardRatio`; two such templates are fixed by widening TP.

**Tech Stack:** Node.js ESM, Zod schemas, standalone `node tests/<file>` test runner (exit 0 = pass; there is no `npm test`).

**Branch:** `feat/structural-risk` (already checked out; design committed at `e8841ce`).

**Unit convention (from Spec 1, assumed here):** every `*Percent` field is a whole percent at rest (`2` = 2%); every `*Pct` guardrail is a fraction at runtime (`0.02`). `riskProfileToGuardrails.js` is the single `÷100` boundary.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/agents/computeSetupRR.js` | Pure: structural reward:risk from invalidation, or `null` | **Create** |
| `src/agents/RiskPolicy.js` | Structural-first RR gate, config-ratio fallback | Modify (block at lines 43-49; destructure at line 20; new import) |
| `src/core/pipeline.js` | Pass `invalidation: signal.invalidation ?? null` into `evaluate` | Modify (line 17) |
| `src/agents/AgentOrchestrator.js` | Pass numeric `proposal.invalidationIdea` (else null) into `evaluate` | Modify (line 69) |
| `src/core/contracts.js` | `AccountState` JSDoc gains optional `invalidation` | Modify (typedef ~lines 24-30) |
| `src/config_resolver.js` | Guard 1 cross-field refine on `RiskSchema` | Modify (object ends line 23) |
| `src/server/schemas/strategy.schema.js` | Guard 1 mirror on both risk schemas | Modify (lines 13-34) |
| `templates/risk/conservative.json` | TP 5 → 6 (RR 3.0) | Modify (line 9) |
| `templates/risk/vmc_cipherb_1h_conservative.json` | TP 8 → 9 (RR 3.0) | Modify (line 7) |
| `tests/test_compute_setup_rr.mjs` | Unit: helper geometry + null cases | **Create** |
| `tests/test_risk_policy.mjs` | Gate behavior block (f) | Modify (append before line 55) |
| `tests/test_pipeline_invalidation.mjs` | Integration: invalidation reaches the gate | **Create** |
| `tests/test_risk_schema_guard.mjs` | Guard 1 schema cases | Modify (append before line 25 log) |
| `tests/test_template_units.mjs` | All templates satisfy ratio ≥ minRR | Modify (inside loop) |
| `docs/research/2026-06-04-smc-strategy-backtest-findings.md` | Record expected backtest change | Modify (append note) |

---

## Task 1: `computeSetupRR` pure helper

**Files:**
- Create: `src/agents/computeSetupRR.js`
- Test: `tests/test_compute_setup_rr.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/test_compute_setup_rr.mjs`:

```js
// tests/test_compute_setup_rr.mjs
import assert from 'node:assert';
import { computeSetupRR } from '../src/agents/computeSetupRR.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

// BUY normal: entry 100, invalidation 98 → riskFrac 0.02; TP 0.06 → RR 3.0
assert.strictEqual(
  computeSetupRR({ entryPrice: 100, invalidation: 98, side: 'BUY', takeProfitPct: 0.06 }), 3.0);
ok('BUY normal → 3.0');

// SELL normal: entry 100, invalidation 103 → riskFrac 0.03; TP 0.06 → RR 2.0
assert.strictEqual(
  computeSetupRR({ entryPrice: 100, invalidation: 103, side: 'SELL', takeProfitPct: 0.06 }), 2.0);
ok('SELL normal → 2.0');

// Wrong side for BUY (invalidation above entry) → null
assert.strictEqual(
  computeSetupRR({ entryPrice: 100, invalidation: 102, side: 'BUY', takeProfitPct: 0.06 }), null);
ok('BUY wrong-side → null');

// Wrong side for SELL (invalidation below entry) → null
assert.strictEqual(
  computeSetupRR({ entryPrice: 100, invalidation: 98, side: 'SELL', takeProfitPct: 0.06 }), null);
ok('SELL wrong-side → null');

// Zero distance (invalidation == entry) → null
assert.strictEqual(
  computeSetupRR({ entryPrice: 100, invalidation: 100, side: 'BUY', takeProfitPct: 0.06 }), null);
ok('zero distance → null');

// null / NaN / non-numeric invalidation → null (LLM string path lands here)
assert.strictEqual(computeSetupRR({ entryPrice: 100, invalidation: null, side: 'BUY', takeProfitPct: 0.06 }), null);
assert.strictEqual(computeSetupRR({ entryPrice: 100, invalidation: NaN, side: 'BUY', takeProfitPct: 0.06 }), null);
assert.strictEqual(computeSetupRR({ entryPrice: 100, invalidation: 'Invalidate if structure flips', side: 'BUY', takeProfitPct: 0.06 }), null);
ok('null/NaN/string invalidation → null');

// HOLD or unknown side → null
assert.strictEqual(computeSetupRR({ entryPrice: 100, invalidation: 98, side: 'HOLD', takeProfitPct: 0.06 }), null);
ok('HOLD side → null');

// Missing/garbage takeProfitPct → null
assert.strictEqual(computeSetupRR({ entryPrice: 100, invalidation: 98, side: 'BUY', takeProfitPct: null }), null);
ok('null takeProfitPct → null');

console.log(`\n${passed} checks passed`);
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node tests/test_compute_setup_rr.mjs`
Expected: FAIL — `Cannot find module '.../src/agents/computeSetupRR.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/agents/computeSetupRR.js`:

```js
// src/agents/computeSetupRR.js

/**
 * Setup reward:risk from the structural stop.
 *
 * The risk leg is the entry→invalidation distance as a fraction of entry; the reward leg
 * is the fixed takeProfitPct (a fraction). Returns null whenever there is no valid
 * structural basis — caller then falls back to the config-ratio (takeProfitPct/stopLossPct).
 *
 * Invalid (→ null) means any of: non-finite invalidation/entry (the LLM string path lands
 * here), invalidation on the wrong side of entry for the side, zero distance, non-positive
 * entry, missing takeProfitPct, or a side other than BUY/SELL.
 *
 * @param {{entryPrice:number, invalidation:(number|null), side:'BUY'|'SELL'|'HOLD', takeProfitPct:number}} a
 * @returns {number|null}
 */
export function computeSetupRR({ entryPrice, invalidation, side, takeProfitPct }) {
  if (typeof invalidation !== 'number' || !isFinite(invalidation)) return null;
  if (typeof entryPrice !== 'number' || !isFinite(entryPrice) || entryPrice <= 0) return null;
  if (typeof takeProfitPct !== 'number' || !isFinite(takeProfitPct)) return null;
  const onCorrectSide =
    side === 'BUY' ? invalidation < entryPrice :
    side === 'SELL' ? invalidation > entryPrice : false;
  if (!onCorrectSide) return null;
  const riskFrac = Math.abs(entryPrice - invalidation) / entryPrice;
  if (!(riskFrac > 0)) return null;
  return takeProfitPct / riskFrac;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `node tests/test_compute_setup_rr.mjs`
Expected: PASS — `9 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/agents/computeSetupRR.js tests/test_compute_setup_rr.mjs
git commit -m "$(cat <<'EOF'
feat(risk): computeSetupRR — structural reward:risk from invalidation

Pure helper. Risk leg = |entry-invalidation|/entry; reward leg = takeProfitPct.
Returns null for non-finite/wrong-side/zero-distance invalidation (LLM string lands
here) so callers fall back to the config-ratio check.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Setup-RR gate in RiskPolicy (+ contracts JSDoc)

**Files:**
- Modify: `src/agents/RiskPolicy.js` (import at top; destructure line 20; RR block lines 43-49)
- Modify: `src/core/contracts.js` (`AccountState` typedef, ~lines 24-30)
- Test: `tests/test_risk_policy.mjs` (append a block before the futures section at line 55)

- [ ] **Step 1: Write the failing test**

In `tests/test_risk_policy.mjs`, insert this block immediately after line 51 (the `'undefined cap is no-op'` assertion) and before line 53 (`console.log('OK test_risk_policy');`):

```js
// (f) structural setup-RR gate (Spec 2). Base guardrails: stopLossPct 0.05, takeProfitPct 0.10
//     → configRR (fallback) = 2.0. Risk leg = |entry - invalidation| / entry.
const sg = new RiskPolicy({ ...guardrails, minRiskRewardRatio: 1.5 });
// invalidation 90 → riskFrac 0.10 → setupRR 1.0 < 1.5 → DENY, reason names "structural"
const den = sg.evaluate({ side: 'BUY', conviction: 1 }, { ...ctx, invalidation: 90 });
assert.equal(den.decision, 'DENY', 'structural setupRR 1.0 < 1.5 must DENY');
assert.ok(/structural/i.test(den.reason), 'deny reason names structural');
// invalidation 96 → riskFrac 0.04 → setupRR 2.5 >= 1.5 → PERMIT
assert.equal(sg.evaluate({ side: 'BUY', conviction: 1 }, { ...ctx, invalidation: 96 }).decision, 'PERMIT',
  'structural setupRR 2.5 >= 1.5 must PERMIT');
// SELL: invalidation 110 (above entry) → riskFrac 0.10 → setupRR 1.0 < 1.5 → DENY
assert.equal(sg.evaluate({ side: 'SELL', conviction: 1 }, { ...ctx, invalidation: 110 }).decision, 'DENY',
  'SELL structural setupRR 1.0 < 1.5 must DENY');
// BUY with wrong-side invalidation (110 > entry) → null → fallback config-ratio (2.0 >= 1.5) → PERMIT
assert.equal(sg.evaluate({ side: 'BUY', conviction: 1 }, { ...ctx, invalidation: 110 }).decision, 'PERMIT',
  'wrong-side invalidation falls back to config-ratio PERMIT');
// no numeric invalidation → fallback; reason is the OLD wording (no "structural")
const fb = new RiskPolicy({ ...guardrails, minRiskRewardRatio: 3 }).evaluate({ side: 'BUY', conviction: 1 }, ctx);
assert.equal(fb.decision, 'DENY', 'fallback config-ratio 2.0 < 3 must DENY');
assert.ok(!/structural/i.test(fb.reason), 'fallback reason is not structural');
// minRR 0 with a near invalidation → gate inert → PERMIT
assert.equal(new RiskPolicy({ ...guardrails, minRiskRewardRatio: 0 })
  .evaluate({ side: 'BUY', conviction: 1 }, { ...ctx, invalidation: 90 }).decision, 'PERMIT',
  'minRR 0 → gate inert even with near invalidation');
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node tests/test_risk_policy.mjs`
Expected: FAIL — the `invalidation: 90` case currently PERMITs (config-ratio 2.0 ≥ 1.5), so the `'structural setupRR 1.0 < 1.5 must DENY'` assertion throws.

- [ ] **Step 3a: Implement — import the helper**

In `src/agents/RiskPolicy.js`, add below the existing import on line 2 (`import { liqPrice } from '../core/liquidation.js';`):

```js
import { computeSetupRR } from './computeSetupRR.js';
```

- [ ] **Step 3b: Implement — destructure `invalidation` from ctx**

In `src/agents/RiskPolicy.js`, change line 20 from:

```js
    const { entryPrice, openPositions = 0, portfolioHeatPct = 0, dailyPnlPct = 0, tradesToday = 0 } = ctx || {};
```

to:

```js
    const { entryPrice, openPositions = 0, portfolioHeatPct = 0, dailyPnlPct = 0, tradesToday = 0, invalidation = null } = ctx || {};
```

- [ ] **Step 3c: Implement — replace the RR block**

In `src/agents/RiskPolicy.js`, replace the existing block at lines 43-49:

```js
    // Minimum risk/reward: TP distance vs SL distance (both fractions from the profile).
    if (g.minRiskRewardRatio > 0 && g.stopLossPct > 0 && isFinite(g.takeProfitPct)) {
      const rr = g.takeProfitPct / g.stopLossPct;
      if (rr < g.minRiskRewardRatio) {
        return { decision: 'DENY', reason: `Risk/reward ${rr.toFixed(2)} below minimum ${g.minRiskRewardRatio}` };
      }
    }
```

with (structural-first, config-ratio fallback):

```js
    // Minimum risk/reward (Spec 2 — structural-first). When a numeric structural
    // invalidation is available, the risk leg is the entry→invalidation distance (the real
    // setup risk); otherwise fall back to the config ratio (takeProfitPct/stopLossPct).
    // Gate-only: this can only DENY — it never changes size, SL, or TP.
    if (g.minRiskRewardRatio > 0 && g.stopLossPct > 0 && isFinite(g.takeProfitPct)) {
      const setupRR = computeSetupRR({ entryPrice, invalidation, side: proposal.side, takeProfitPct: g.takeProfitPct });
      if (setupRR != null) {
        if (setupRR < g.minRiskRewardRatio) {
          return { decision: 'DENY', reason: `Setup RR ${setupRR.toFixed(2)} below minimum ${g.minRiskRewardRatio} (structural)` };
        }
      } else {
        const rr = g.takeProfitPct / g.stopLossPct;
        if (rr < g.minRiskRewardRatio) {
          return { decision: 'DENY', reason: `Risk/reward ${rr.toFixed(2)} below minimum ${g.minRiskRewardRatio}` };
        }
      }
    }
```

- [ ] **Step 3d: Implement — extend the contracts JSDoc**

In `src/core/contracts.js`, in the `AccountState` typedef (lines 24-30), add one property line after `@property {number} entryPrice` (line 25):

```js
 * @property {number|null} [invalidation] - structural stop level; entry→invalidation is the setup risk leg (null when none)
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `node tests/test_risk_policy.mjs`
Expected: PASS — `OK test_risk_policy` then `test_risk_policy.mjs futures cases OK`. (The existing block (d) and futures parity at line 68 still pass: those ctx objects carry no `invalidation`, so `computeSetupRR` returns null and the fallback reproduces the prior decision and order shape byte-for-byte.)

- [ ] **Step 5: Commit**

```bash
git add src/agents/RiskPolicy.js src/core/contracts.js tests/test_risk_policy.mjs
git commit -m "$(cat <<'EOF'
feat(risk): structural-first setup-RR gate in RiskPolicy

When ctx.invalidation is a valid numeric structural stop, gate on
takeProfitPct / (entry→invalidation distance); else fall back to the config ratio.
Gate-only: DENY-only, never alters size/SL/TP. AccountState JSDoc gains invalidation.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Plumb `invalidation` through both callers

**Files:**
- Modify: `src/core/pipeline.js` (line 17)
- Modify: `src/agents/AgentOrchestrator.js` (line 69)
- Test: `tests/test_pipeline_invalidation.mjs` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/test_pipeline_invalidation.mjs`:

```js
// tests/test_pipeline_invalidation.mjs
// Proves the pipeline forwards signal.invalidation into RiskPolicy via ctx.
import assert from 'node:assert';
import { evaluateBar } from '../src/core/pipeline.js';

// Proven bullish SMC fixture (mirrors tests/test_derive_agent_proposal.js): a lone pivot
// high (20) at index 55, then a final close (25) that breaks above it → SMC BUY with
// invalidation = 20. entry = 25 → riskFrac = |25-20|/25 = 0.20.
const candles = Array.from({ length: 110 }, (_, i) =>
  ({ time: i, open: 7, high: 10, low: 5, close: 7, volume: 10 }));
candles[55].high = 20;
candles[109].high = 25;
candles[109].close = 25;

const baseGuards = {
  riskPerTrade: 0.02, stopLossPct: 0.05, takeProfitPct: 0.10, portfolioValue: 1000,
  maxOpenPositions: Infinity, maxPortfolioHeatPct: Infinity, dailyLossLimitPct: Infinity,
  dailyProfitTargetPct: null, maxTradesPerDay: Infinity,
};
const barCtx = { candles, config: { logicType: 'SMC', logic: {} }, symbol: 'X', timeframe: '1H' };

// Sanity: signal is a bullish SMC with the expected numeric invalidation, and with the
// gate disabled (minRR 0) nothing else blocks it.
const probe = evaluateBar(barCtx, { guardrails: { ...baseGuards, minRiskRewardRatio: 0 }, portfolio: {} });
assert.strictEqual(probe.signal.side, 'BUY', 'fixture is bullish SMC');
assert.strictEqual(probe.signal.invalidation, 20, 'fixture invalidation = 20');
assert.strictEqual(probe.decision.decision, 'PERMIT', 'minRR 0 permits (no other gate blocks)');

// Discriminator: configRR (fallback) = 0.10/0.05 = 2.0; setupRR = 0.10/0.20 = 0.5.
// With minRR 1.9 the fallback would PERMIT (2.0 >= 1.9); only the structural path DENYs
// (0.5 < 1.9). A structural DENY proves signal.invalidation reached the policy via ctx.
const gated = evaluateBar(barCtx, { guardrails: { ...baseGuards, minRiskRewardRatio: 1.9 }, portfolio: {} });
assert.strictEqual(gated.decision.decision, 'DENY', 'structural setupRR 0.5 < 1.9 → DENY');
assert.ok(/structural/i.test(gated.decision.reason), 'DENY reason is structural (invalidation was plumbed)');

console.log('  ok - pipeline plumbs signal.invalidation into RiskPolicy (structural gate fires)');
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node tests/test_pipeline_invalidation.mjs`
Expected: FAIL — `pipeline.js` does not yet pass `invalidation`, so `ctx.invalidation` is undefined, the gate falls back to configRR 2.0 ≥ 1.9 and PERMITs; the `'... → DENY'` assertion throws.

- [ ] **Step 3a: Implement — pipeline.js**

In `src/core/pipeline.js`, change line 17 from:

```js
  const decision = new RiskPolicy(account.guardrails || {}).evaluate(signal, { ...(account.portfolio || {}), entryPrice: price });
```

to:

```js
  const decision = new RiskPolicy(account.guardrails || {}).evaluate(signal, { ...(account.portfolio || {}), entryPrice: price, invalidation: signal.invalidation ?? null });
```

- [ ] **Step 3b: Implement — AgentOrchestrator.js**

In `src/agents/AgentOrchestrator.js`, change line 69 from:

```js
        const verdict = this.riskPolicy.evaluate(proposal, { entryPrice, ...portfolioState });
```

to (the LLM `AnalystAgent` emits a string `invalidationIdea`, which must become `null` → fallback):

```js
        const verdict = this.riskPolicy.evaluate(proposal, {
          entryPrice,
          ...portfolioState,
          invalidation: (typeof proposal.invalidationIdea === 'number' && isFinite(proposal.invalidationIdea))
            ? proposal.invalidationIdea
            : null,
        });
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `node tests/test_pipeline_invalidation.mjs`
Expected: PASS — `pipeline plumbs signal.invalidation into RiskPolicy (structural gate fires)`.

Note on AgentOrchestrator verification: it is async + LLM/DB-bound with no unit harness, so it is verified by inspection here. The string→null behavior it relies on is itself covered by the `computeSetupRR` string case in Task 1 (a string invalidation yields `null` → fallback), so the orchestrator's one-line guard is belt-and-suspenders for type cleanliness.

- [ ] **Step 5: Commit**

```bash
git add src/core/pipeline.js src/agents/AgentOrchestrator.js tests/test_pipeline_invalidation.mjs
git commit -m "$(cat <<'EOF'
feat(risk): plumb signal.invalidation into RiskPolicy via ctx

pipeline passes signal.invalidation; AgentOrchestrator passes numeric
proposal.invalidationIdea (LLM string → null → config-ratio fallback). No behavior
change when minRiskRewardRatio is unset.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Guard 1 — schema cross-field consistency

**Files:**
- Modify: `src/config_resolver.js` (`RiskSchema`, object closes line 23)
- Modify: `src/server/schemas/strategy.schema.js` (`RiskTemplateSchema.settings` lines 15-21; `RiskSettingsSchema` lines 24-34)
- Test: `tests/test_risk_schema_guard.mjs` (append before the final `console.log` at line 25)
- Test: `tests/test_resolver.js` (add a resolver-level Guard 1 case)

- [ ] **Step 1: Write the failing tests**

(a) In `tests/test_risk_schema_guard.mjs`, insert before line 25 (`console.log(...)`):

```js
// --- Guard 1 (Spec 2): minRiskRewardRatio must be reachable by TP/SL ---
// snake_case (RiskSettingsSchema): min_risk_reward_ratio required.
const rrBase = {
  risk_per_trade_percent: 1, stop_loss_percent: 2, take_profit_percent: 6,
  min_risk_reward_ratio: 3, max_portfolio_heat_percent: 5, max_open_positions: 2,
  max_trades_per_day: 5, daily_loss_limit_percent: 2, daily_profit_target_percent: 5,
};
assert.strictEqual(RiskSettingsSchema.safeParse(rrBase).success, true, 'TP/SL 6/2=3.0 >= minRR 3 passes');
assert.strictEqual(RiskSettingsSchema.safeParse({ ...rrBase, take_profit_percent: 5 }).success, false,
  'TP/SL 5/2=2.5 < minRR 3 rejected (Guard 1)');

// camelCase (RiskTemplateSchema): minRiskRewardRatio optional; absent → inert.
const tplBase = { name: 'X', settings: { riskPerTradePercent: 1, maxTradeSizeUSD: 100, stopLossPercent: 2, takeProfitPercent: 6, maxTradesPerDay: 5, minRiskRewardRatio: 3 } };
assert.strictEqual(RiskTemplateSchema.safeParse(tplBase).success, true, 'template 6/2=3.0 >= minRR 3 passes');
assert.strictEqual(RiskTemplateSchema.safeParse({ ...tplBase, settings: { ...tplBase.settings, takeProfitPercent: 5 } }).success, false,
  'template 5/2=2.5 < minRR 3 rejected (Guard 1)');
const tplNoRR = { name: 'X', settings: { riskPerTradePercent: 1, maxTradeSizeUSD: 100, stopLossPercent: 2, takeProfitPercent: 5, maxTradesPerDay: 5 } };
assert.strictEqual(RiskTemplateSchema.safeParse(tplNoRR).success, true, 'no minRR → Guard 1 inert');
console.log('  ok - Guard 1 rejects minRR unreachable by TP/SL (both schemas)');
```

(b) In `tests/test_resolver.js`, insert a new test after Test 5 (after line 95 `console.log('✅ Test 5 Passed');`), before the closing `console.log('\nAll tests passed successfully!');` on line 97:

```js
  // Test 6: Guard 1 — a template whose minRiskRewardRatio exceeds its TP/SL ratio is rejected.
  console.log('Test 6: Guard 1 rejects unreachable minRiskRewardRatio...');
  fs.writeFileSync(path.join(riskDir, 'badrr_risk.json'), JSON.stringify({
    settings: {
      maxTradesPerDay: 10, maxTradeSizeUSD: 200, riskPerTradePercent: 2,
      stopLossPercent: 2, takeProfitPercent: 5, minRiskRewardRatio: 3
    }
  }));
  assert.throws(() => resolveConfig({ riskTemplateId: 'badrr_risk', logicTemplateId: 'test_logic' }),
    /validation failed/, 'TP/SL 2.5 < minRR 3 must be rejected by Guard 1');
  console.log('✅ Test 6 Passed');
```

And extend `cleanup()` in `tests/test_resolver.js` (the array on the line `for (const f of ['invalid_risk.json', 'fraction_risk.json']) {`) to also remove the new fixture:

```js
  for (const f of ['invalid_risk.json', 'fraction_risk.json', 'badrr_risk.json']) {
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node tests/test_risk_schema_guard.mjs`
Expected: FAIL — without Guard 1, `take_profit_percent: 5` (ratio 2.5) still parses, so the `'... < minRR 3 rejected (Guard 1)'` assertion throws.

Run: `node tests/test_resolver.js`
Expected: FAIL — `badrr_risk` resolves instead of throwing; the `assert.throws` fails.

- [ ] **Step 3a: Implement — config_resolver.js Guard 1**

In `src/config_resolver.js`, change the `RiskSchema` object close on line 23 from:

```js
  dailyProfitTargetPercent: z.number().min(0).max(100).optional(),
});
```

to (append a `.superRefine`):

```js
  dailyProfitTargetPercent: z.number().min(0).max(100).optional(),
}).superRefine((s, ctx) => {
  // Guard 1: a template can't demand more reward:risk than its own fixed TP/SL can yield.
  if (s.minRiskRewardRatio != null && s.minRiskRewardRatio > 0 && s.stopLossPercent > 0) {
    const ratio = s.takeProfitPercent / s.stopLossPercent;
    if (ratio < s.minRiskRewardRatio) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `minRiskRewardRatio ${s.minRiskRewardRatio} unreachable with TP ${s.takeProfitPercent} / SL ${s.stopLossPercent} (ratio ${ratio.toFixed(2)})`,
      });
    }
  }
});
```

- [ ] **Step 3b: Implement — strategy.schema.js (`RiskTemplateSchema`)**

In `src/server/schemas/strategy.schema.js`, change `RiskTemplateSchema` (lines 13-22) from:

```js
export const RiskTemplateSchema = z.object({
  name: z.string().min(1),
  settings: z.object({
    riskPerTradePercent: z.number().positive(),
    maxTradeSizeUSD: z.number().positive(),
    stopLossPercent: z.number().min(0.1).max(100),
    takeProfitPercent: z.number().min(0.1).max(100),
    maxTradesPerDay: z.number().int().positive(),
  }),
});
```

to:

```js
export const RiskTemplateSchema = z.object({
  name: z.string().min(1),
  settings: z.object({
    riskPerTradePercent: z.number().positive(),
    maxTradeSizeUSD: z.number().positive(),
    stopLossPercent: z.number().min(0.1).max(100),
    takeProfitPercent: z.number().min(0.1).max(100),
    maxTradesPerDay: z.number().int().positive(),
    minRiskRewardRatio: z.number().positive().optional(),
  }).superRefine((s, ctx) => {
    // Guard 1: minRiskRewardRatio must be reachable by the fixed TP/SL ratio.
    if (s.minRiskRewardRatio != null && s.minRiskRewardRatio > 0 && s.stopLossPercent > 0) {
      const ratio = s.takeProfitPercent / s.stopLossPercent;
      if (ratio < s.minRiskRewardRatio) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `minRiskRewardRatio ${s.minRiskRewardRatio} unreachable with TP ${s.takeProfitPercent} / SL ${s.stopLossPercent} (ratio ${ratio.toFixed(2)})`,
        });
      }
    }
  }),
});
```

- [ ] **Step 3c: Implement — strategy.schema.js (`RiskSettingsSchema`)**

In `src/server/schemas/strategy.schema.js`, change `RiskSettingsSchema` (lines 24-34) from:

```js
export const RiskSettingsSchema = z.object({
  risk_per_trade_percent: z.number().positive().max(100),
  stop_loss_percent: z.number().min(0.1).max(100),
  take_profit_percent: z.number().min(0.1).max(100),
  min_risk_reward_ratio: z.number().positive(),
  max_portfolio_heat_percent: z.number().positive().max(100),
  max_open_positions: z.number().int().positive(),
  max_trades_per_day: z.number().int().positive(),
  daily_loss_limit_percent: z.number().positive().max(100),
  daily_profit_target_percent: z.number().positive().max(100),
});
```

to:

```js
export const RiskSettingsSchema = z.object({
  risk_per_trade_percent: z.number().positive().max(100),
  stop_loss_percent: z.number().min(0.1).max(100),
  take_profit_percent: z.number().min(0.1).max(100),
  min_risk_reward_ratio: z.number().positive(),
  max_portfolio_heat_percent: z.number().positive().max(100),
  max_open_positions: z.number().int().positive(),
  max_trades_per_day: z.number().int().positive(),
  daily_loss_limit_percent: z.number().positive().max(100),
  daily_profit_target_percent: z.number().positive().max(100),
}).superRefine((s, ctx) => {
  // Guard 1: min_risk_reward_ratio must be reachable by the fixed TP/SL ratio.
  if (s.min_risk_reward_ratio != null && s.min_risk_reward_ratio > 0 && s.stop_loss_percent > 0) {
    const ratio = s.take_profit_percent / s.stop_loss_percent;
    if (ratio < s.min_risk_reward_ratio) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `min_risk_reward_ratio ${s.min_risk_reward_ratio} unreachable with take_profit ${s.take_profit_percent} / stop_loss ${s.stop_loss_percent} (ratio ${ratio.toFixed(2)})`,
      });
    }
  }
});
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `node tests/test_risk_schema_guard.mjs`
Expected: PASS — both the Guard 2 floor line and `Guard 1 rejects minRR unreachable by TP/SL (both schemas)`.

Run: `node tests/test_resolver.js`
Expected: PASS — Tests 1-6 pass; `All tests passed successfully!`.

- [ ] **Step 5: Commit**

```bash
git add src/config_resolver.js src/server/schemas/strategy.schema.js tests/test_risk_schema_guard.mjs tests/test_resolver.js
git commit -m "$(cat <<'EOF'
feat(risk): Guard 1 — reject minRiskRewardRatio unreachable by TP/SL

Cross-field superRefine in RiskSchema (config_resolver) and both risk schemas
(strategy.schema). A template demanding more RR than its fixed TP/SL can yield can
never trade; reject it at validation. Mirrors Spec 1's Guard 2 poka-yoke.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Fix the two inconsistent templates

**Files:**
- Modify: `templates/risk/conservative.json` (line 9: `takeProfitPercent` 5 → 6)
- Modify: `templates/risk/vmc_cipherb_1h_conservative.json` (line 7: `takeProfitPercent` 8 → 9)
- Test: `tests/test_template_units.mjs` (add a ratio ≥ minRR assertion inside the loop)

- [ ] **Step 1: Write the failing test**

In `tests/test_template_units.mjs`, insert inside the `for` loop, immediately after the `takeProfitPct` band assertion (after line 21, before `checked++;`):

```js
  // Guard 1 at the data layer: a template's fixed TP/SL must be able to meet its own minRR.
  if (s.minRiskRewardRatio != null && s.minRiskRewardRatio > 0) {
    const ratio = s.takeProfitPercent / s.stopLossPercent;
    assert.ok(ratio + 1e-9 >= s.minRiskRewardRatio,
      `${f}: TP/SL ratio ${ratio.toFixed(2)} < minRiskRewardRatio ${s.minRiskRewardRatio}`);
  }
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node tests/test_template_units.mjs`
Expected: FAIL — `conservative.json: TP/SL ratio 2.50 < minRiskRewardRatio 3` (the first of the two unfixed templates the loop hits).

- [ ] **Step 3a: Implement — conservative.json**

In `templates/risk/conservative.json`, change line 9 from:

```json
    "takeProfitPercent": 5,
```

to:

```json
    "takeProfitPercent": 6,
```

- [ ] **Step 3b: Implement — vmc_cipherb_1h_conservative.json**

In `templates/risk/vmc_cipherb_1h_conservative.json`, change line 7 from:

```json
    "takeProfitPercent": 8,
```

to:

```json
    "takeProfitPercent": 9,
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `node tests/test_template_units.mjs`
Expected: PASS — `N risk templates have sane SL/TP fractions after conversion` with no ratio failure (conservative 6/2=3.0, vmc_cipherb_1h_conservative 9/3=3.0, aggressive 15/5=3.0 ≥ 1.5, vmc_cipherb_5m_aggressive 3/1.5=2.0 ≥ 1.5).

- [ ] **Step 5: Commit**

```bash
git add templates/risk/conservative.json templates/risk/vmc_cipherb_1h_conservative.json tests/test_template_units.mjs
git commit -m "$(cat <<'EOF'
fix(templates): widen TP so conservative profiles can meet their own minRR

conservative TP 5->6 (RR 3.0), vmc_cipherb_1h_conservative TP 8->9 (RR 3.0). Both
demanded minRR 3 but their fixed TP/SL yielded 2.5/2.67 — under the runtime RR check
they never traded. test_template_units now asserts ratio >= minRR for every template.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Full regression, research note, graph refresh

**Files:**
- Modify: `docs/research/2026-06-04-smc-strategy-backtest-findings.md` (append a dated note)

- [ ] **Step 1: Run the entire test suite**

Run every standalone test and confirm each exits 0:

```bash
for f in tests/test_compute_setup_rr.mjs tests/test_risk_policy.mjs tests/test_pipeline_invalidation.mjs \
         tests/test_risk_schema_guard.mjs tests/test_resolver.js tests/test_template_units.mjs \
         tests/test_signal_adapter.js tests/test_derive_agent_proposal.js tests/test_param_resolver.mjs \
         tests/test_risk_profile_to_guardrails.js tests/test_bot_engine_sl.mjs tests/test_matrix.js; do
  echo "=== $f ==="; node "$f" || echo "FAILED: $f";
done
```

Expected: every block prints its own success line and no `FAILED:` appears. (`smoke_test_v2.js` is a known pre-existing failure — it needs a live server on localhost:3000 and references a non-existent `default_risk` template — and is NOT part of this regression set.)

- [ ] **Step 2: Backtest before/after (controller-run, reported to the user)**

Run the matrix and compare to the figures in the SMC findings report. Expectation:
- strategies **without** `minRiskRewardRatio` → numbers unchanged.
- `conservative` / `vmc_cipherb_1h_conservative` → numbers change (previously 0 trades from the never-trades bug → now entering). This is the intended fix, not a regression.

Run: `node backtest/run-backtest.js` (or the project's matrix entrypoint) and capture trade counts for the two fixed profiles vs. one unaffected profile.

- [ ] **Step 3: Record the expected change in the research doc**

Append to `docs/research/2026-06-04-smc-strategy-backtest-findings.md`:

```markdown

## 2026-06-05 — Spec 2 (Structural Risk) note

The setup-RR gate (RiskPolicy uses `ctx.invalidation` when numeric; else falls back to the
config ratio) is opt-in via `minRiskRewardRatio > 0`. Guard 1 (schema) now rejects any
template whose fixed `TP/SL` ratio cannot meet its own `minRiskRewardRatio`.

Two templates were fixed by widening TP to restore RR 3.0:
`conservative` (TP 5→6) and `vmc_cipherb_1h_conservative` (TP 8→9). Both previously demanded
`minRiskRewardRatio: 3` while their TP/SL yielded only 2.5 / 2.67, so the runtime RR check
DENYed every bar — they never traded. Backtest figures for these two profiles therefore
**change** post-Spec-2 (0 trades → entering); this is the intended fix. Profiles without
`minRiskRewardRatio` are unchanged.
```

- [ ] **Step 4: Refresh the knowledge graph**

Run: `graphify update .`
Expected: AST-only update, no errors.

- [ ] **Step 5: Commit**

```bash
git add docs/research/2026-06-04-smc-strategy-backtest-findings.md graphify-out
git commit -m "$(cat <<'EOF'
docs(research): record Spec 2 structural-risk gate + the two template fixes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Finish the branch**

Use **superpowers:finishing-a-development-branch** to choose how to integrate `feat/structural-risk` (merge into `feat/signal-core`, PR, or keep). Do NOT merge `feat/signal-core` into `feat/trading-agent-ai-flow` (master-spec §10 merge gate: only when all phases green + flags OFF).

---

## Self-Review

**Spec coverage:**
- §Design 2 (computeSetupRR) → Task 1. ✓
- §Design 3 (gate, structural-first + fallback) → Task 2. ✓
- §Design 4 (ctx.invalidation plumbing, both callers + contracts JSDoc) → Tasks 2 (contracts) + 3 (callers). ✓
- §Design 5 (Guard 1 both schemas) → Task 4. ✓
- §Design 6 (template fixes) → Task 5. ✓
- §Testing 1-5 → Tasks 1-5 tests; §Testing 6 (backtest regression) → Task 6. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; every run step shows the exact command and expected output. ✓

**Type/name consistency:** `computeSetupRR({ entryPrice, invalidation, side, takeProfitPct })` is defined in Task 1 and called identically in Task 2. `ctx.invalidation` is set in Task 3 (pipeline + orchestrator) and read in Task 2 (destructure). Guard 1 reads camelCase in `config_resolver`/`RiskTemplateSchema` and snake_case in `RiskSettingsSchema` — matching each schema's existing field casing. ✓

**Numeric checks:** Task 1 BUY 0.06/0.02=3.0, SELL 0.06/0.03=2.0. Task 2 base configRR 0.10/0.05=2.0; invalidation 90→setupRR 1.0, 96→2.5, SELL 110→1.0. Task 3 fixture invalidation 20, entry 25, riskFrac 0.20, setupRR 0.5 vs configRR 2.0 (discriminating at minRR 1.9). Task 5 ratios 6/2=3.0, 9/3=3.0. ✓
