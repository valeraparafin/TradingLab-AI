# Order-Book Live Agent — Layer 2 (Cockpit Wiring) Design

**Date:** 2026-06-15
**Branch:** `feat/trading-agent-ai-flow`
**Status:** Approved (forks confirmed by user 2026-06-15)
**Predecessor:** `2026-06-15-orderbook-live-agent-design.md` (Layer 1 — engine, DONE)

## Goal

Run the live order-book breakout strategy as a **configurable paper-trading agent
launched from the `/ai` dashboard** — no terminal. Pick "Order Book (Live)" in the
Create-Agent form, set the alt basket + base TF + risk profile, hit Start, and the
agent paper-trades real book/tape signals with structural stops.

## Architecture (Variant A — reuse the existing agent loop)

A `LiveObEngine` (Layer 1) is owned by the agent's `AgentOrchestrator`. The engine ticks
fast (~1 s, in-memory) and buffers PERMITted breakout signals. A **fast drain sub-loop
(~10 s)** in the orchestrator pulls those buffered signals, maps each to the existing
`QualitativeProposal` contract, runs the existing `RiskPolicy` (forced to structural
stops) and `TradeExecutor` (PAPER). The normal 5-min `runCycle` is bypassed for the
per-symbol candle analyst; it only records telemetry/equity and feeds the cockpit's
Order-Flow lens from the latest real OB proposal.

```
OrderBookFeed ──► LiveObEngine (1s tick, buffers signals + thinned recording)
                        │  drainSignals(sym)
   orchestrator fast loop (~10s) ─┐
                        ▼         │
            ObAnalyst.proposalFromSignal(rec)  → {side, conviction,
                        │                          invalidationIdea=<level>, entryMid}
                        ▼
            RiskPolicy.evaluate(proposal,        guardrails.stopMode='structural'
              {entryPrice: entryMid,             structuralRR (default 2)
               invalidation: <level>, ...})      minRiskRewardRatio=0
                        ▼ PERMIT
            TradeExecutor.executeTrade(PAPER)  → ai_paper_trades
                        ▼
            broadcastDecision + telemetry (cockpit)
```

### Why these choices

- **Engine inside the orchestrator** (not a parallel service): the agent start/stop
  lifecycle already exists in `agentManager`; the engine binds cleanly to it, reuses
  telemetry, portfolio state, the paper executor, and archiving. Smallest change.
- **Fast drain (~10 s), priced at the signal's own `entryMid`** (user fork #1): OB signals
  fire on sub-second crosses; waiting up to 5 min and re-pricing off a 1-min candle would
  throw away the timing edge. The 5-min cycle stays only for telemetry.
- **Forced structural guardrails** (`stopMode:'structural'`, `minRiskRewardRatio:0`): the
  OB signal's invalidation is the broken level. Without structural mode `RiskPolicy` would
  size SL/TP off percent config and the R:R gate would deny nearly every trade. SL = broken
  level; TP = `structuralRR` × risk. The risk profile still supplies sizing, heat, daily
  limits, and max trades/day.
- **Defaults now, threshold fields last** (user fork #2): every OB agent runs the engine's
  tuned defaults (imbThresh, aggThresh, minVelocity, maxSpreadBps, horizonMs); base TF comes
  from the form's Timeframe, htfStep defaults to 1. Per-agent threshold inputs are added to
  the form as the final task, persisted in a new `ob_config` JSON column.

## Components

| Unit | Responsibility |
|------|----------------|
| `templates/logic/orderbook.json` | Logic template `type: "OrderBook"` → shows in the form's Trading Logic dropdown; `getLogicTemplateIndicators` returns `['OrderBook']`. |
| `src/agents/ObAnalyst.js` | Pure: a drained signal record → `QualitativeProposal` (+ `entryMid`). No I/O. |
| `src/agents/AgentOrchestrator.js` | OB mode: construct/own `LiveObEngine` in `start()`, fast drain+execute loop, bypass candle analyst in `runCycle`, feed council from OB proposals, tear down engine in `stop()`. |
| `src/server/services/agentManager.js` | Detect `indicators` includes `OrderBook`; build the OB feed + candlesProvider + obConfig; force structural guardrails; pass into the orchestrator. |
| `src/agents/paramResolver.js` / guardrails | Apply the structural overrides for OB agents (one place, documented). |
| `frontend/src/components/AIAgentConfigForm.tsx` | Send the **string** logic-template id (fix `Number()`→null quirk); (final task) OB threshold fields when OrderBook is selected. |
| `db.js` | Idempotent `ALTER TABLE ai_strategies ADD COLUMN ob_config TEXT` (final task). |

### The logic_template_id quirk (must fix)

Logic template ids are filename strings (`smc`, `orderbook`). The form currently does
`logic_template_id: Number(formData.logicTemplateId)` → `NaN` → stored `null`, so **every
agent silently falls back to `['SMC']`** and no agent's selected logic is honored today.
SQLite's INTEGER affinity stores a non-numeric string as text unchanged, so the fix is to
send the raw string id. This is required for OB detection and fixes a latent bug for all
logic types.

## Data flow / contracts

Drained signal record (from `obSignalLog.signalRecord`, already built by the engine):
```
{ t, type:'signal', sym, side:'BUY'|'SELL', setup:'breakout', conviction:0..1,
  entryMid:number, invalidation:number|null /* broken level */,
  level:{resistance,support}|null, rationale:string }
```
`ObAnalyst.proposalFromSignal(rec)` →
```
{ side, conviction, rationale, invalidationIdea: rec.invalidation, entryMid: rec.entryMid }
```
The orchestrator passes `entryPrice: proposal.entryMid` and `invalidation: proposal.invalidationIdea`
into `RiskPolicy.evaluate`. The existing numeric-invalidation plumbing (runCycle line ~72,
RiskPolicy structural branch) already handles the rest.

## Error handling

- No feed / not-ready book → engine emits nothing → drain returns `[]` → no trade (silent,
  by design; sparse trades are expected).
- Engine construction failure on start → log, fail the start cleanly (agent stays stopped),
  same as the existing try/catch in `agentManager.start`.
- A malformed/HOLD record → ObAnalyst returns a HOLD proposal → RiskPolicy DENYs (no crash).
- Structural branch guards `invalidation` direction (BUY: level<entry); if missing it falls
  back to percent SL/TP — but for OB the level is always present, so trades use structural.

## Testing

- **ObAnalyst** (pure): BUY/SELL/HOLD mapping, numeric invalidation passthrough, entryMid
  passthrough, malformed record → HOLD. Plain ESM + `node:assert`.
- **Orchestrator OB mode** (injected fake engine + fake executor, no network): drain→propose→
  evaluate→execute path emits a paper trade at entryMid with structural SL/TP; empty drain →
  no trade; runCycle does NOT call the candle analyst in OB mode; stop() tears down the engine.
- **guardrails override**: OB agent params carry `stopMode:'structural'`, `minRiskRewardRatio:0`,
  `structuralRR` default.
- Regression: full existing suite stays green (`test_ai_agents.mjs`, ob-engine suite, etc.).
- Manual: start the agent from `/ai`, confirm `agent:status running`, signals accumulate,
  paper trades land in `ai_paper_trades`, cockpit telemetry ticks.

## Out of scope (deferred)

- SP3 LLM judge (the council stays a labeled simulation, now fed by real OB proposals).
- SP2b bounce-off-density.
- Real (non-paper) execution.
- Position exit/close management beyond what the existing paper loop does (open-only model,
  same as today's agents); outcome quality is tracked by the engine's forward-outcome log.

## Conventions

Specs/plans LOCAL/untracked under `docs/specs|plans`. `data/orderbook/` gitignored. Commit
trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
