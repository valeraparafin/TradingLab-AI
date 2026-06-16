# Live Order-Book Agent (SP4) — Design

**Date:** 2026-06-15
**Branch:** feat/trading-agent-ai-flow
**Status:** Approved (brainstorm complete) → ready for writing-plans
**Related:** [project-orderbook-feed], SP1 (feed, done), SP2a (gate + breakout signal, done), edge-validation (commits 264c647 / d550ad4 / 37afb0e)

## Goal

Run the deterministic order-book breakout strategy **live, paper-only**, on the `/ai`
dashboard. While the user's PC + server are on, the strategy continuously evaluates the
gate, logs every signal with its forward outcome (accumulating the validation dataset),
surfaces paper trades + a live Order-Flow lens in the cockpit, and records thinned raw
order-book data to disk for future offline re-sweeps. Fully user-configurable as a normal
AI agent — no hardcoded strategy.

## Core principle: chart + book are a bundle, not book-only

The edge is the **coincidence** of two layers, neither alone:

- **Chart says WHERE** — `levelFromCandles` derives a significant level from **higher-timeframe**
  candle structure (resistance/support, coiled/pinch). A level worth breaking.
- **Book says WHEN / IS IT REAL** — `breakoutSignal` fires only on a live mid **cross** of that
  chart level, confirmed by book imbalance + tape aggressor + print velocity.

Book without a level = noise (imb 0.03 → negative). Level without book = classic false break.
The whole strategy is their intersection.

## Why "Variant A" (persistent engine + drain), not poll-at-cycle

A breakout cross is a **sub-second** event. The `/ai` agent loop ticks every 5 min. Polling the
book only at cycle time would miss ~all crosses and accumulate data 300× too slowly. So:

- A **persistent OB engine** ticks fast (event-driven / ~1s), catches every cross, logs every
  signal+outcome, and buffers recent signals in memory.
- The orchestrator, on its 5-min cadence, **drains** the freshest signal per symbol and routes
  it through the existing `RiskPolicy → TradeExecutor(PAPER) → telemetry` pipeline.

Two evaluation rates, deliberately separate: the **eval tick** is fast and in-memory (free); only
the **disk write** is thinned.

---

## Layer 1 — Persistent OB engine (foundation, accumulates data)

A long-lived singleton, started alongside the server. Wraps one `OrderBookFeed` for the
configured symbol set. Per symbol, on a fast tick:

1. Maintain a **rolling HTF level**: periodically fetch higher-TF candles and recompute
   `levelFromCandles`. The HTF is derived from the agent's base timeframe (see ladder below).
2. Track `prevMid`; run `breakoutSignal` + `obGate` against the live `getFeatures(sym)` snapshot.
3. On a PERMIT:
   - append the signal to `data/orderbook/signals/<day>.jsonl`;
   - schedule a **forward-outcome** eval at `horizonMs` (default 60s) that reads the live mid then,
     computes realized net bps (reuse `replayScore` math), and appends an outcome record;
   - push the signal into an in-memory ring buffer (for the orchestrator drain).

**Honesty invariant:** if the futures book is not `ready` (unsynced/STALE), the tick is skipped —
no signal on a stale book.

### Timeframe ladder (relative HTF)

Base TF is what the user selects on the agent. The level HTF is **one rung up** a fixed ladder,
configurable via `htfStep` (rungs, default 1):

```
1m → 5m → 15m → 30m → 1h → 4h → 1d
```

Examples: base 5m → level from 15m; base 15m, htfStep 1 → 30m; base 15m, htfStep 2 → 1h.
Levels are computed on the **higher** TF (significant structure); the book confirms the break live.

### Thinned recording

Keep raw OB data for future offline re-sweeps, but drop weightless volume. The bulk of raw frames
is deep-book `depth @100ms` noise far from mid; the signal only uses the near-mid band + the tape.

- **Trades (tape): record every print, event-driven** — sparse and high-value (carry
  aggressorImbalance / velocity).
- **Book: record a compact near-mid snapshot every `recordIntervalMs`** (default 1000ms,
  configurable; floor 1s — sampling the book slower than ~1s degrades imbalance fidelity at the
  cross and corrupts re-sweeps). The snapshot covers the `depthBps` band used by features.
- Deep-book diffs outside the band are **not** persisted.
- Recording is **on by default** now (changed from "off" after user decision), tunable per agent.

This changes the recorded format from raw event-diffs to **periodic near-mid snapshots + trades**;
offline re-sweep replays from snapshots directly (simpler than diff replay) and can re-tune
`imbThresh` / aggressor / velocity / horizon on real captured data.

### Engine contract

- `getLatestFeatures(sym)` → latest dual-book feature snapshot (for the cockpit lens).
- `drainSignals(sym)` → recent buffered signals since last drain (for the orchestrator).
- `getStats()` → per-symbol counters (ticks, signals, resolved outcomes, hit-rate, avg net bps).

---

## Layer 2 — SP4 cockpit wiring

### OB-backed proposal source

A distinct AI agent (its own `agentId` / strategy row) whose proposal source is the OB engine,
**not** the SMC AnalystAgent. It runs alongside any SMC agent, never replaces it. On `runCycle`,
the orchestrator drains the freshest signal per symbol from the engine.

### Mapping OB signal → RiskPolicy contract (critical — or zero trades)

`RiskPolicy.evaluate` requires `side`, `conviction`, `invalidationIdea`, and enough for the
**setup-RR gate** (a valid SL **and** TP). The OB signal carries `side`, `conviction`,
`invalidation` (SL) — but **no TP**. The mapper derives the TP **R-multiple** from the SL:

```
risk = |entry − invalidation|
TP   = entry ± R · risk        (R ≥ the setup-RR gate threshold)
```

so the gate passes on genuine signals. Without this the gate vetoes everything. `R` (the target
multiple) is a configurable agent param. Drain-empty → HOLD (existing path, no trade).

### Real Order-Flow cockpit lens

`AgentOrchestrator._buildCouncil` currently emits a **simulated** "Order Flow" lens. Replace it
with **live OB features** from `engine.getLatestFeatures(sym)` (imbalance, microprice, near-wall,
aggressorImbalance, printVelocity), so the cockpit lens reflects the real book.

---

## Configuration (user-owned, not hardcoded)

The OB strategy is a normal AI agent (same model as existing: DB row → `resolveAgentParams` →
`{guardrails, execution, ...}`), started/stopped with the existing `/ai` toggle. User-set knobs:

- **symbols** — basket (SUI, GPS, TON, WIF, WLD) + added alts (AVAX, LINK, NEAR, ARB, INJ ≈10),
  spot-ticker match verified at wiring time (the tape needs a matching spot ticker; 1000x-prefix
  coins are excluded — see [project-orderbook-feed]).
- **timeframe** (base) + **htfStep** (rungs up the ladder, default 1).
- **OB knobs:** `imbThresh` (selectivity — the main lever; default 0.10), `horizonMs` (outcome
  horizon, default 60000), `recordIntervalMs` (default 1000), `targetR` (TP multiple), `costBps`.
- **risk profile** — guardrails (size, heat, maxTradesPerDay) via the existing risk-profile system.

Exposing the OB-specific knobs in the dashboard agent form is part of Layer 2. Defaults are sane
and fully overridable.

## Expectations (set honestly)

Trades will be **sparse**, by design. At `imbThresh ≥ 0.10` the signal fires ~1 per 85 symbol-
minutes; across ~10 symbols ≈ 7 signals/hour, volatility-dependent, fewer after RiskPolicy gates.
Sparse selectivity *is* the edge (imb 0.03 = noise/negative, imb 0.15 = +7 bps). "Few trades" =
working correctly, not broken. This run **is** the forward validation; SP3 (LLM judge) stays
deferred until this confirms the edge on a larger live sample.

## Error handling / resilience

- Feed auto-resyncs on stale/close (existing).
- Engine: not-ready → skip tick; candle-fetch failure → keep last level + warn; missing mid for
  outcome → mark unresolved.
- Orchestrator drain empty → HOLD.
- Engine is a singleton; if the server restarts, it restarts with it (data accumulates whenever the
  server is up).

## Testing

Pure pieces (`levelFromCandles`, `breakoutSignal`, `obGate`, `replayScore`) already covered. New:

- **Engine tick logic** — synthetic feed: signal emitted on a confirmed cross, buffered, drained
  once; not-ready tick skipped; outcome appended after horizon.
- **HTF ladder** — base→higher resolution incl. `htfStep`.
- **Thinned recorder** — near-mid snapshot cadence honored; every trade kept; deep-book dropped;
  replay from snapshots reproduces feature values.
- **OB→proposal mapper** — produces a contract that RiskPolicy PERMITs on a genuine signal
  (TP/SL/RR valid); vetoes when RR below threshold.

Idiom: plain ESM + `node:assert`, run via `node tests/<file>.mjs`.

## Build order

Phased, one plan:

1. **Layer 1** — engine + thinned recorder + signal/outcome log. Verify the log grows live, then
   pause to confirm accumulation before wiring.
2. **Layer 2** — orchestrator drain + RiskPolicy mapping + real Order-Flow lens + agent config
   surface.

## Out of scope (deferred)

- SP3 LLM judge (gated on this run confirming edge; separate brainstorm→spec→plan).
- SP2b bounce-off-density.
- Auto-restart-on-crash wrapper (server lifecycle is enough for now).
