# Structural Risk — Design Spec (Spec 2 of 2)

> **Status:** Approved design, ready for implementation plan.
> **Branch:** builds on `refactor/risk-config-foundation` (Spec 1 — risk units foundation).
> **Sibling:** Spec 1 — "Risk Units Foundation" (whole-percent convention + single `÷100` converter). This spec assumes that convention: every `*Percent` field is a whole percent at rest, every `*Pct` guardrail is a fraction at runtime.
> **Scope decision:** gate-only (least invasive). SL/TP placement and position sizing are explicitly **unchanged**.

## Problem (root cause, evidence-based)

`minRiskRewardRatio` is supposed to mean "don't take a trade unless the setup offers at least this reward-to-risk." Today it does **not** measure the setup. `RiskPolicy.evaluate` (`src/agents/RiskPolicy.js:44-49`) computes

```js
const rr = g.takeProfitPct / g.stopLossPct;   // a CONSTANT of the config
if (rr < g.minRiskRewardRatio) DENY;
```

That ratio is a property of the *template* (two fixed percentages), identical on every bar regardless of where price sits relative to market structure. It cannot gate by setup quality because it never looks at price geometry.

Meanwhile the **structural stop already exists and is thrown away.** `SignalAdapter` computes `signal.invalidation` — the price level that invalidates the idea — for three logics:

| Logic | `invalidation` source (`src/core/SignalAdapter.js`) |
|---|---|
| SMC | last BOS/CHoCH structure event price (line 16) |
| Breakout | channel bottom (BUY) / top (SELL) (line 46) |
| Reversal | rejection wick low (BUY) / high (SELL) (line 61) |
| VMC / WaveTrend | `null` (no structural level) |

`deriveAgentProposal` forwards it as `invalidationIdea` (`src/agents/deriveAgentProposal.js:54`), and then it dies: `RiskPolicy.evaluate(proposal, ctx)` reads only `proposal.side` / `proposal.conviction`. The structural risk leg never reaches the gate.

**Two consumer wrinkles constrain the design:**
1. **Two proposal shapes reach `evaluate()`.** `src/core/pipeline.js:17` passes the raw numeric `signal` (`signal.invalidation` is a number). `src/agents/AgentOrchestrator.js:69` passes the agent proposal, and the LLM `AnalystAgent` emits invalidation as a **string** ("Invalidate if structure flips against BUY." — `src/agents/AnalystAgent.js:257`), while the deterministic core emits a **number** (`invalidationIdea`). The gate needs a number.
2. **Sizing is fixed notional** (`portfolioValue × riskPerTrade`), independent of stop distance — out of scope here (gate-only), noted so the gate does not pretend to control realized risk-per-trade.

**Latent bug surfaced during design:** two shipped templates set `minRiskRewardRatio` above their own achievable `TP/SL` ratio, so the *current* runtime config-ratio check DENYs them on every bar — they never trade:

| Template | minRR | SL / TP (whole %) | factual TP/SL |
|---|---|---|---|
| `conservative` | 3 | 2 / 5 | **2.5 < 3** |
| `vmc_cipherb_1h_conservative` | 3 | 3 / 8 | **2.67 < 3** |

## Goal

Make `minRiskRewardRatio` gate the **actual setup**: when a numeric structural `invalidation` is available, the risk leg is the entry→invalidation distance, not the fixed stop percent. Keep every existing behavior otherwise — the gate only **adds DENY decisions**, never changes order size or SL/TP prices.

### Success criteria
1. With a valid numeric `invalidation`, a trade is DENYed when `takeProfitPct / (|entry−invalidation|/entry) < minRiskRewardRatio`.
2. With `minRiskRewardRatio` unset or `0`, behavior is **byte-identical** to today (gate inert).
3. With no numeric `invalidation` (null / LLM string / wrong-side / zero-distance), the gate **falls back** to the current config-ratio check — VMC and LLM strategies are unaffected.
4. A template whose `minRiskRewardRatio` exceeds its `TP/SL` ratio is **rejected at validation** (Guard 1), so the "never trades" bug becomes un-shippable.
5. All 11 risk templates pass Guard 1 after the two inconsistent ones are fixed.

## Non-goals (explicitly out of scope)
- Moving SL/TP onto structural levels ("вынос SL/TP за бары"). SL/TP stay fixed percentages of entry.
- Risk-based position sizing (size derived from stop distance). Sizing stays fixed notional.
- Converting the LLM `AnalystAgent` string invalidation into a number.
- The Breakout entry bug (channel built from a window including the current bar) — separate future work.

---

## Design

### 1. Canonical definitions
- **Setup risk leg (fraction):** `riskFrac = |entryPrice − invalidation| / entryPrice`.
- **Setup reward leg (fraction):** `takeProfitPct` (the fixed take-profit fraction from guardrails).
- **Setup RR:** `setupRR = takeProfitPct / riskFrac`.
- **Valid invalidation** (for the structural path) requires ALL of:
  - `invalidation` is a finite number;
  - it is on the correct side of entry — `BUY: invalidation < entryPrice`, `SELL: invalidation > entryPrice`;
  - `riskFrac > 0` (non-zero distance).
- Anything else → **not valid** → fall back to the config-ratio path.

### 2. The pure helper
`src/agents/computeSetupRR.js` — a single pure function, no I/O, unit-tested in isolation:

```js
/**
 * Setup reward:risk from the structural stop. Returns null when there is no
 * valid structural basis (caller then falls back to the config-ratio check).
 * @param {{entryPrice:number, invalidation:(number|null), side:'BUY'|'SELL', takeProfitPct:number}} a
 * @returns {number|null}
 */
export function computeSetupRR({ entryPrice, invalidation, side, takeProfitPct }) {
  if (invalidation == null || !isFinite(invalidation) || !isFinite(entryPrice) || entryPrice <= 0) return null;
  if (takeProfitPct == null || !isFinite(takeProfitPct)) return null;
  const onCorrectSide = side === 'BUY' ? invalidation < entryPrice : side === 'SELL' ? invalidation > entryPrice : false;
  if (!onCorrectSide) return null;
  const riskFrac = Math.abs(entryPrice - invalidation) / entryPrice;
  if (!(riskFrac > 0)) return null;
  return takeProfitPct / riskFrac;
}
```

### 3. The gate (in RiskPolicy)
Replace the current config-ratio block (`RiskPolicy.js:44-49`) with: structural-first, config-ratio fallback.

```
minRR = g.minRiskRewardRatio
if (minRR > 0 && g.stopLossPct > 0 && isFinite(g.takeProfitPct)) {
    const setupRR = computeSetupRR({ entryPrice, invalidation: ctx.invalidation, side: proposal.side, takeProfitPct: g.takeProfitPct });
    if (setupRR != null) {
        if (setupRR < minRR) return DENY(`Setup RR ${setupRR.toFixed(2)} below minimum ${minRR} (structural)`);
    } else {
        const configRR = g.takeProfitPct / g.stopLossPct;   // current behavior, unchanged
        if (configRR < minRR) return DENY(`Risk/reward ${configRR.toFixed(2)} below minimum ${minRR}`);
    }
}
```

Properties:
- `minRR <= 0` (unset/zero) → block skipped entirely → identical to today.
- Gate only returns DENY; it never touches `sizeUSD`, `slPrice`, `tpPrice`, margin, or the futures path.
- The fallback DENY message is the **current** wording (regression-safe); the structural DENY message contains the word "structural".

### 4. Plumbing — `invalidation` via `ctx` (Approach 3)
`evaluate(proposal, ctx)` gains an optional `ctx.invalidation: number|null`. The two callers pass it explicitly:

- **`src/core/pipeline.js`** — change the `evaluate` call to include `invalidation: signal.invalidation ?? null` in the ctx object.
- **`src/agents/AgentOrchestrator.js`** — include
  `invalidation: (typeof proposal.invalidationIdea === 'number' && isFinite(proposal.invalidationIdea)) ? proposal.invalidationIdea : null`.
  The LLM string path therefore yields `null` → fallback (no behavior change for LLM strategies).
- **`src/core/contracts.js`** — extend the `AccountState` JSDoc typedef with `@property {number|null} [invalidation]`. The field is **optional**; absent → `undefined` → treated as no structural basis → fallback. Existing `evaluate` callers and tests remain valid unchanged.

### 5. Guard 1 — schema cross-field consistency
Add a cross-field refinement (mirrors Spec 1's Guard 2 floor; hard reject at validation time) in **both** schemas:

- `src/config_resolver.js` `RiskSchema`
- `src/server/schemas/strategy.schema.js` (`RiskTemplateSchema.settings` and `RiskSettingsSchema`)

Rule: **if `minRiskRewardRatio` is present and `> 0`, then `takeProfitPercent / stopLossPercent >= minRiskRewardRatio`.** When `minRiskRewardRatio` is absent, the refinement is inert. Reject message names the inconsistency, e.g. `minRiskRewardRatio 3 unreachable with TP 5 / SL 2 (ratio 2.5)`.

Rationale (poka-yoke): a template demanding more RR than its own fixed TP/SL can ever produce can never trade. Rejecting it at authoring time makes the "silently never trades" bug un-shippable. Guard 1 validates the *template* (static); the runtime setup gate (§3) validates the *setup* (dynamic).

### 6. Template fixes (raise TP to RR 3)
Bring the two inconsistent templates to `TP/SL == minRR` by widening TP (preserves the "strict RR3" intent and fixes the never-trades bug):

| File | Field | Old (whole %) | New (whole %) | Resulting TP/SL |
|---|---|---|---|---|
| `templates/risk/conservative.json` | takeProfitPercent | 5 | 6 | 6/2 = 3.0 |
| `templates/risk/vmc_cipherb_1h_conservative.json` | takeProfitPercent | 8 | 9 | 9/3 = 3.0 |

No other template sets `minRiskRewardRatio` above its ratio (`aggressive` 3.0 ≥ 1.5; `vmc_cipherb_5m_aggressive` 2.0 ≥ 1.5), so no other file changes. AI: corrected template files flow into `ai_risk_profiles` via `seedTemplates()` `INSERT OR REPLACE` at server startup — no DB migration.

---

## Testing (TDD)

1. **`computeSetupRR` unit** (`tests/test_compute_setup_rr.mjs`, new):
   - BUY normal: entry 100, inval 98, TP 0.06 → riskFrac 0.02 → RR 3.0.
   - SELL normal: entry 100, inval 103, TP 0.06 → riskFrac 0.03 → RR 2.0.
   - Wrong side (BUY, inval 102) → null.
   - Zero distance (inval == entry) → null.
   - `null` / `NaN` invalidation → null.
2. **RiskPolicy gate** (`tests/test_risk_policy.mjs`, extend):
   - (a) `minRR = 0`/unset → PERMIT regardless of invalidation (parity).
   - (b) numeric inval, `setupRR < minRR` → DENY, reason matches `/structural/`.
   - (c) numeric inval, `setupRR >= minRR` → PERMIT.
   - (d) `ctx.invalidation = null` → fallback to config-ratio; the existing block-(d) assertions (rr 2.0 vs min 3 DENY / min 1.5 PERMIT) pass **unchanged**.
   - (e) wrong-side invalidation → fallback (config-ratio) path.
3. **Guard 1 schema** (`tests/test_resolver.js` extend + `tests/test_template_units.mjs` or a new guard test):
   - consistent template (`{minRR:3, SL:2, TP:6}`) resolves.
   - inconsistent (`{minRR:3, SL:2, TP:5}`) → throws `/validation failed/`.
   - `minRR` absent → resolves regardless of TP/SL.
   - all 11 `templates/risk/*.json` pass Guard 1 (loop assertion) after the two fixes.
4. **Backtest regression** (controller-run, not a committed unit test):
   - strategies **without** `minRiskRewardRatio`: matrix numbers unchanged before/after.
   - `conservative` / `vmc_cipherb_1h_conservative`: numbers **change** (previously 0 trades from the latent bug → now entering). Recorded as an expected fix in `docs/research/2026-06-04-smc-strategy-backtest-findings.md`.

## Risks & verification
- **AnalystAgent string invalidation:** intentionally yields `null` → fallback. No regression for LLM strategies; structural gating for the AI path is future work (would require the agent to emit a numeric level).
- **bot_engine.js:** the manual live engine does not call `RiskPolicy.evaluate` (it builds SL/TP directly via the Spec 1 converter). This spec touches only the signal-core / agent paths. The manual engine's RR behavior is unchanged; unifying it is out of scope.
- **Backtest divergence for the two fixed templates is intended** and must be documented so it is not mistaken for a regression.

## Files changed
- `src/agents/computeSetupRR.js` — new pure helper.
- `src/agents/RiskPolicy.js` — structural-first RR gate with config-ratio fallback; reads `ctx.invalidation`.
- `src/core/pipeline.js` — pass `invalidation: signal.invalidation ?? null` into `evaluate`.
- `src/agents/AgentOrchestrator.js` — pass numeric `proposal.invalidationIdea` (else null) into `evaluate`.
- `src/core/contracts.js` — `AccountState` JSDoc gains optional `invalidation`.
- `src/config_resolver.js` — `RiskSchema`: Guard 1 cross-field refine.
- `src/server/schemas/strategy.schema.js` — mirror Guard 1.
- `templates/risk/conservative.json` — TP 5 → 6.
- `templates/risk/vmc_cipherb_1h_conservative.json` — TP 8 → 9.
- `tests/test_compute_setup_rr.mjs` (new), `tests/test_risk_policy.mjs` (extend), `tests/test_resolver.js` (extend), template-guard test.
- `docs/research/2026-06-04-smc-strategy-backtest-findings.md` — record the expected backtest change for the two fixed templates.
