# Phase 6b — AI Agent on the Shared Signal Core — Design Spec

- **Date:** 2026-06-04
- **Branch:** `feat/signal-core`
- **Status:** Approved design, pending implementation plan
- **Predecessor:** Phase 6a (manual `bot_engine.js` path on the core) — committed, flag-OFF, golden-master green.
- **Master spec:** `docs/superpowers/specs/2026-06-02-signal-core-backtest-design.md` (§3 contracts, §10 phase plan + merge gate)

## 1. Problem

The AI agent path (`AgentOrchestrator` → `AnalystAgent` → `RiskPolicy` → `TradeExecutor`)
decides trade side and conviction from a **simulated** heuristic. `AnalystAgent`
runs a cosmetic "Council of Experts" reflection loop and computes `side`/`conviction`
in `_finalizeDecision` from `fScore` — an average of values returned by a simulated
`get_indicator` tool, **not** from real indicator calculations. The master spec
(§1) names this directly: *"The AI agent's 'analysis' is simulated, not driven by
indicators."*

Phase 5 built a pure, deterministic signal core (`IndicatorManager → SignalAdapter →
deriveSignal → Signal`) shared by the backtest shell. Phase 6a routed the manual
`bot_engine` path onto it behind a default-OFF flag. Phase 6b does the same for the
AI agent: replace the simulated heuristic with a real `deriveSignal` decision, behind
the `USE_SIGNAL_CORE` flag (default OFF), so the AI path becomes **honest** and decides
from the same source of truth as the manual path and the backtest.

The master spec (§ lines 73–75) already prescribes the shape of this change:
*"Because `Signal` equals the shape `AnalystAgent` already emits, migrating the live
AI agent is a swap of its simulated heuristic for `SignalAdapter` output — the
orchestrator/RiskPolicy/executor are untouched."*

## 2. Goal & guiding principle

Make the AI agent's decision honest with minimal, reversible, flagged change.

- **OFF (default) = byte-identical current simulated behavior.** The existing
  council/reflection loop runs unchanged. There is no golden-master battery here:
  the old behavior is a placeholder with nothing worth preserving.
- **ON = real core signal.** `AnalystAgent` derives its proposal from
  `deriveSignal` on real indicators.

This is **behavior REPLACEMENT**, not PRESERVATION — the key contrast with Phase 6a,
where the manual path was actively traded and required a golden-master parity proof.

## 3. Scope

### In scope
- A new pure module `src/agents/deriveAgentProposal.js` that turns real candles +
  a logic type into a `QualitativeProposal` via the core.
- A feature-flag seam inside `AnalystAgent.process()` choosing simulated (OFF) vs
  core (ON) proposal.
- Flag resolution (`USE_SIGNAL_CORE` env, default OFF; per-agent `useSignalCore`
  config override).
- Characterization-style routing tests (OFF delegates to the simulated path; ON
  returns the core-derived proposal) + pure-module unit tests.

### Out of scope (deferred, documented)
- **Multi-indicator aggregation** ("council voting" across several core signals).
  Phase 6b is plumbing onto one `logicType`, not new intelligence. The smarter
  aggregation layer is a future phase.
- **Real LLM** integration.
- **Risk-model unification** — already shared: both `AgentOrchestrator.runCycle`
  and `core/pipeline.evaluateBar` call `RiskPolicy.evaluate`. No sizing/SL-TP change.
- **Frontend** changes — the live cockpit already derives its "council" view from
  `proposal.side`/`conviction`, so it becomes honest automatically when ON.
- **Branch merge** — forbidden by the master-spec §10 merge gate until all phases
  land and flags default OFF.

## 4. Architecture

### 4.1 Seam location

Inside `AnalystAgent.process()`, exactly as the master spec prescribes
("swap the heuristic"). The orchestrator, `RiskPolicy`, and `TradeExecutor` are
**untouched**. `process()` keeps its existing contract — it returns a
`QualitativeProposal { side, conviction, rationale, invalidationIdea }`; only the
**source** of those fields changes when the flag is ON.

```
AnalystAgent.process(task)
  ├─ resolve useSignalCore  (config ?? env)
  ├─ OFF → existing reflection loop  (_consultCouncil → _gatherEvidence →
  │        _reflect → _finalizeDecision)            [UNCHANGED]
  └─ ON  → fetch candles (I/O via this.tools.get_candles)
           → deriveAgentProposal({ logicType, logicConfig, candles, price })  [PURE]
           → return proposal
```

The orchestrator continues to call `analyst.process(...)`, hand the proposal to
`RiskPolicy.evaluate`, and execute on PERMIT — none of that changes.

### 4.2 Pure module: `src/agents/deriveAgentProposal.js`

Mirror of Phase 6a's `resolveEntrySide.js`. No I/O; the shell (`process`) fetches
candles and passes them in.

```js
import { IndicatorManager } from '../indicators/index.js';
import { deriveSignal } from '../core/SignalAdapter.js';

const CORE_LOGIC_TYPES = new Set(['SMC', 'BREAKOUT', 'VMC_CIPHERB', 'REVERSAL']);

/** First indicator name that maps to a core-supported logicType, else null. */
export function pickLogicType(indicators = []) {
  for (const name of indicators) {
    if (name && CORE_LOGIC_TYPES.has(String(name).toUpperCase())) return name;
  }
  return null;
}

/** HOLD proposal — RiskPolicy will DENY it (no trade). Carries a reason for the UI/memory. */
function holdProposal(reason) {
  return { side: 'HOLD', conviction: 0, rationale: reason, invalidationIdea: null };
}

/**
 * Pure: real candles + logic type → QualitativeProposal via the shared core.
 * @param {{indicators:string[], logicConfig?:object, candles:object[], price:number}} args
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
    // Unsupported type / bad data must not crash the live agent loop — surface as HOLD.
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

### 4.3 Signal → QualitativeProposal mapping

| Signal field | Proposal field | Note |
|---|---|---|
| `side` | `side` | BUY/SELL/HOLD verbatim |
| `conviction` | `conviction` | 0..1 verbatim |
| `reason` | `rationale` | e.g. "SMC structure BUY" |
| `invalidation` | `invalidationIdea` | price level or `null` |

`RiskPolicy.evaluate` reads **only** `side` + `conviction`, so `rationale` /
`invalidationIdea` are informational (UI thoughts, agent memory episodes).

### 4.4 Flag resolution

```js
const useSignalCore = agentConfig.useSignalCore ?? (process.env.USE_SIGNAL_CORE === 'true');
```

`??` (not `||`) so an explicit `false` in per-agent config survives. `USE_SIGNAL_CORE`
is **independent** of Phase 6a's `USE_SIGNAL_CORE_MANUAL` — the two live paths toggle
separately. `agentConfig` is the config object `AnalystAgent` can reach via its
orchestrator (`orchestrator.config` / `orchestrator.llmContext`); the exact field is
pinned in the plan.

## 5. Data flow when ON

1. `process({ symbol, timeframe })` resolves `useSignalCore = true`.
2. Shell fetches candles: `this.tools.get_candles({ symbol, interval: timeframe, limit: 200 })`;
   `price = candles[candles.length - 1].close`.
3. `deriveAgentProposal({ indicators: this.indicators, logicConfig: {}, candles, price })`.
4. Returns a `QualitativeProposal`; `process` emits a thought and returns it
   (same return contract as OFF).
5. Orchestrator → `RiskPolicy.evaluate(proposal, ctx)` → execute on PERMIT.

## 6. Error & edge handling

- **Core returns HOLD** → `{ side:'HOLD', conviction:0 }` → `RiskPolicy.evaluate`
  already DENYs HOLD (RiskPolicy.js:22, *"Proposal is HOLD/empty (no-op)"*) →
  orchestrator broadcasts `VETOED` and `continue`s. **No new orchestrator plumbing.**
- **No core-supported logicType in `indicators`** → HOLD proposal (logged rationale) → DENY.
- **`deriveSignal` throws** (unsupported type / malformed raw) → caught → HOLD
  proposal → DENY. The live loop never crashes (same safety stance as Phase 6a).
- **Candle fetch fails / empty** → `process` falls back to a HOLD proposal rather
  than calling the core with no data (pinned in the plan's `process` edit).

## 7. Conscious simplifications (documented, not bugs)

- **`logicConfig = {}`** — the agent does not yet store tuned indicator thresholds;
  `IndicatorManager` applies its defaults, which match the backtest's default-config
  runs. Threading real logic-template parameters is a small future refinement.
- **`limit: 200`** candles — a fixed lookback window sufficient for the four core
  indicators. Per-indicator lookback tuning is out of scope.
- **Single `logicType`** per the approved scope decision — first core-supported
  indicator wins; aggregation deferred.

## 8. Testing plan

No golden-master battery (nothing real to preserve). Two new test scripts, plain
`node:assert`, run from repo root, ESM, no framework/deps:

### `tests/test_derive_agent_proposal.js` (pure module)
- `pickLogicType`: supported single, supported-among-unsupported (`['FVG','SMC']→'SMC'`),
  none supported (`['FVG','OrderBlocks']→null`), empty (`[]→null`).
- SMC bullish raw → proposal `side:'BUY'`, conviction > 0, rationale present.
- SMC neutral raw → HOLD proposal (`side:'HOLD'`, conviction 0).
- No supported logicType → HOLD proposal, rationale names the gap.
- Unsupported/throwing path → HOLD proposal, **no throw** (e.g. malformed raw).
- Field mapping: `invalidationIdea` equals the signal's `invalidation`.

### `tests/test_analyst_flag_routing.js` (seam routing)
- OFF: with `useSignalCore=false`, `process` runs the simulated path — assert the
  proposal came from the reflection loop (e.g. stub `this.tools` so the core path
  would differ, and confirm the simulated branch's shape/markers).
- ON: with `useSignalCore=true` and a stubbed `get_candles` returning canned candles,
  `process` returns the `deriveAgentProposal` result (assert side/conviction match a
  direct `deriveAgentProposal` call on the same candles).
- ON + core HOLD: proposal is HOLD (so downstream `RiskPolicy` will veto).

### Regressions
- Existing AI + backtest test suites stay green.
- `node --check src/agents/AnalystAgent.js` and `node --check src/agents/deriveAgentProposal.js`.
- `graphify update .` after code changes.

## 9. Files

| File | Change |
|---|---|
| `src/agents/deriveAgentProposal.js` | **Create** — pure core seam + `pickLogicType`. |
| `src/agents/AnalystAgent.js` | **Modify** — flag resolution + ON branch in `process()`; OFF branch unchanged. |
| `tests/test_derive_agent_proposal.js` | **Create** — pure-module unit tests. |
| `tests/test_analyst_flag_routing.js` | **Create** — OFF/ON routing tests. |

`AgentOrchestrator.js`, `RiskPolicy.js`, `TradeExecutor.js`, `paramResolver.js`,
frontend — **untouched**.

## 10. Non-goals / guardrails

- Default OFF; instant rollback by leaving the env var unset.
- No branch merge (master-spec §10 merge gate).
- No risk-model, sizing, or executor change.
- No frontend change.
- Commit trailer exactly: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Casing: snake_case storage, camelCase runtime, uppercase env.

## 11. Execution

Subagent-driven development (same as Phase 5b / 6a): fresh sonnet implementer per
task → spec-compliance review → code-quality review; final holistic opus review.
TDD per task; frequent commits.
