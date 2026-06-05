# Risk Units Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish one canonical unit convention (whole percents, `2` = 2%) with a single percent→fraction converter so the manual, backtest, and AI paths produce identical guardrails for the same risk template.

**Architecture:** `riskProfileToGuardrails()` becomes THE single conversion boundary (whole percent → fraction, explicit `÷100`, no `normFraction` heuristic). `paramResolver` (AI) delegates to it; `bot_engine` (manual live) routes through it instead of dividing by 100 inline. Templates are migrated to whole percent. A schema sanity-floor (Guard 2) makes the unit-confusion bug un-reintroducible.

**Tech Stack:** Node.js ESM, zod (validation), node:assert (tests run via `node tests/<file>.js`).

**Spec:** `docs/specs/2026-06-05-risk-units-foundation-design.md`

---

## Background the implementer needs

The bug: percent fields have no enforced unit convention. Three paths read the same stored number differently:
- `bot_engine.js` (manual live) divides by 100 → assumes **whole percent**.
- `riskProfileToGuardrails.js` (backtest) and `paramResolver.js` (AI) use `normFraction(v)=v>1?v/100:v` → a heuristic that breaks for any value in `(0,1]`.

Result: `conservative.stopLossPercent: 0.02` = 2% in backtest but 0.02% in live (100× off). And `scalp_majors.stopLossPercent: 0.3` (meant 0.3%) becomes 30% in backtest. We standardize on **whole percent everywhere**, convert once.

**Template convention audit (which files are fraction-authored vs already whole):**
- **Fraction-authored (need ×100 on risk/SL/TP):** `aggressive`, `conservative`, `vmc_cipherb`, `vmc_cipherb_5m_aggressive`, `vmc_cipherb_1h_conservative`.
- **Already whole percent (no change):** `scalp_alts`, `scalp_majors`, `scalping_fast`, `vmc_scalping`, `yt1_reversal`, `test_risk`.

**Test runner:** there is no `npm test`. Each test file is standalone: `node tests/<file>.js` exits 0 on success, throws (non-zero) on a failed `assert`.

---

## Task 1: Convert `riskProfileToGuardrails` to explicit ÷100

**Files:**
- Modify: `src/agents/riskProfileToGuardrails.js:10-13` (the `normFraction` function) and `:28` (default).
- Test: `tests/test_risk_profile_to_guardrails.js` (replace the fractional-passthrough case).

- [ ] **Step 1: Rewrite the converter's percent tests to assert the whole-percent convention**

In `tests/test_risk_profile_to_guardrails.js`, **replace block `// 2.` (lines 33-45, the "already-fractional inputs pass through" case)** with this whole-percent + boundary + sub-1% block:

```js
// 2. whole-percent sub-1 and boundary values convert correctly (no v>1 heuristic)
{
  const g = riskProfileToGuardrails({
    riskPerTradePercent: 0.5,   // 0.5% scalp risk
    stopLossPercent: 0.3,       // 0.3% scalp stop
    takeProfitPercent: 0.8,     // 0.8% scalp target
    maxPortfolioHeatPercent: 1, // 1%
    dailyLossLimitPercent: 1,   // 1%
  });
  assert.strictEqual(g.riskPerTrade, 0.005);
  assert.strictEqual(g.stopLossPct, 0.003);
  assert.strictEqual(g.takeProfitPct, 0.008);
  assert.strictEqual(g.maxPortfolioHeatPct, 0.01);
  assert.strictEqual(g.dailyLossLimitPct, 0.01);
  ok('sub-1% whole percents convert via plain /100');
}

// 2b. exactly-1.0 converts to 1% (the old normFraction boundary bug gave 100%)
{
  const g = riskProfileToGuardrails({ stopLossPercent: 1.0, takeProfitPercent: 2.5 });
  assert.strictEqual(g.stopLossPct, 0.01);
  assert.strictEqual(g.takeProfitPct, 0.025);
  ok('boundary 1.0 -> 1% (not 100%)');
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/test_risk_profile_to_guardrails.js`
Expected: FAIL — current `normFraction(0.3)` returns `0.3` (not `0.003`), so the first assert throws `0.3 !== 0.003`.

- [ ] **Step 3: Replace `normFraction` with explicit `toFraction` and fix the default**

In `src/agents/riskProfileToGuardrails.js`, replace lines 3-13 (the doc comment + `normFraction`) with:

```js
/**
 * Convert a stored WHOLE-PERCENT value (e.g. 2 -> 2%) into a runtime FRACTION (0.02).
 * The canonical unit convention is whole percents everywhere (templates, DB, schema, UI);
 * this is the single ÷100 boundary. No heuristics: every percent field is divided by 100.
 * null/undefined/non-finite pass through unchanged (so absent optional gates stay absent).
 */
function toFraction(v) {
  if (v == null || !isFinite(v)) return v;
  return v / 100;
}
```

Then in the same file, replace every `normFraction(` call with `toFraction(`, and change the riskPerTrade default on line 28 from `?? 0.01` to `?? 1` (so the absent-value fallback is 1% under the whole-percent convention):

```js
    riskPerTrade: toFraction(s.riskPerTradePercent ?? 1),
    stopLossPct: toFraction(s.stopLossPercent),
    takeProfitPct: toFraction(s.takeProfitPercent),
    maxTradeSizeUSD: s.maxTradeSizeUSD ?? Infinity,
    maxOpenPositions: s.maxOpenPositions ?? Infinity,
    maxPortfolioHeatPct: toFraction(s.maxPortfolioHeatPercent) ?? Infinity,
    dailyLossLimitPct: toFraction(s.dailyLossLimitPercent) ?? Infinity,
    dailyProfitTargetPct: toFraction(s.dailyProfitTargetPercent),
```

(Leave `maxTradesPerDay`, `minRiskRewardRatio`, `portfolioValue`, `leverage`, `mmr` exactly as they are — they are not percents.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/test_risk_profile_to_guardrails.js`
Expected: PASS — all checks, including the new sub-1% and boundary cases, and the existing whole-number block #1 (`5 -> 0.05`) which is unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/agents/riskProfileToGuardrails.js tests/test_risk_profile_to_guardrails.js
git commit -m "fix(risk): converter uses explicit /100 (whole-percent convention), drop normFraction heuristic

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Delegate `paramResolver` (AI path) to the single converter

**Files:**
- Modify: `src/agents/paramResolver.js:1-7` (delete local `normFraction`) and `:24-60` (`resolveAgentParams`).
- Test: `tests/test_risk_profile_to_guardrails.js` blocks `// 5.` and `// 6.` already lock parity — they must stay green.

- [ ] **Step 1: Confirm the parity tests exist and currently pass**

Run: `node tests/test_risk_profile_to_guardrails.js`
Expected: PASS (blocks 5 and 6 assert `resolveAgentParams(...).guardrails` deep-equals `riskProfileToGuardrails(...)`). These are the regression lock for this task.

- [ ] **Step 2: Rewrite `paramResolver.js` to delegate the guardrails block**

Replace the entire contents of `src/agents/paramResolver.js` with:

```js
// src/agents/paramResolver.js
import { riskProfileToGuardrails } from './riskProfileToGuardrails.js';

export function posturePhrase(riskPerTradeFraction) {
  const r = riskPerTradeFraction;
  if (r == null || !isFinite(r)) return 'balanced — moderate risk for steady growth';
  if (r <= 0.01) return 'conservative — prioritize capital preservation';
  if (r >= 0.04) return 'aggressive — pursue larger moves, accept higher risk';
  return 'balanced — moderate risk for steady growth';
}

/**
 * Split a flat agent config into three labeled blocks.
 * Guardrails are produced by the single canonical converter (riskProfileToGuardrails),
 * which expects camelCase *Percent whole-percent settings, so we map the snake_case DB row.
 * @param {object} agent       ai_strategies row (snake_case)
 * @param {object} riskProfile ai_risk_profiles row (snake_case) or {}
 * @param {string[]} indicators resolved indicator names
 * @param {object} indicatorDescriptions name -> description
 */
export function resolveAgentParams(agent, riskProfile = {}, indicators = ['SMC'], indicatorDescriptions = {}) {
  const rp = riskProfile || {};
  const symbols = (agent.watchlist || 'BTCUSDT,ETHUSDT').split(',').map(s => s.trim()).filter(Boolean);

  const guardrails = riskProfileToGuardrails({
    riskPerTradePercent: rp.risk_per_trade_percent ?? 1,
    stopLossPercent: rp.stop_loss_percent,
    takeProfitPercent: rp.take_profit_percent,
    maxTradeSizeUSD: rp.max_trade_size_usd,
    maxOpenPositions: rp.max_open_positions,
    maxPortfolioHeatPercent: rp.max_portfolio_heat_percent,
    dailyLossLimitPercent: rp.daily_loss_limit_percent,
    dailyProfitTargetPercent: rp.daily_profit_target_percent,
    maxTradesPerDay: rp.max_trades_per_day,
    minRiskRewardRatio: rp.min_risk_reward_ratio,
    portfolioValue: agent.portfolio_value || 10000,
  });

  return {
    llmContext: {
      timeframe: agent.timeframe || '1H',
      indicators,
      indicatorDescriptions,
      watchlist: symbols,
      tradeMode: agent.trade_mode || 'spot',
      posture: posturePhrase(guardrails.riskPerTrade),
    },
    guardrails,
    execution: {
      agentId: Number(agent.id),
      paperTrading: true, // real-mode safety until exchange accounts exist
      tradeMode: agent.trade_mode || 'spot',
      cycleInterval: agent.cycle_interval_ms || 300000,
      symbols,
    },
  };
}
```

Note: `riskProfileToGuardrails` does not set `leverage`/`mmr` unless passed, but it always returns those keys (defaults `leverage:1, mmr:null`). The parity tests compare only the keys the live path produces via `Object.keys(live)`, and `live` now IS the converter output — so block 5 compares the object to itself for those keys and block 6's `dailyProfitTargetPct === undefined` still holds (absent → `toFraction(undefined)` → `undefined`). Both stay green.

- [ ] **Step 3: Update `test_param_resolver.mjs` fixture to whole percent (it currently encodes fractions)**

This test passes today only because `normFraction` lets fractions through. Its `profile` uses
fraction values (`risk_per_trade_percent: 0.02`, `stop_loss_percent: 0.05`,
`take_profit_percent: 0.1`) and asserts `riskPerTrade === 0.02`, `stopLossPct === 0.05`. Under the
new converter those become `0.0002`/`0.0005`, so the fixture must be rewritten to the whole-percent
values that yield the SAME guardrails.

In `tests/test_param_resolver.mjs`, change the `profile` object (lines 14-19) — only the three
percent fields move; counts/ratios already-whole fields stay:

```js
const profile = {
  risk_per_trade_percent: 2, stop_loss_percent: 5, take_profit_percent: 10,
  max_trade_size_usd: 250, max_open_positions: 3, max_portfolio_heat_percent: 10,
  daily_loss_limit_percent: 5, daily_profit_target_percent: 8,
  max_trades_per_day: 10, min_risk_reward_ratio: 1.5,
};
```

Also change the `bare` profile on line 41 from `{ risk_per_trade_percent: 0.02 }` to
`{ risk_per_trade_percent: 2 }`, and update the comment on line 29 to `// guardrails normalized to
FRACTIONS (whole percent / 100: 5 -> 0.05)`. The existing assertions (`riskPerTrade === 0.02`,
`stopLossPct === 0.05`, `maxPortfolioHeatPct === 0.10`, `dailyLossLimitPct === 0.05`, posture
`balanced`) then all hold because `2/100=0.02`, `5/100=0.05`, `10/100=0.10`.

- [ ] **Step 4: Run the parity + param-resolver tests**

Run: `node tests/test_risk_profile_to_guardrails.js && node tests/test_param_resolver.mjs`
Expected: PASS for both — `OK test_param_resolver` and the parity checks.

- [ ] **Step 5: Commit**

```bash
git add src/agents/paramResolver.js tests/test_param_resolver.mjs
git commit -m "refactor(risk): paramResolver delegates guardrails to the single converter

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Route `bot_engine` (manual live) through the converter

**Files:**
- Modify: `bot_engine.js` — import (top, near line 6), sizing (`:518-523`), paper SL/TP (`:604-605`), live SL/TP (`:635-636`).
- Test: `tests/test_bot_engine_sl.mjs` (new) — asserts the SL/TP price formula a known template produces, documenting expected live behavior.

- [ ] **Step 1: Write a failing test for the live SL/TP math**

Create `tests/test_bot_engine_sl.mjs`:

```js
// tests/test_bot_engine_sl.mjs
// Locks the SL/TP prices bot_engine should produce for a known whole-percent risk profile,
// computed through the single converter (no inline /100). Mirrors bot_engine's formula.
import assert from 'node:assert';
import { riskProfileToGuardrails } from '../src/agents/riskProfileToGuardrails.js';

// conservative.json AFTER migration: SL 2(%), TP 5(%), risk 1(%)
const g = riskProfileToGuardrails({
  riskPerTradePercent: 1, stopLossPercent: 2, takeProfitPercent: 5, portfolioValue: 1000,
});
const price = 100;

// BUY: SL below, TP above
const slBuy = price * (1 - g.stopLossPct);
const tpBuy = price * (1 + g.takeProfitPct);
assert.strictEqual(slBuy, 98, `BUY SL should be 2% below (98), got ${slBuy}`);
assert.strictEqual(tpBuy, 105, `BUY TP should be 5% above (105), got ${tpBuy}`);

// position sizing: portfolioValue * riskPerTrade (fraction), no /100
const baseRiskUSD = g.portfolioValue * g.riskPerTrade;
assert.strictEqual(baseRiskUSD, 10, `1% of 1000 should be 10, got ${baseRiskUSD}`);

console.log('  ok - bot_engine SL/TP/size math via converter (2% -> 98/105, 1% -> $10)');
```

- [ ] **Step 2: Run it to confirm it passes against the converter (this is the target behavior)**

Run: `node tests/test_bot_engine_sl.mjs`
Expected: PASS — it tests the converter contract bot_engine must adopt. (It documents the target; the real change is making bot_engine use these values instead of `risk.stopLossPercent / 100`.)

- [ ] **Step 3: Add the converter import to `bot_engine.js`**

Below the existing import on line 6 (`import { resolveConfig } from "./src/config_resolver.js";`), add:

```js
import { riskProfileToGuardrails } from "./src/agents/riskProfileToGuardrails.js";
```

- [ ] **Step 4: Build guardrails and fix the sizing math**

Replace `bot_engine.js:518-523`:

```js
  const risk = strategyConfig.risk;
  const portfolioValue = risk.portfolioValue;
  const riskPercent = risk.riskPerTradePercent;

  const baseRiskUSD = portfolioValue * (riskPercent / 100);
```

with:

```js
  const risk = strategyConfig.risk;
  const guardrails = riskProfileToGuardrails(risk);
  const portfolioValue = guardrails.portfolioValue;

  const baseRiskUSD = portfolioValue * guardrails.riskPerTrade;
```

- [ ] **Step 5: Fix the paper-trade SL/TP (lines 604-605)**

Replace:

```js
                  stopLoss: precisionManager.format(side === "BUY" ? price * (1 - risk.stopLossPercent / 100) : price * (1 + risk.stopLossPercent / 100), symbol),
                  takeProfit: precisionManager.format(side === "BUY" ? price * (1 + risk.takeProfitPercent / 100) : price * (1 - risk.takeProfitPercent / 100), symbol),
```

with:

```js
                  stopLoss: precisionManager.format(side === "BUY" ? price * (1 - guardrails.stopLossPct) : price * (1 + guardrails.stopLossPct), symbol),
                  takeProfit: precisionManager.format(side === "BUY" ? price * (1 + guardrails.takeProfitPct) : price * (1 - guardrails.takeProfitPct), symbol),
```

- [ ] **Step 6: Fix the live-order SL/TP (lines 635-636)**

Replace:

```js
                      stopLoss: side === "BUY" ? price * (1 - risk.stopLossPercent / 100) : price * (1 + risk.stopLossPercent / 100),
                      takeProfit: side === "BUY" ? price * (1 + risk.takeProfitPercent / 100) : price * (1 - risk.takeProfitPercent / 100),
```

with:

```js
                      stopLoss: side === "BUY" ? price * (1 - guardrails.stopLossPct) : price * (1 + guardrails.stopLossPct),
                      takeProfit: side === "BUY" ? price * (1 + guardrails.takeProfitPct) : price * (1 - guardrails.takeProfitPct),
```

- [ ] **Step 7: Sanity-check the file parses and the test still passes**

Run: `node --check bot_engine.js && node tests/test_bot_engine_sl.mjs`
Expected: `node --check` prints nothing (syntax OK); the test prints its `ok` line.

- [ ] **Step 8: Commit**

```bash
git add bot_engine.js tests/test_bot_engine_sl.mjs
git commit -m "fix(engine): bot_engine routes risk through the single converter, removes inline /100

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Migrate the 5 fraction-authored templates to whole percent

**Files (modify each):**
- `templates/risk/aggressive.json`, `templates/risk/conservative.json`, `templates/risk/vmc_cipherb.json`, `templates/risk/vmc_cipherb_5m_aggressive.json`, `templates/risk/vmc_cipherb_1h_conservative.json`
- Test: `tests/test_template_units.mjs` (new)

Only `riskPerTradePercent`, `stopLossPercent`, `takeProfitPercent` change (×100). Heat/daily fields are already whole and stay. The other 6 templates are already whole percent — do not touch them.

- [ ] **Step 1: Write a failing test asserting migrated values land in a sane fraction range**

Create `tests/test_template_units.mjs`:

```js
// tests/test_template_units.mjs
// After migration, every risk template's SL/TP must convert to a sane fraction band:
// 0.001 (0.1%) <= pct <= 0.5 (50%). Catches both leftover fractions (too small) and
// un-migrated 30%-style values (too big).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { riskProfileToGuardrails } from '../src/agents/riskProfileToGuardrails.js';

const dir = path.join(process.cwd(), 'templates', 'risk');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
let checked = 0;
for (const f of files) {
  const json = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const s = json.settings || json.content?.settings || {};
  if (s.stopLossPercent == null) continue;
  const g = riskProfileToGuardrails(s);
  assert.ok(g.stopLossPct >= 0.001 && g.stopLossPct <= 0.5,
    `${f}: stopLossPct ${g.stopLossPct} out of sane band (0.001..0.5)`);
  assert.ok(g.takeProfitPct >= 0.001 && g.takeProfitPct <= 0.6,
    `${f}: takeProfitPct ${g.takeProfitPct} out of sane band (0.001..0.6)`);
  checked++;
}
console.log(`  ok - ${checked} risk templates have sane SL/TP fractions after conversion`);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/test_template_units.mjs`
Expected: FAIL — pre-migration, `aggressive.stopLossPercent: 0.05` → `0.0005` (< 0.001) throws; or `scalp_majors.stopLossPercent: 0.3` → `0.003` is fine, but the fraction files break the band.

- [ ] **Step 3: Edit `templates/risk/aggressive.json`**

Change `riskPerTradePercent: 0.05` → `5`, `stopLossPercent: 0.05` → `5`, `takeProfitPercent: 0.15` → `15`. (Inside the `content.settings` object. Leave `maxPortfolioHeatPercent: 15`, `dailyLossLimitPercent: 5`, `dailyProfitTargetPercent: 10`, `minRiskRewardRatio: 1.5`, `maxOpenPositions: 8`, `maxTradeSizeUSD: 500`, `portfolioValue: 1000`, `maxTradesPerDay: 10` unchanged.)

- [ ] **Step 4: Edit `templates/risk/conservative.json`**

Change `riskPerTradePercent: 0.01` → `1`, `stopLossPercent: 0.02` → `2`, `takeProfitPercent: 0.05` → `5`. (Leave heat 5, dailyLoss 2, dailyProfit 5, minRR 3, maxOpen 3, etc. unchanged.)

- [ ] **Step 5: Edit `templates/risk/vmc_cipherb.json`**

Change `riskPerTradePercent: 0.01` → `1`, `stopLossPercent: 0.02` → `2`, `takeProfitPercent: 0.05` → `5`.

- [ ] **Step 6: Edit `templates/risk/vmc_cipherb_5m_aggressive.json`**

Change `riskPerTradePercent: 0.01` → `1`, `stopLossPercent: 0.015` → `1.5`, `takeProfitPercent: 0.03` → `3`. (Leave heat 5.0, dailyLoss 2.0, dailyProfit 5.0, minRR 1.5 unchanged.)

- [ ] **Step 7: Edit `templates/risk/vmc_cipherb_1h_conservative.json`**

Change `riskPerTradePercent: 0.01` → `1`, `stopLossPercent: 0.03` → `3`, `takeProfitPercent: 0.08` → `8`. (Leave heat 3.0, dailyLoss 1.0, dailyProfit 3.0, minRR 3.0 unchanged.)

- [ ] **Step 8: Run the test to verify it passes**

Run: `node tests/test_template_units.mjs`
Expected: PASS — all templates now convert into the sane band (e.g. `conservative` SL `2 -> 0.02`, `aggressive` SL `5 -> 0.05`, `scalp_majors` SL `0.3 -> 0.003`).

- [ ] **Step 9: Commit**

```bash
git add templates/risk/aggressive.json templates/risk/conservative.json templates/risk/vmc_cipherb.json templates/risk/vmc_cipherb_5m_aggressive.json templates/risk/vmc_cipherb_1h_conservative.json tests/test_template_units.mjs
git commit -m "fix(templates): migrate 5 fraction-authored risk templates to whole percent

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Add Guard 2 (sanity floor) to the validation schemas

**Files:**
- Modify: `src/config_resolver.js:6-18` (`RiskSchema`), `src/server/schemas/strategy.schema.js:13-34` (`RiskTemplateSchema`, `RiskSettingsSchema`).
- Test: `tests/test_risk_schema_guard.mjs` (new)

Guard 2: `stopLossPercent`/`takeProfitPercent` must be `>= 0.1` (a sub-0.1% stop is non-economic on crypto and is the signature of a leftover fraction). Keep the existing `<= 100` upper bound.

- [ ] **Step 1: Write a failing test for the schema guard**

Create `tests/test_risk_schema_guard.mjs`:

```js
// tests/test_risk_schema_guard.mjs
import assert from 'node:assert';
import { RiskSettingsSchema, RiskTemplateSchema } from '../src/server/schemas/strategy.schema.js';

// A leftover fraction (0.02 meaning "2%") must be REJECTED by the floor.
const badSnake = {
  risk_per_trade_percent: 1, stop_loss_percent: 0.02, take_profit_percent: 5,
  min_risk_reward_ratio: 2, max_portfolio_heat_percent: 5, max_open_positions: 2,
  max_trades_per_day: 5, daily_loss_limit_percent: 2, daily_profit_target_percent: 5,
};
assert.strictEqual(RiskSettingsSchema.safeParse(badSnake).success, false, 'SL 0.02 must be rejected');

// A whole-percent value (2 = 2%) must PASS.
assert.strictEqual(RiskSettingsSchema.safeParse({ ...badSnake, stop_loss_percent: 2 }).success, true, 'SL 2 must pass');

// A legit tight scalp stop (0.3 = 0.3%) must PASS (>= 0.1 floor).
assert.strictEqual(RiskSettingsSchema.safeParse({ ...badSnake, stop_loss_percent: 0.3 }).success, true, 'SL 0.3 must pass');

// Template schema (camelCase) floor too.
const okTemplate = { name: 'X', settings: { riskPerTradePercent: 1, maxTradeSizeUSD: 100, stopLossPercent: 2, takeProfitPercent: 5, maxTradesPerDay: 5 } };
assert.strictEqual(RiskTemplateSchema.safeParse(okTemplate).success, true, 'whole-percent template passes');
const badTemplate = { ...okTemplate, settings: { ...okTemplate.settings, stopLossPercent: 0.05 } };
assert.strictEqual(RiskTemplateSchema.safeParse(badTemplate).success, false, 'SL 0.05 template rejected');

console.log('  ok - schema Guard 2 floors SL/TP at 0.1 (rejects leftover fractions, passes scalp 0.3)');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/test_risk_schema_guard.mjs`
Expected: FAIL — current schema has `.positive()` / `.min(0)` with no `0.1` floor, so `stop_loss_percent: 0.02` is accepted and the first assert throws.

- [ ] **Step 3: Add the floor in `src/server/schemas/strategy.schema.js`**

In `RiskTemplateSchema.settings` change:

```js
    stopLossPercent: z.number().positive(),
    takeProfitPercent: z.number().positive(),
```
to:
```js
    stopLossPercent: z.number().min(0.1).max(100),
    takeProfitPercent: z.number().min(0.1).max(100),
```

In `RiskSettingsSchema` change:

```js
  stop_loss_percent: z.number().positive().max(100),
  take_profit_percent: z.number().positive().max(100),
```
to:
```js
  stop_loss_percent: z.number().min(0.1).max(100),
  take_profit_percent: z.number().min(0.1).max(100),
```

- [ ] **Step 4: Add the same floor in `src/config_resolver.js` `RiskSchema`**

Change:

```js
  stopLossPercent: z.number().min(0).max(100),
  takeProfitPercent: z.number().min(0).max(100),
```
to:
```js
  stopLossPercent: z.number().min(0.1).max(100),
  takeProfitPercent: z.number().min(0.1).max(100),
```

- [ ] **Step 5: Complete the `test_resolver.js` fixture so it exercises `config_resolver`'s `RiskSchema` floor**

`test_resolver.js` currently FAILS (pre-existing, unrelated to units): its `test_risk.json`
fixture has only 5 fields but `config_resolver`'s `RiskSchema` requires 11, so `resolveConfig`
throws on missing `portfolioValue`/`minRiskRewardRatio`/`maxPortfolioHeatPercent`/
`maxOpenPositions`/`dailyLossLimitPercent`/`dailyProfitTargetPercent`. Complete the fixture (all
whole percent) so Test 1 passes and the `config_resolver` floor (Step 4) is exercised. In
`tests/test_resolver.js`, replace the `fs.writeFileSync(...'test_risk.json'...)` settings (lines
13-21) with:

```js
  fs.writeFileSync(path.join(riskDir, 'test_risk.json'), JSON.stringify({
    settings: {
      maxTradesPerDay: 10, maxTradeSizeUSD: 200,
      riskPerTradePercent: 2, stopLossPercent: 3, takeProfitPercent: 6,
      portfolioValue: 1000, minRiskRewardRatio: 1.5, maxPortfolioHeatPercent: 10,
      maxOpenPositions: 3, dailyLossLimitPercent: 5, dailyProfitTargetPercent: 8
    }
  }));
```

Then add a Test 4 just before the final `console.log('\nAll tests passed successfully!')` that
proves the `config_resolver` floor rejects a leftover fraction:

```js
  // Test 4: Guard 2 — a leftover-fraction SL is rejected by config_resolver's RiskSchema
  console.log('Test 4: Guard 2 floor rejects fractional SL...');
  fs.writeFileSync(path.join(riskDir, 'fraction_risk.json'), JSON.stringify({
    settings: {
      maxTradesPerDay: 10, maxTradeSizeUSD: 200,
      riskPerTradePercent: 2, stopLossPercent: 0.02, takeProfitPercent: 6,
      portfolioValue: 1000, minRiskRewardRatio: 1.5, maxPortfolioHeatPercent: 10,
      maxOpenPositions: 3, dailyLossLimitPercent: 5, dailyProfitTargetPercent: 8
    }
  }));
  assert.throws(() => resolveConfig({ riskTemplateId: 'fraction_risk', logicTemplateId: 'test_logic' }),
    /validation failed/, 'SL 0.02 must be rejected by the 0.1 floor');
  console.log('✅ Test 4 Passed');
```

- [ ] **Step 6: Run the guard test + resolver test**

Run: `node tests/test_risk_schema_guard.mjs && node tests/test_resolver.js`
Expected: PASS for both — the guard test prints its `ok` line; `test_resolver.js` prints
`All tests passed successfully!` (Test 1 now succeeds with the complete fixture, Test 4 confirms
the floor).

- [ ] **Step 7: Commit**

```bash
git add src/server/schemas/strategy.schema.js src/config_resolver.js tests/test_risk_schema_guard.mjs tests/test_resolver.js
git commit -m "feat(risk): schema Guard 2 floors SL/TP at 0.1% (poka-yoke against unit confusion)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Full regression + backtest parity verification

**Files:**
- Test/verify only (no source change unless a regression surfaces).

- [ ] **Step 1: Run the whole test suite**

Run (one line):
```bash
for t in tests/*.js tests/*.mjs; do echo "== $t =="; node "$t" || echo "FAILED: $t"; done
```
Expected: every test prints its `ok`/passed line; no `FAILED:` lines. Fix any test that still encodes the old fractional convention by updating its inputs to whole percent (do not weaken assertions).

- [ ] **Step 2: Confirm the backtest numbers are unchanged (the `.mjs` sweeps bypass templates)**

Run: `node backtest/run-backtest.js --logic SMC --symbol XLMUSDT --tf 1H --sl 0.02 --tp 0.06 --minRR 1 --equity 10000 --riskPerTrade 0.1`
Expected: prints a result for SMC XLM 1H. These CLI flags are already fractions passed straight into guardrails (they do not go through `riskProfileToGuardrails`), so the netPnl must match the figure in `docs/research/2026-06-04-smc-strategy-backtest-findings.md` (§6, SMC XLM 1H). Confirms the refactor did not move backtest results.

- [ ] **Step 3: Update the converter doc comment (remove the now-stale "copy" note)**

In `src/agents/riskProfileToGuardrails.js`, the module doc comment still references "the percent→fraction mapping shared by the backtest matrix and (later) the live path." Update it to state that this is now the single converter used by backtest, AI (`paramResolver`), and manual (`bot_engine`).

- [ ] **Step 4: Commit**

```bash
git add src/agents/riskProfileToGuardrails.js
git commit -m "docs(risk): note riskProfileToGuardrails is the single converter for all three paths

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 5: Manual verification checklist (ops, run before any live use — not automated)**

Document the result in the PR description; do not skip:
1. **Agent-owned AI profiles:** query `ai_trading.db` for `SELECT id, name, stop_loss_percent FROM ai_risk_profiles WHERE is_template = 0;`. Any row with `stop_loss_percent < 0.1` is a leftover fraction — recreate it (or multiply SL/TP/risk by 100) so it matches the whole-percent convention.
2. **Existing manual strategies (#32/#35/#41/#43):** open each in the UI and re-save (override-on-base) so its stored overrides are whole percent; confirm the displayed SL/TP look sane (e.g. 2% / 4%, not 0.02% or 200%).
3. **Server seed:** start the server once (`npm run server`) and confirm the log line `AI risk profiles seeding complete.` appears, so the corrected template files have flowed into `ai_risk_profiles`.

---

## Out of scope (Spec 2 — Structural Risk)
- Setup-based RR gate (enter only when the actual setup offers ≥ minRR, using `signal.invalidation`).
- Wiring `signal.invalidation` into SL/TP placement.
- Guard 1 (cross-field `TP/SL ≥ minRiskRewardRatio` consistency check) — lands with the RR redesign.

## Known follow-up (separate from both specs)
- **`config_resolver`'s `RiskSchema` requires all 11 fields**, but several real templates
  (`scalp_majors`, `scalping_fast`, `vmc_cipherb`, `vmc_scalping`, `scalp_alts`) define only 5–6.
  Those templates therefore cannot pass `resolveConfig` today (it throws on the missing fields).
  This is a required-vs-optional schema bug, independent of units. Fix separately by making the
  non-essential gates `.optional()` (the converter already defaults them to `Infinity`/`0`), with
  a test that a minimal template resolves. Not changed here to keep Spec 1 focused on units.
