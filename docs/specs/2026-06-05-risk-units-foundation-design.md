# Risk Units Foundation — Design Spec (Spec 1 of 2)

> **Status:** Approved design, ready for implementation plan.
> **Branch:** `refactor/risk-config-foundation`
> **Sibling:** Spec 2 — "Structural Risk" (setup-based RR gate + `invalidation` wiring) builds on this.

## Problem (root cause, evidence-based)

There is **no single enforced unit convention** for percent fields in risk config. The field
name says `*Percent`, the validation schema says `[0,100]` (whole percent), but the template
files are authored in **fractions** (`0.02`), and **three consumer paths interpret the same
number differently** — two with opposite normalization philosophies:

| Path | Code | Reads `conservative.stopLossPercent: 0.02` as |
|---|---|---|
| Manual live | `bot_engine.js:604` → `risk.stopLossPercent / 100` | `0.0002` = **0.02% stop** ❌ |
| Backtest | `riskProfileToGuardrails.js:29` → `normFraction(0.02)` | `0.02` = **2% stop** ✓ |
| AI live | `paramResolver.js:40` → `normFraction(0.02)` (own copy) | `0.02` = **2% stop** ✓ |

**Consequence:** the same template = 2% in backtest but 0.02% in the manual live engine — a
**100× divergence**, so the backtest does not validate live behavior. The mirror failure: a
whole-percent value like `scalp_alts.stopLossPercent: 1.0` becomes **100%** in backtest
(`normFraction`'s `v>1` boundary fails at exactly 1.0) but a correct 1% in the manual engine.

Root: `normFraction(v) = v > 1 ? v/100 : v` is a heuristic that **cannot disambiguate** any
value in `(0, 1]` (is `0.5` "half a percent" or "50%"?), and it is **not even applied** on the
manual path (which hard-divides by 100). The schema (`z.number().min(0).max(100)`) neither
documents nor enforces the real convention.

## Goal

**One canonical unit convention + one converter, so that `manual == backtest == AI` produce
identical guardrails for the same template.** Make the codebase trustworthy: the backtest
reflects live, and the unit-confusion class of bug becomes impossible to reintroduce.

### Success criteria
1. The same risk template produces **byte-identical** guardrails through all three entry paths.
2. Sub-1% values work correctly (`0.5%` → `0.005`, previously broken by `normFraction`).
3. `normFraction` heuristic is **deleted** (both copies).
4. Existing backtest results (the §6 robust cells in the SMC findings report) are **unchanged**
   after template migration (the resulting fractions are identical).

## Non-goals (deferred to Spec 2 — Structural Risk)
- Setup-based RR gate (entry only when the actual setup offers ≥ minRR, using `invalidation`).
- Wiring `signal.invalidation` (structural stop) into SL/TP placement.
- Guard 1 (cross-field `TP/SL ≥ minRiskRewardRatio` template-consistency check) — its form
  depends on the RR-gate redesign, so it lands in Spec 2 to avoid immediate rework.

---

## Design

### 1. Canonical convention
- **Storage = whole percents** (`2` means 2%) everywhere: `templates/risk/*.json`,
  `ai_risk_profiles` DB columns, validation schemas, UI forms, AI output.
- **Runtime = fractions** (`*Pct` in the `guardrails` object).
- Rationale: the field name (`*Percent`), the schema range `[0,100]`, the UI inputs, natural AI
  output ("stop 2 percent" → `2`), and the already-whole template fields
  (`maxPortfolioHeatPercent: 15`) all point to whole percent. Only the internal guardrails and
  backtest are fractional — an internal layer where one explicit conversion is appropriate.

### 2. The single converter (one boundary)
`src/agents/riskProfileToGuardrails.js` becomes **the** percent→fraction boundary.

- Replace `normFraction(v) = v>1 ? v/100 : v` with an explicit, unconditional
  `toFraction(v) = (v == null || !isFinite(v)) ? v : v / 100` applied to **percent fields only**.
- No `v>1` guessing → no `(0,1]` ambiguity → sub-1% values (`0.5 → 0.005`) and exactly-1.0
  (`1.0 → 0.01`) both convert correctly.
- Field classification is unchanged from today:
  - **Percent → ÷100:** `riskPerTradePercent`, `stopLossPercent`, `takeProfitPercent`,
    `maxPortfolioHeatPercent`, `dailyLossLimitPercent`, `dailyProfitTargetPercent`.
  - **Counts/ratios → untouched:** `maxTradesPerDay`, `minRiskRewardRatio`, `maxOpenPositions`,
    `maxTradeSizeUSD`, `portfolioValue`.
- **Input shape:** camelCase `*Percent` settings (the shape `config_resolver` already emits).

### 3. Three paths route through the one converter

```
templates/risk/*.json (whole %)              ai_risk_profiles (whole %, seeded at startup)
        |                                              |
   config_resolver (merge template + override)   paramResolver (snake_case -> camelCase)
        |                                              |
        +----------------------+------------------------+
                               v
                 riskProfileToGuardrails()   <-- THE single /100
                               v
                    guardrails (*Pct = fractions)
                               v
        +----------------------+----------------------+
   bot_engine             RiskPolicy             simulate (backtest)
   (live manual)          (signal-core)
```

- **`bot_engine.js`:** delete inline `/100` (lines 604, 635). Build guardrails via
  `riskProfileToGuardrails(strategyConfig.risk)`, then compute SL/TP from `guardrails.stopLossPct`
  / `guardrails.takeProfitPct` (fractions). Existing direct reads (e.g. `risk.maxTradesPerDay`
  at line 291) switch to the corresponding guardrails field (same value, not a percent).
- **`paramResolver.js`:** delete its private `normFraction` copy; map the snake_case DB row to
  camelCase `*Percent` and **delegate** the guardrails block to `riskProfileToGuardrails`
  (the file's own TODO comment already anticipates this).
- **Backtest** (`run-matrix.js` via `riskProfileToGuardrails`) is already correct; the `.mjs`
  sweep scripts build fractional guardrails directly and **bypass the converter** — unaffected.

### 4. Template migration (whole percent)
Convert fraction-authored `*Percent` fields to whole percent. Explicit per-file edits (no
heuristic auto-multiply — best practice for data migration). Known examples:

| File | Field | Old (fraction) | New (whole %) |
|---|---|---|---|
| `aggressive.json` | stopLossPercent | 0.05 | 5 |
| `aggressive.json` | takeProfitPercent | 0.15 | 15 |
| `aggressive.json` | riskPerTradePercent | 0.05 | 5 |
| `conservative.json` | stopLossPercent | 0.02 | 2 |
| `conservative.json` | takeProfitPercent | 0.05 | 5 |
| `conservative.json` | riskPerTradePercent | 0.01 | 1 |

Already-whole fields (`maxPortfolioHeatPercent: 15`, `dailyLossLimitPercent: 5`, and
`scalp_alts` `stopLossPercent: 1.0` → stays `1`, `takeProfitPercent: 2.5` → stays `2.5`) are
unchanged. **All 14 `templates/risk/*.json` must be audited** and each `*Percent` field set to
its intended whole-percent value explicitly during implementation.

**Genuinely ambiguous values require author intent, not a guess.** Example:
`scalp_alts.riskPerTradePercent: 0.25` could mean 0.25% (ultra-conservative scalp — plausible at
100 trades/day) or a leftover fraction for 25% (suicidal). The implementer must resolve each
ambiguous value by the strategy's intent (here: 0.25% is the sane reading → stays `0.25`), and
flag any it cannot resolve for a human decision rather than guessing.

AI: no DB migration needed — `aiStrategyService.seedTemplates()` runs `INSERT OR REPLACE` on
template profiles at server startup, so corrected template files flow into `ai_risk_profiles`.

### 5. Schema (validation) — Guard 2 only
- `src/config_resolver.js` `RiskSchema` and `src/server/schemas/strategy.schema.js`: keep the
  `[0,100]` upper bound (whole percent), and **add a sanity floor (Guard 2):**
  `stopLossPercent` and `takeProfitPercent` must be `>= 0.1`.
  - Rationale (defense-in-depth / poka-yoke): a sub-0.1% stop/target is non-economic on crypto
    (taker fee ~0.06% each side + slippage) and is the signature of a leftover fraction value
    (`0.02` meaning "2%"). Rejecting it at the boundary makes the unit-confusion bug
    un-reintroducible.
- **Guard 1 deferred** to Spec 2 (it is RR logic; its form changes with the RR-gate redesign).

---

## Testing (TDD)

1. **Converter unit tests** (`tests/test_risk_profile_to_guardrails.js`, extend):
   - whole percents: `stopLossPercent: 2` → `stopLossPct: 0.02`.
   - sub-1%: `0.5` → `0.005` (regression for the `normFraction` bug).
   - boundary: `1.0` → `0.01` (previously `normFraction` gave `1.0` = 100%).
   - counts/ratios untouched: `minRiskRewardRatio: 3` stays `3`, `maxTradesPerDay: 10` stays `10`.
2. **Parity test (the key guarantee):** one fixture template → guardrails via each entry
   (`config_resolver` → converter, `paramResolver` → converter, direct converter) → assert all
   three are **deep-equal**.
3. **Backtest regression:** assert a representative cell (e.g. SMC XLM 1H) yields the same
   `netPnlPct` after migration as before (fractions identical → numbers identical).
4. **`scalp_alts` correctness:** `stopLossPercent: 1` → `0.01` (1%) in all paths (was 100% in
   backtest pre-fix).
5. **Schema guard:** `stopLossPercent: 0.02` (leftover fraction) is **rejected** by the schema.

## Risks & verification
- **Agent-owned AI profiles** (`ai_risk_profiles` with `is_template = 0`, created via
  `createRiskProfile`) are **not** overwritten by `seedTemplates`. Verification step: query for
  such rows; if any exist with fraction-convention values, convert or recreate them point-wise.
- **Existing manual strategies** (`trading_lab.db`) store override values. They are override-on-
  base and easily re-saved at strategy creation; paper-trading (`paperTrading: true`) keeps the
  stakes low. Verification step: spot-check the live strategies (#32/#35/#41/#43) after the fix.
- **bot_engine refactor** is the highest-touch change (live path). Covered by the parity test
  and a manual smoke run before any live use.

## Files changed
- `src/agents/riskProfileToGuardrails.js` — `normFraction` → explicit `toFraction` (÷100).
- `src/agents/paramResolver.js` — delete local `normFraction`; delegate to the converter.
- `bot_engine.js` — remove inline `/100`; route through the converter; read `*Pct` fractions.
- `src/config_resolver.js` — `RiskSchema`: add Guard 2 floor on SL/TP.
- `src/server/schemas/strategy.schema.js` — mirror Guard 2 floor.
- `templates/risk/*.json` — migrate all `*Percent` fields to whole percent (audit all 14).
- `tests/test_risk_profile_to_guardrails.js` (+ new parity & regression tests).
