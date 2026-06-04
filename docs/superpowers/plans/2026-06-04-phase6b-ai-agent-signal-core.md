# Phase 6b — AI Agent on the Shared Signal Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route the AI agent's entry decision through the shared pure signal core (`deriveSignal`) behind the `USE_SIGNAL_CORE` flag (default OFF), replacing `AnalystAgent`'s simulated heuristic with an honest, indicator-driven proposal.

**Architecture:** A new pure module `src/agents/deriveAgentProposal.js` turns real candles + the agent's indicator list into a `QualitativeProposal` via the core. `AnalystAgent.process()` gains a flag seam: OFF runs the existing simulated reflection loop byte-identically; ON fetches candles (I/O) and delegates to the pure module. `AgentOrchestrator`, `RiskPolicy`, and `TradeExecutor` are untouched — a HOLD proposal flows to `RiskPolicy.evaluate`, which already DENYs it (no trade, no crash).

**Tech Stack:** Node.js ESM, `node:assert` test scripts (no framework, no new deps), existing `IndicatorManager` + `SignalAdapter`.

**Spec:** `docs/superpowers/specs/2026-06-04-phase6b-ai-agent-signal-core-design.md`

**Branch:** `feat/signal-core` (do NOT merge — master-spec §10 merge gate holds until all phases land and flags default OFF).

**Commit trailer (EXACT, every commit):**
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

---

## Background the implementer needs

**Run tests from the repo root** with `node tests/<file>.js`. Test scripts are plain ESM using `node:assert`. The house style:
```js
import assert from 'node:assert';
let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };
// ... assertions, each ending with ok('description') ...
console.log(`\n${passed} checks passed`);
```
A failing `assert.*` throws and the process exits non-zero — that is how a test "fails".

**The core contract** (`src/core/SignalAdapter.js`):
- `deriveSignal(logicType, raw, { price, candles })` returns a `Signal`:
  `{ side: 'BUY'|'SELL'|'HOLD', conviction: number(0..1), reason: string, invalidation: number|null }`.
- It dispatches on `String(logicType).toUpperCase()` ∈ `{ SMC, VMC_CIPHERB, BREAKOUT, REVERSAL }` and **throws** `Error("Unsupported logicType: ...")` on anything else.

**The indicator engine** (`src/indicators/index.js`):
- `new IndicatorManager(logicConfig).calculate(logicType, candles)` returns the raw indicator object and supports the same four `logicType`s (also throws on unsupported). It does **not** throw on short/empty candle arrays (it returns a neutral result); it **does** throw if `candles` is `null`/`undefined` (`.map` on null).

**The proposal contract** that `RiskPolicy` consumes (`src/agents/RiskPolicy.js:18-24`):
- `RiskPolicy.evaluate(proposal, ctx)` reads **only** `proposal.side` + `proposal.conviction`.
- It returns `{ decision: 'DENY', reason: 'Proposal is HOLD/empty (no-op)' }` when `proposal.side === 'HOLD'` or missing. So a HOLD proposal is a clean, side-effect-free no-op downstream.

**`AnalystAgent` shape** (`src/agents/AnalystAgent.js`):
- Constructor `constructor(orchestrator)` sets `this.orchestrator = orchestrator`, `this.tools = new ToolRegistry()`, and
  `this.indicators = (orchestrator?.llmContext?.indicators) || (orchestrator?.config?.indicators) || ['SMC']`.
- `async process(task)` currently always runs the simulated reflection loop and returns
  a `QualitativeProposal { side, conviction, rationale, invalidationIdea }` from `_finalizeDecision`.
- `this.tools.get_candles({ symbol, interval, limit })` returns
  `{ success: boolean, data: Array<{time,open,high,low,close,volume}>, error, timestamp }`.
- `emitThought(text)` logs to console when no orchestrator broadcaster is present (safe in tests).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/agents/deriveAgentProposal.js` | **Create.** Pure: `pickLogicType(indicators)` + `deriveAgentProposal({indicators, logicConfig, candles, price})` → `QualitativeProposal`. No I/O. |
| `src/agents/AnalystAgent.js` | **Modify once.** Add import; add flag seam + `_coreProposal()` to `process()`. OFF branch unchanged. |
| `tests/test_derive_agent_proposal.js` | **Create.** Unit tests for the pure module. |
| `tests/test_analyst_flag_routing.js` | **Create.** OFF/ON routing tests through `process()`. |

`AgentOrchestrator.js`, `RiskPolicy.js`, `TradeExecutor.js`, `paramResolver.js`, frontend — **untouched**.

---

## Task 1: Pure module `deriveAgentProposal` + `pickLogicType`

**Files:**
- Create: `src/agents/deriveAgentProposal.js`
- Test: `tests/test_derive_agent_proposal.js`

- [ ] **Step 1: Write the failing test**

Create `tests/test_derive_agent_proposal.js`:

```js
// tests/test_derive_agent_proposal.js
// Pure-module tests for the AI agent's signal-core seam.
import assert from 'node:assert';
import { deriveAgentProposal, pickLogicType } from '../src/agents/deriveAgentProposal.js';
import { deriveSignal } from '../src/core/SignalAdapter.js';
import { IndicatorManager } from '../src/indicators/index.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

// --- pickLogicType: first core-supported indicator wins, else null ---
assert.strictEqual(pickLogicType(['SMC']), 'SMC');
ok('pickLogicType single supported');
assert.strictEqual(pickLogicType(['FVG', 'Breakout']), 'Breakout');
ok('pickLogicType skips unsupported, picks first supported');
assert.strictEqual(pickLogicType(['FVG', 'OrderBlocks']), null);
ok('pickLogicType none supported → null');
assert.strictEqual(pickLogicType([]), null);
ok('pickLogicType empty → null');
assert.strictEqual(pickLogicType(undefined), null);
ok('pickLogicType undefined (default param) → null');

// --- no core-supported logicType → HOLD proposal (candles never touched) ---
{
  const p = deriveAgentProposal({ indicators: ['FVG'], candles: [], price: 0 });
  assert.strictEqual(p.side, 'HOLD');
  assert.strictEqual(p.conviction, 0);
  assert.strictEqual(p.invalidationIdea, null);
  assert.ok(/no core-supported logicType/i.test(p.rationale), 'rationale names the gap');
  ok('no supported logicType → HOLD');
}

// --- error safety: bad candles must NOT throw into the caller ---
{
  // candles=null makes IndicatorManager.calculate throw; deriveAgentProposal must catch.
  const p = deriveAgentProposal({ indicators: ['SMC'], candles: null, price: 0 });
  assert.strictEqual(p.side, 'HOLD');
  assert.strictEqual(p.conviction, 0);
  assert.ok(/signal core error/i.test(p.rationale), 'rationale flags the core error');
  ok('throwing core path → HOLD, no throw');
}

// --- neutral SMC (too few candles for pivots) → HOLD, invalidationIdea null ---
{
  const flat = Array.from({ length: 60 }, (_, i) =>
    ({ time: i, open: 100, high: 101, low: 99, close: 100, volume: 10 }));
  const p = deriveAgentProposal({ indicators: ['SMC'], candles: flat, price: 100 });
  assert.strictEqual(p.side, 'HOLD');
  assert.strictEqual(p.invalidationIdea, null);
  ok('neutral SMC → HOLD');
}

// --- bullish SMC fixture → exact mapping of Signal → QualitativeProposal ---
{
  // 110 flat candles with a lone pivot high (price 20) at index 55, then a final
  // close (25) that breaks above it → SMC trend=1 (bullish BOS at price 20).
  const candles = Array.from({ length: 110 }, (_, i) =>
    ({ time: i, open: 7, high: 10, low: 5, close: 7, volume: 10 }));
  candles[55].high = 20;     // unique pivot high in the [5,105] window → lastHigh = 20
  candles[109].high = 25;    // keep high >= close
  candles[109].close = 25;   // currentClose 25 > lastHigh 20 → bullish structure break
  const price = candles[candles.length - 1].close;

  const expected = deriveSignal('SMC', new IndicatorManager({}).calculate('SMC', candles), { price, candles });
  assert.strictEqual(expected.side, 'BUY', 'fixture sanity: SMC should be bullish');

  const p = deriveAgentProposal({ indicators: ['SMC'], logicConfig: {}, candles, price });
  assert.strictEqual(p.side, expected.side);
  assert.strictEqual(p.conviction, expected.conviction);
  assert.strictEqual(p.rationale, expected.reason);
  assert.strictEqual(p.invalidationIdea, expected.invalidation ?? null);
  assert.strictEqual(typeof p.invalidationIdea, 'number');
  ok(`bullish SMC mapping (side ${p.side}, invalidationIdea ${p.invalidationIdea})`);
}

console.log(`\n${passed} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_derive_agent_proposal.js`
Expected: FAIL — `Cannot find module '.../src/agents/deriveAgentProposal.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/agents/deriveAgentProposal.js`:

```js
// src/agents/deriveAgentProposal.js
import { IndicatorManager } from '../indicators/index.js';
import { deriveSignal } from '../core/SignalAdapter.js';

// The four logic types the shared core (IndicatorManager + deriveSignal) supports.
const CORE_LOGIC_TYPES = new Set(['SMC', 'BREAKOUT', 'VMC_CIPHERB', 'REVERSAL']);

/**
 * First indicator name that maps to a core-supported logicType, else null.
 * The AI agent carries an `indicators` array; the core decides on one logicType.
 * @param {string[]} [indicators]
 * @returns {string|null}
 */
export function pickLogicType(indicators = []) {
  for (const name of indicators || []) {
    if (name && CORE_LOGIC_TYPES.has(String(name).toUpperCase())) return name;
  }
  return null;
}

/** HOLD proposal — RiskPolicy DENYs it (no trade). Carries a reason for UI/memory. */
function holdProposal(reason) {
  return { side: 'HOLD', conviction: 0, rationale: reason, invalidationIdea: null };
}

/**
 * Pure: real candles + the agent's indicator list → QualitativeProposal via the core.
 * Mirrors Phase 6a's resolveEntrySide seam. No I/O; the caller fetches candles.
 *
 * @param {object} args
 * @param {string[]} args.indicators - agent's resolved indicator names
 * @param {object} [args.logicConfig] - indicator thresholds ({} → engine defaults)
 * @param {object[]} args.candles
 * @param {number} args.price
 * @returns {{side:'BUY'|'SELL'|'HOLD', conviction:number, rationale:string, invalidationIdea:(number|null)}}
 */
export function deriveAgentProposal({ indicators, logicConfig = {}, candles, price }) {
  const logicType = pickLogicType(indicators);
  if (!logicType) return holdProposal('no core-supported logicType in agent indicators');
  let signal;
  try {
    const raw = new IndicatorManager(logicConfig).calculate(logicType, candles);
    signal = deriveSignal(logicType, raw, { price, candles });
  } catch (err) {
    // Unsupported type / malformed data must not crash the live agent loop.
    return holdProposal(`signal core error for ${logicType}: ${err.message}`);
  }
  return {
    side: signal.side,
    conviction: signal.conviction,
    rationale: signal.reason,
    invalidationIdea: signal.invalidation ?? null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_derive_agent_proposal.js`
Expected: PASS — `9 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/agents/deriveAgentProposal.js tests/test_derive_agent_proposal.js
git commit -m "$(cat <<'EOF'
feat(phase6b): pure deriveAgentProposal seam + pickLogicType

Turns the AI agent's indicator list + real candles into a QualitativeProposal
via the shared core (IndicatorManager → deriveSignal). HOLD / no-supported-type
/ core-error all yield a HOLD proposal (RiskPolicy then DENYs). No I/O.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Flag seam in `AnalystAgent.process()`

**Files:**
- Modify: `src/agents/AnalystAgent.js` (add import after line 2; add flag branch + `_coreProposal` in/after `process()`)
- Test: `tests/test_analyst_flag_routing.js`

- [ ] **Step 1: Write the failing test**

Create `tests/test_analyst_flag_routing.js`:

```js
// tests/test_analyst_flag_routing.js
// Routing tests through AnalystAgent.process(): OFF = simulated loop (unchanged),
// ON = delegate to the pure signal core. Tools are stubbed so no network happens.
import assert from 'node:assert';
import { AnalystAgent } from '../src/agents/AnalystAgent.js';
import { deriveAgentProposal } from '../src/agents/deriveAgentProposal.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

// 110-candle fixture that drives SMC to a bullish structure break (see Task 1).
function bullishSMCCandles() {
  const candles = Array.from({ length: 110 }, (_, i) =>
    ({ time: i, open: 7, high: 10, low: 5, close: 7, volume: 10 }));
  candles[55].high = 20;
  candles[109].high = 25;
  candles[109].close = 25;
  return candles;
}

// Build an agent with a fake orchestrator (config flag + indicators) and stubbed tools.
function makeAgent({ useSignalCore, indicators }, tools) {
  const agent = new AnalystAgent({
    config: { useSignalCore },
    llmContext: { indicators },
  });
  agent.tools = tools; // replace the real ToolRegistry — no network in tests
  return agent;
}

// --- OFF: simulated reflection loop runs (flag false, env irrelevant) ---
{
  const agent = makeAgent({ useSignalCore: false, indicators: ['SMC'] }, {
    get_indicator: async () => ({ success: true, data: { result: 5 } }), // positive quant score
    get_candles: async () => ({ success: true, data: [
      { time: 1, open: 100, high: 101, low: 99, close: 100, volume: 1 }] }),
  });
  const p = await agent.process({ symbol: 'BTCUSDT', timeframe: '1H' });
  assert.strictEqual(p.side, 'BUY'); // fScore 5 > 0 → BUY (simulated path)
  assert.ok(/Market/.test(p.rationale), 'simulated hypothesis-chain rationale');
  ok('OFF → simulated path (BUY from stubbed quant score)');
}

// --- ON: process() delegates fully to deriveAgentProposal on the fetched candles ---
{
  const candles = bullishSMCCandles();
  const agent = makeAgent({ useSignalCore: true, indicators: ['SMC'] }, {
    get_candles: async () => ({ success: true, data: candles }),
  });
  const p = await agent.process({ symbol: 'BTCUSDT', timeframe: '1H' });
  const expected = deriveAgentProposal({
    indicators: ['SMC'], logicConfig: {}, candles, price: candles[candles.length - 1].close });
  assert.deepStrictEqual(p, expected);
  assert.strictEqual(p.side, 'BUY'); // sanity: fixture is non-trivial
  ok('ON → core proposal (process == deriveAgentProposal)');
}

// --- ON + no core-supported logicType → HOLD reaches the agent output ---
{
  const agent = makeAgent({ useSignalCore: true, indicators: ['FVG'] }, {
    get_candles: async () => ({ success: true, data: [
      { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 }] }),
  });
  const p = await agent.process({ symbol: 'X', timeframe: '1H' });
  assert.strictEqual(p.side, 'HOLD');
  assert.strictEqual(p.conviction, 0);
  ok('ON + unsupported indicators → HOLD');
}

// --- ON + candle fetch fails → HOLD fallback (process never calls the core with no data) ---
{
  const agent = makeAgent({ useSignalCore: true, indicators: ['SMC'] }, {
    get_candles: async () => ({ success: false, data: null, error: 'boom' }),
  });
  const p = await agent.process({ symbol: 'X', timeframe: '1H' });
  assert.strictEqual(p.side, 'HOLD');
  ok('ON + candle fetch fails → HOLD');
}

console.log(`\n${passed} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_analyst_flag_routing.js`
Expected: FAIL. `process()` currently ignores the flag and always runs the simulated loop; with `useSignalCore: true` the ON stub provides only `get_candles` (no `get_indicator`), so the simulated path produces a non-core proposal and the `assert.deepStrictEqual(p, expected)` / HOLD assertions fail.

- [ ] **Step 3: Add the import**

In `src/agents/AnalystAgent.js`, after the existing imports (currently lines 1-2):

```js
import { getDB } from '../../db.js';
import { ToolRegistry } from '../registry/ToolRegistry.js';
import { deriveAgentProposal } from './deriveAgentProposal.js';
```

- [ ] **Step 4: Add the flag seam at the top of `process()`**

Replace the opening of `async process(task)` — from the method signature through the first `this.emitThought("Starting analysis...")` line. Current code:

```js
  async process(task) {
    const { symbol, timeframe = "1H" } = task;
    if (!symbol) throw new Error("Symbol is required for analysis.");

    this.emitThought(`Starting analysis for ${symbol}...`);
```

becomes:

```js
  async process(task) {
    const { symbol, timeframe = "1H" } = task;
    if (!symbol) throw new Error("Symbol is required for analysis.");

    // Phase 6b: when USE_SIGNAL_CORE is ON, derive the proposal from the shared
    // pure core instead of the simulated reflection loop. OFF (default) is unchanged.
    // `??` (not `||`) so an explicit `false` in per-agent config survives.
    const cfg = this.orchestrator?.config || {};
    const useSignalCore = cfg.useSignalCore ?? (process.env.USE_SIGNAL_CORE === "true");
    if (useSignalCore) {
      return this._coreProposal(symbol, timeframe);
    }

    this.emitThought(`Starting analysis for ${symbol}...`);
```

(Everything below this line — the reflection loop and `return this._finalizeDecision(...)` — stays exactly as it is.)

- [ ] **Step 5: Add the `_coreProposal` method**

Immediately after the `process(task)` method's closing brace (after `return this._finalizeDecision(symbol, evidence);` and its `}`), add a new method inside the class:

```js
  /**
   * Phase 6b ON path: derive the proposal from the shared pure core on real candles.
   * The shell (this method) does the I/O (candle fetch); deriveAgentProposal is pure.
   * HOLD / unsupported / empty-data all yield a HOLD proposal, which RiskPolicy then
   * DENYs (no trade) — the live loop never crashes.
   */
  async _coreProposal(symbol, timeframe) {
    this.emitThought(`Analyzing ${symbol} via signal core...`);
    const res = await this.tools.get_candles({ symbol, interval: timeframe, limit: 200 });
    if (!res?.success || !Array.isArray(res.data) || res.data.length === 0) {
      const reason = `No candle data for ${symbol}; holding.`;
      this.emitThought(reason);
      return { side: 'HOLD', conviction: 0, rationale: reason, invalidationIdea: null };
    }
    const candles = res.data;
    const price = candles[candles.length - 1].close;
    const proposal = deriveAgentProposal({ indicators: this.indicators, logicConfig: {}, candles, price });
    this.emitThought(`Core proposal: ${proposal.side} for ${symbol} (conviction ${proposal.conviction.toFixed(2)})`);
    return proposal;
  }
```

- [ ] **Step 6: Run the routing test to verify it passes**

Run: `node tests/test_analyst_flag_routing.js`
Expected: PASS — `4 checks passed`.

- [ ] **Step 7: Re-run Task 1 tests + syntax check (no regression)**

Run:
```bash
node tests/test_derive_agent_proposal.js
node --check src/agents/AnalystAgent.js
node --check src/agents/deriveAgentProposal.js
```
Expected: `9 checks passed`; both `node --check` print nothing (exit 0).

- [ ] **Step 8: Run the broader regression suites (must stay green)**

Run:
```bash
node tests/test_signal_adapter.js
node tests/test_pipeline.js
node tests/test_backtest_integration.js
node tests/test_futures_integration.js
```
Expected: all print their `N checks passed` lines and exit 0. (These exercise the core + backtest shells the AI path now shares; they must be unaffected.)

- [ ] **Step 9: Commit**

```bash
git add src/agents/AnalystAgent.js tests/test_analyst_flag_routing.js
git commit -m "$(cat <<'EOF'
feat(phase6b): route AnalystAgent through the signal core behind USE_SIGNAL_CORE

OFF (default) keeps the simulated reflection loop byte-identical. ON fetches
candles and delegates to the pure deriveAgentProposal. HOLD/empty/unsupported
yield a HOLD proposal (RiskPolicy DENYs → no trade). Orchestrator, RiskPolicy,
and executor untouched.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 10: Refresh the knowledge graph**

Run: `graphify update .`
Expected: graph updates (AST-only, no API cost). Not committed unless the repo tracks `graphify-out/` changes for this branch.

---

## Definition of Done

- `tests/test_derive_agent_proposal.js` → `9 checks passed`.
- `tests/test_analyst_flag_routing.js` → `4 checks passed`.
- Regression suites in Task 2 Step 8 all green.
- `node --check` clean on both touched/created `src/agents/*.js`.
- Default behavior unchanged: with `USE_SIGNAL_CORE` unset and no per-agent
  `useSignalCore`, `process()` runs the original simulated loop.
- Branch **not** merged (master-spec §10 merge gate).

## Spec Coverage Check (self-review)

- Spec §3 in-scope items → Task 1 (pure module, flag-independent) + Task 2 (seam, flag resolution, routing tests). ✓
- Spec §4.2 pure module code → Task 1 Step 3 (verbatim). ✓
- Spec §4.3 Signal→proposal mapping → Task 1 Step 1 bullish-fixture mapping assertions + Step 3 mapping code. ✓
- Spec §4.4 flag resolution (`??`, env, per-agent, independent of MANUAL flag) → Task 2 Step 4. ✓
- Spec §5 data flow (candles `interval: timeframe`, `limit: 200`, `price = last close`) → Task 2 Step 5 `_coreProposal`. ✓
- Spec §6 error/edge handling (HOLD→DENY, no supported type, throw→HOLD, empty candles→HOLD) → Task 1 Steps 1/3 + Task 2 Steps 1/5. ✓
- Spec §7 simplifications (`logicConfig {}`, `limit 200`, single logicType) → Task 1/Task 2 code + comments. ✓
- Spec §8 testing plan → Tasks 1 & 2 tests + Task 2 Steps 7-8 regression. ✓
- Spec §9 files / §10 guardrails (untouched files, default OFF, no merge, trailer) → File Structure table + commit trailers + DoD. ✓
