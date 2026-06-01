# AI Trader: Parameter Routing & Deterministic Risk Enforcement — Design Spec

**Date:** 2026-06-01
**Status:** Approved (concept), pending implementation plan
**Author:** brainstormed with user (iparafin)

## 1. Problem

An AI agent is configured with ~13 parameters (name, watchlist, timeframe, logic
template, trade mode, paper flag, portfolio value, cycle interval, and 8 risk-profile
numbers). Today most of these are **stored but never enforced**, and the few that are
consumed are wired with unit bugs. There is also **no real LLM call** — the Analyst's
"Council of Experts" is fully simulated — so we must answer a design question *before*
the LLM exists: **which parameters belong in the LLM's reasoning context, and which must
be enforced deterministically in code?**

### Concrete defects in the current code
- **Veto unit bug** (`RiskAgent._handleTradeVeto`): trade `size` is computed in **USD**
  (`portfolioValue × risk_per_trade_percent`) but compared against `maxPositionSize`,
  which holds a **fraction** (`risk_per_trade_percent` ≈ `0.05`). `500 > 0.05` is always
  true → **every trade is vetoed**.
- **SL/TP come from the LLM, not the risk profile** (`AgentOrchestrator.runCycle` reads
  `proposal.stop_loss` / `proposal.take_profit`). Worse, `AnalystAgent._finalizeDecision`
  never sets those fields → they are `undefined`. The profile's `stop_loss_percent` /
  `take_profit_percent` are ignored.
- **Trades written to the wrong table/DB**: `TradeExecutor._executePaper` writes to the
  manual `paper_trades` via `getDB()`, but the Cockpit reads `ai_paper_trades` via
  `getDB('ai')` → agent trades never appear in the AI UI.
- **`tradeExecutor` is a shared module singleton** (`new TradeExecutor({})`), so per-agent
  `paperTrading` / `agentId` are not threaded through.
- **`RiskGuard.js` is orphaned**: the class that enforces `maxOpenPositions` is a
  hardcoded singleton never wired into the orchestrator path. `maxOpenPositions`,
  `maxTradeSizeUSD`, `maxPortfolioHeatPercent`, `dailyProfitTargetPercent` are inert.

## 2. Goals

1. Define a clear, documented **parameter taxonomy**: qualitative posture → LLM context;
   quantitative limits → deterministic code.
2. Introduce a **resolver** that splits a flat agent config into labeled blocks the rest
   of the system consumes through stable interfaces.
3. Make the Analyst emit a **structured, schema-shaped qualitative proposal** (no money
   numbers), produced by the existing simulated council, shaped exactly as a future LLM
   would return it.
4. Move **all sizing, SL/TP derivation, and limit enforcement into deterministic code**,
   evaluated **at the point of action** (right before the trade executes).
5. Fix the five defects above as a natural consequence of the above.
6. Leave a **single, clearly-marked seam** where the real LLM request slots in later.

## 3. Non-Goals (explicitly deferred)

- **No real LLM API call.** The council stays simulated; we only shape its I/O.
- No real-exchange order placement (real mode still falls back to paper).
- No new UI fields. The config form is unchanged; routing happens at resolution time.
- The two template-only fields not in the DB (`maxTradesPerDay`, `minRiskRewardRatio`)
  are **noted as future guardrail extensions**, not built now.

## 4. The Governing Principle

> **LLM proposes (qualitative); code disposes (quantitative); enforce at the point of
> action.** The model never sees or emits a money number; deterministic policy gets no
> vote from the model.

This follows the documented industry consensus that prompt-embedded limits are
"suggestions, not enforcement," and that high-risk/irreversible actions must be gated by
runtime code next to the side effect — not by instructions in a prompt.

## 5. Parameter Taxonomy

| Field (snake_case) | Bucket | Role |
|---|---|---|
| `watchlist` | llmContext + loop | which symbols to analyze; drives the cycle loop |
| `timeframe` | **llmContext** | analysis horizon given to the reasoner |
| `logic_template_id` → indicators (+descriptions) | **llmContext** | the signals the reasoner reasons over |
| `trade_mode` (spot/futures) | llmContext + execution | tells reasoner if shorting is allowed; sets order market type |
| `risk_per_trade_percent` | **guardrails** (sizing) + posture phrase | code sizes the order; LLM hears "conservative/aggressive" — never the number |
| `stop_loss_percent` / `take_profit_percent` | **guardrails** (execution) | code derives SL/TP **prices**; LLM hears the posture, not the % |
| `daily_profit_target_percent` | **guardrails** (circuit) | code halts trading when hit |
| `max_trade_size_usd` | **guardrails** (hard cap) | code caps notional; never in prompt |
| `max_open_positions` | **guardrails** (hard cap) | code blocks new entries past the cap |
| `max_portfolio_heat_percent` | **guardrails** (hard cap) | code blocks if aggregate exposure exceeds |
| `daily_loss_limit_percent` | **guardrails** (circuit) | code halts trading on drawdown |
| `portfolio_value` | guardrails input | sizing math base; optional posture flavor |
| `paper_trading`, `cycle_interval_ms`, `name` | execution/operational | infra; never in prompt |

**Posture phrase:** raw risk numbers are translated into a qualitative label for the
LLM context (e.g. `risk_per_trade_percent ≤ 0.01` → "conservative"; `≥ 0.04` →
"aggressive"). The number itself stays in `guardrails`.

## 6. Architecture & Data Flow

```
agent row + risk profile (DB, snake_case)
        │
        ▼
resolveAgentParams(agent, riskProfile)   ← new pure function (src/agents/paramResolver.js)
        │
        ├── llmContext  { timeframe, indicators[], indicatorDescriptions, watchlist,
        │                 tradeMode, posture }            → reasoner prompt input (future LLM)
        │
        ├── guardrails  { riskPerTrade, stopLossPct, takeProfitPct, maxTradeSizeUSD,
        │                 maxOpenPositions, maxPortfolioHeatPct, dailyLossLimitPct,
        │                 dailyProfitTargetPct, portfolioValue }   → RiskPolicy
        │
        └── execution   { paperTrading, tradeMode, agentId, cycleInterval, symbols }
                                          │
                                          ▼
AnalystAgent.process(symbol, llmContext)
        │  (simulated council today; LLM seam later)
        ▼
QualitativeProposal { side: BUY|SELL|HOLD, conviction: 0..1, rationale, invalidationIdea? }
        │   ── NO money numbers ──
        ▼
RiskPolicy.evaluate(proposal, guardrails, portfolioState)   ← deterministic, at point of action
        │   computes: sizeUSD, slPrice, tpPrice
        │   gates:    maxTradeSizeUSD, maxOpenPositions, portfolioHeat, daily limits
        ▼
{ decision: PERMIT | DENY, order?, reason }
        │  PERMIT
        ▼
TradeExecutor.executeTrade(order, execution)  → writes ai_paper_trades via getDB('ai')
```

### 6a. `paramResolver.js` (new, pure, unit-testable)
`resolveAgentParams(agent, riskProfile) → { llmContext, guardrails, execution }`.
Single source of truth for snake_case→camelCase mapping and the posture phrase. Replaces
the ad-hoc spread in `server.js`.

### 6b. `QualitativeProposal` contract (the LLM seam)
`AnalystAgent.process` returns exactly:
`{ side: 'BUY'|'SELL'|'HOLD', conviction: number(0..1), rationale: string, invalidationIdea?: string }`.
- Today: produced by the existing simulated council (mapped from the current
  `signal`/`confidence`/`reasoning`).
- Later: `_consultCouncil` becomes a real LLM call whose **input is `llmContext`** and
  whose **output is this exact schema** (structured output / function calling). No other
  component changes. This function is the *only* place the LLM is introduced.

### 6c. `RiskPolicy` (consolidates RiskAgent veto + RiskGuard)
A single deterministic object constructed from `guardrails`. One method:
`evaluate(proposal, portfolioState) → { decision, order?, reason }`.
- **Sizing:** `sizeUSD = min(portfolioValue × riskPerTrade, maxTradeSizeUSD)` — one unit
  (USD) throughout. Fixes the veto unit bug.
- **SL/TP prices:** derived from `stopLossPct` / `takeProfitPct` relative to entry and
  `side` (mirrored for SELL) — from the profile, not the proposal.
- **Gates:** open-position count, portfolio heat, daily loss/profit circuit breakers.
- `HOLD` proposals short-circuit to `DENY (no-op)`.
RiskGuard's hardcoded singleton is retired/absorbed; RiskAgent's monitoring loop may stay
for drawdown state but no longer owns sizing/veto math.

### 6d. Executor wiring
`TradeExecutor` is instantiated **per agent** (or given `execution` per call), writes to
**`ai_paper_trades` via `getDB('ai')`** with `agent_id`, and honors `paperTrading`.

## 7. Testing

- **`paramResolver` unit test:** given a known agent+profile row, asserts the three blocks
  have correct values, camelCase keys, and posture phrase boundaries.
- **`RiskPolicy` unit test:** (a) sizing is USD and capped by `maxTradeSizeUSD`;
  (b) a normal proposal PERMITs with correct mirrored SL/TP; (c) exceeding
  `maxOpenPositions` / heat / daily-loss DENYs; (d) `HOLD` is a no-op. Proves the
  always-veto unit bug is gone.
- **Executor test:** a PERMITted paper trade lands in `ai_paper_trades` with the right
  `agent_id` (not `paper_trades`).
- **Contract test:** `AnalystAgent.process` returns the `QualitativeProposal` shape with no
  numeric money fields.

## 8. Risks & Mitigations
- *Behavioral change to live gating logic* → covered by the RiskPolicy unit tests above;
  real mode remains paper-only, so no real orders can fire from this change.
- *Existing callers of `proposal.signal`* → resolved by mapping the old field names inside
  the new contract during the refactor (search-and-update references).

## 9. Future Work (out of scope here)
- Replace the simulated council in `_consultCouncil` with a real LLM call (§6b seam).
- Add `maxTradesPerDay` / `minRiskRewardRatio` as DB columns + RiskPolicy gates.
- Real-exchange execution + exchange-account picker.
