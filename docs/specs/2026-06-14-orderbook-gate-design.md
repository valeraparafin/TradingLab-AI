# SP2a — Order-Book Gate + Breakout-Confirm Signal (Design)

> **Status:** LOCAL / untracked (never `git add`). Part of the order-book strategy pivot.
> **Date:** 2026-06-14 · **Branch:** feat/trading-agent-ai-flow
> **Predecessor:** SP1 (`docs/specs/2026-06-14-orderbook-feed-design.md`) — the live dual-book feed.
> **Successors:** SP2b (bounce-off-density), SP3 (LLM analyst), SP4 (live loop + paper exec + cockpit).

## Goal

Turn SP1's live order-book features into a **deterministic breakout-confirm trading signal** plus a
**veto gate** (`withOrderBookGate`), as pure testable units. The order book confirms *when* a
candle-defined breakout has real impulse. No LLM, no live wiring, no real money — those are SP3/SP4.

## Scope decision

SP2 splits into **SP2a (this spec) = breakout-confirm** and **SP2b = bounce-off-density**.
Breakout-confirm is mostly readable from a single SP1 snapshot; bounce-off-density needs cross-tick
wall memory (a stateful engine) and gets its own sub-project. The gate + replay scaffold built here
are reused verbatim by SP2b.

## Architecture

Three pure functions plus a replay harness. Everything is a pure function of
`(candle-derived level + latest SP1 feature snapshot)`, so it unit-tests offline and replays
bit-for-bit against recorded JSONL.

```
candles ──► levelFromCandles()      ─┐
                                      ├─► breakoutSignal() ──► {side, setup, conviction, rationale, invalidation} | null
SP1 getFeatures(sym) snapshot ───────┘                              │
                                                                    ▼
                                            withOrderBookGate(decide) ── vetoes a PERMIT unless the book confirms
```

**Edge-source decision:** candles define the *level* (the coil/range price must break); the order
book + tape only *confirm impulse*. This matches the trader's real workflow and the proven B+
decomposition (candle-only breakout ≈0 after costs — see `project-bplus-verdict`; the missing edge
is the book confirming the break). Keeps "breakout" cleanly separate from the "density" setup.

## Components

### 1. `levelFromCandles(candles, opts)` → `{ resistance, support, coiled }` (pure)
- `resistance` = highest high over `opts.lookback` bars; `support` = lowest low.
- `coiled` = true when the recent range has tightened (pinch), reusing the B+ scout coil logic
  (range over last K bars ≤ `opts.pinchPct` of price).
- Insufficient candles → `{ resistance:null, support:null, coiled:false }`.
- `opts`: `{ lookback = 20, pinchPct = 0.02 }`.

### 2. `breakoutSignal({ level, feat, prevMid, opts })` → signal | null (pure)
`feat` is one SP1 snapshot: `feat.ready`, `feat.spotReady`, `feat.futures` (primary book+tape),
`feat.spot` (confirm book). Returns `null` unless a trigger AND book-confirm both fire.

- **Guard:** if `!feat.ready` or `feat.futures == null` → `null`.
- **Trigger (uses `prevMid` to detect the *cross*, not just "currently above"):**
  - BUY candidate: `prevMid <= level.resistance && feat.futures.mid > level.resistance`.
  - SELL candidate: `prevMid >= level.support && feat.futures.mid < level.support`.
  - No `prevMid` (first tick) → no trigger, `null`.
- **Book confirm — BUY (SELL mirrors all signs):** all of
  - `imbalance > +opts.imbThresh` (bid-heavy book),
  - `aggressorImbalance > +opts.aggThresh` (buyers lifting the offer on the tape),
  - `askDepthNbps < bidDepthNbps` (opposite side thin),
  - `printVelocity >= opts.minVelocity` (live tape, not dead).
- **Spot SOFT-confirm (decided: soft, not hard):** spot is **not required**.
  - `feat.spotReady` and spot `imbalance` agrees with side → conviction boost.
  - `feat.spotReady` and spot `imbalance` strongly opposes side → conviction penalty.
  - `!feat.spotReady` → trade on futures alone (no penalty).
  - Rationale: alt spot books are thin, a hard veto kills most signals; but spot reveals liquidity
    the futures DOM hides (trader's GPSUSDT example), so it still *informs* conviction.
- **Output:** `{ side, setup: 'breakout', conviction, rationale, invalidation }` where
  - `side` ∈ `{ BUY, SELL }` (use existing `SIDE` from `src/core/contracts.js`),
  - `conviction` ∈ `[0,1]`, scaled from how strongly imbalance + aggressor + velocity align, then
    nudged by spot agreement (clamped to `[0,1]`),
  - `rationale` = short human string naming the firing conditions,
  - `invalidation` = `{ backInsideRange: <level.resistance|level.support> }` (price re-entering the
    range invalidates the idea).
- **No money numbers** (no size/SL/TP) — consistent with the `QualitativeProposal` seam SP3 fills.
- `opts` defaults: `{ imbThresh = 0.15, aggThresh = 0.15, minVelocity = 0.5, spotBoost = 0.1, spotPenalty = 0.15 }`.

### 3. `withOrderBookGate(decide, opts)` (decorator — mirrors `withPumpDumpGate`)
Wraps `decide(ctx, account) → { signal, decision }`.
- Inner DENY / HOLD / non-PERMIT / no-order → pass through unchanged.
- On PERMIT, read `ctx.feat` (the SP1 snapshot for this symbol) and veto → DENY when:
  - `!ctx.feat || !ctx.feat.ready` → `reason: 'ob gate: book not ready'`,
  - `spread / mid > opts.maxSpreadBps/10000` → `reason: 'ob gate: spread too wide'`,
  - book contradicts side: BUY with `imbalance < 0`, or SELL with `imbalance > 0` →
    `reason: 'ob gate: book contradicts side'`.
- Otherwise pass the PERMIT through.
- `opts`: `{ maxSpreadBps = 8 }`.
- Same `{ signal, decision }` shape as the existing gate decorators so it composes with them.

### 4. `runObSignal` replay harness (CLI, thin IO)
- Reads a recorded SP1 JSONL file (SP1 Recorder output) + a candle source, replays frames through
  `levelFromCandles` → `breakoutSignal` → `withOrderBookGate`, prints each emitted signal with its
  gate decision and rationale.
- Purpose: paper-style feedback **before** SP4 live wiring; deterministic and reproducible.
- Thin IO only; all logic lives in the pure units above.

## Data flow (one tick)

1. Harness holds last `prevMid` per symbol.
2. `feat = getFeatures(sym)` (SP1) + recent candles.
3. `level = levelFromCandles(candles)`.
4. `sig = breakoutSignal({ level, feat, prevMid })`; then update `prevMid = feat.futures.mid`.
5. If `sig`: build a PERMIT decision carrying `sig`, run through `withOrderBookGate` → final
   PERMIT/DENY.
6. Emit (harness prints; SP4 later routes to a paper executor).

## Error / honesty handling

- `!feat.ready` (stale/unsynced futures book) → no signal; gate would DENY regardless. SP1's honesty
  invariant carries through: **never trade on a stale book.**
- One-sided book / `feat.futures == null` → `breakoutSignal` returns `null`.
- Missing/short candles → `levelFromCandles` returns `coiled:false`, null level → no signal.
- Spot missing → soft path (futures-only), never an error.

## Testing (plain ESM + `node:assert`, same harness as SP1)

- `levelFromCandles`: known candle array → expected resistance/support/coiled; too-few candles → nulls.
- `breakoutSignal`: synthetic `{ level, feat, prevMid }` fixtures —
  BUY confirm fires; SELL confirm fires; trigger-without-confirm → null; not-ready → null;
  dead tape (`printVelocity` below floor) → null; spot agree boosts conviction; spot disagree
  penalizes; spot missing → futures-only signal still fires; no `prevMid` → null.
- `withOrderBookGate`: PERMIT-BUY with contradicting imbalance → DENY; DENY/HOLD pass through;
  not-ready → DENY; wide spread → DENY; clean PERMIT passes.
- Replay: small recorded JSONL fixture → deterministic signal list (reproducibility).

## Out of scope (explicit)

SP2a does **not** touch `AnalystAgent`, the LLM, `AgentOrchestrator`, `RiskPolicy`, real execution,
or the `/ai` cockpit. It produces tested pure units + a replay harness only.
- SP2b — bounce-off-density (cross-tick wall memory).
- SP3 — LLM analyst fills the `QualitativeProposal` seam; gate still vetoes.
- SP4 — live loop + paper executor + cockpit Order-Flow lens.

## File structure

- Create: `src/marketdata/orderbook/levels.js` (`levelFromCandles`)
- Create: `src/marketdata/orderbook/breakoutSignal.js` (`breakoutSignal`)
- Create: `src/marketdata/orderbook/obGate.js` (`withOrderBookGate`)
- Create: `scripts/replay-ob-signal.mjs` (replay harness CLI)
- Test: `tests/test_ob_levels.mjs`, `tests/test_breakout_signal.mjs`, `tests/test_ob_gate.mjs`,
  `tests/test_ob_signal_replay.mjs`
- Reuse: `src/core/contracts.js` (`SIDE`), SP1 modules under `src/marketdata/orderbook/`.
