# AI Position Lifecycle & Observability — Design

**Date:** 2026-06-15
**Branch:** feat/trading-agent-ai-flow
**Status:** Approved (brainstorming)

## Problem

Every AI agent — both the candle path (`runCycle`) and the Order-Book path
(`_obDrainTick`) — currently calls `tradeExecutor.executeTrade`, which logs an
**entry-only** row into `ai_paper_trades` and nothing else. No agent:

- writes the open position to `ai_active_positions`,
- monitors the structural/risk SL/TP that were already computed at entry,
- ever closes a position or records realized PnL.

Consequences observed live (8 OB agents running): 9 entry rows, all `buy`, zero
closes; `ai_active_positions` empty; equity flat at the starting value; `pnl%=0`.
`_getPortfolioState` reads `ai_active_positions` expecting it to be populated, so
heat/exposure also read as zero. The cockpit therefore shows "a few trades" and
no results — by construction, results can never appear.

This is an **AI-wide** gap, not OB-specific. Both `order.slPrice`/`order.tpPrice`
already exist on the executed order in both paths; only the price source for exit
monitoring differs by mode.

## Goal

Close the position lifecycle for **all** AI agents — open → monitor SL/TP →
close → realized PnL — and surface it in the cockpit as live open positions
(with unrealized PnL) and closed trades (with realized PnL and exit reason).

## Non-Goals (YAGNI)

- Time-stop, opposite-signal flip, trailing stops, partial exits, position
  layering/averaging. **One position per (agent, symbol)**; exits are SL/TP only.
- Real (non-paper) execution. Paper only.
- Backfilling PnL for the 9 existing entry-only rows.

## Architecture

Mode-agnostic core + thin per-mode wiring + shared UI.

```
                ┌─────────────────────────────────────────┐
   entry signal │  AgentOrchestrator                        │
  (candle / OB) │   runCycle()        _obDrainTick()        │
                │      │                   │                │
                │      ▼                   ▼                │
                │   openPosition(...)  (same)               │
                │      │                   │                │
                │      └───────┬───────────┘                │
                │              ▼                            │
                │   PositionLedger (pure)                   │
                │     openPosition / checkExits / pnl       │
                │              │                            │
                │     persist to ai_active_positions /      │
                │     ai_closed_trades; broadcast           │
                └─────────────────────────────────────────┘
                               │
        GET /positions   GET /closed-trades   socket: position:opened/closed
                               │
                ┌──────────────▼───────────────┐
                │  AICockpitPage (shared)       │
                │   Open Positions panel        │
                │   Closed Trades panel         │
                └───────────────────────────────┘
```

## Components

### 1. `src/agents/PositionLedger.js` (pure, no DB)

Pure functions; unit-tested with `node:assert` like `ObAnalyst`/`obGuardrails`.

```js
// Normalize a position object from an executed order.
export function openPosition({ symbol, side, entryPrice, qty, slPrice, tpPrice, openedAt })
  // → { symbol, side:'BUY'|'SELL', entryPrice, qty, slPrice, tpPrice, openedAt }

// Decide which open positions breach SL/TP given current mids.
export function checkExits(positions, midBySymbol)
  // → { closed: [{ ...position, exitPrice, exitReason:'SL'|'TP', pnlUsd }], remaining: [...] }
  // LONG : exitReason 'SL' when mid <= slPrice; 'TP' when mid >= tpPrice
  // SHORT: exitReason 'SL' when mid >= slPrice; 'TP' when mid <= tpPrice
  // If both SL and TP straddle within one tick (paper, gap), SL takes priority (conservative).
  // Positions with no mid in the map are passed through to `remaining` untouched.

// Signed realized PnL in USD for a fill.
export function realizedPnl({ side, entryPrice, qty }, exitPrice)
  // LONG : (exitPrice - entryPrice) * qty
  // SHORT: (entryPrice - exitPrice) * qty
```

`qty` is derived once at entry as `sizeUSD / entryPrice` and carried on the
position so PnL and exposure are exact.

### 2. Storage (idempotent ALTERs in `db.js`)

`db.js` already applies idempotent `ALTER TABLE ... ADD COLUMN` lists per table.

- **`ai_active_positions`** — add: `side TEXT`, `sl_price REAL`, `tp_price REAL`,
  `opened_at TEXT`. (`total_quantity`, `total_cost`, `avg_entry_price` already exist
  and are reused: qty=`total_quantity`, entry=`avg_entry_price`.)
- **`ai_closed_trades`** — new table:
  `id INTEGER PK, strategy_id INTEGER, symbol TEXT, side TEXT, entry_price REAL,
   exit_price REAL, qty REAL, size_usd REAL, pnl_usd REAL, exit_reason TEXT,
   opened_at TEXT, closed_at TEXT`.

Closed round-trips go to `ai_closed_trades` (clean entry+exit+pnl semantics)
rather than overloading the entry-log `ai_paper_trades`, which keeps its current
meaning (raw fills).

### 3. Orchestrator wiring (shared helpers, both modes)

Two new private helpers on `AgentOrchestrator`, called from both `runCycle`
(per symbol, on EXECUTE) and `_obDrainTick` (per drained EXECUTE):

- `async _openPosition(order)`: if no open row for `(agentId, symbol)`, compute
  `qty`, insert into `ai_active_positions` (with side/sl/tp/opened_at), broadcast
  `position:opened`. Continues to also log the entry fill into `ai_paper_trades`
  (unchanged behavior). The per-symbol existence check is the position lock.
- `async _sweepExits(midBySymbol)`: load open positions for the agent, run
  `PositionLedger.checkExits`, and for each closed one: insert into
  `ai_closed_trades`, delete from `ai_active_positions`, log a closing fill into
  `ai_paper_trades` (opposite side), broadcast `position:closed`.

`midBySymbol` source per mode:
- **OB:** futures mid from the engine's current book (`obEngine` / feed), fallback
  to `_getCurrentPrice(symbol)`.
- **Candle:** `_getCurrentPrice(symbol)` (latest `get_candles` close), already used
  for entry pricing.

`_sweepExits` runs once per tick: at the top of `runCycle` (candle) and inside
`_obDrainTick` after draining signals (OB). `_getPortfolioState` is unchanged —
it now naturally reports real open positions, heat, and exposure.

### 4. API + sockets (`server.js` / ai routes)

- `GET /api/ai/agents/:id/positions` → open positions enriched server-side with
  current mid and unrealized PnL (math on the server per the project's
  server-side-logic policy).
- `GET /api/ai/agents/:id/closed-trades` → rows from `ai_closed_trades`, newest first.
- Socket events `position:opened` / `position:closed` for instant cockpit updates;
  panels still poll every 10s as the source of truth (matches existing trades/equity).

### 5. UI (`AICockpitPage`, shared by all agents)

- **Open Positions** panel (new): symbol, side, entry, current mid, unrealized PnL
  (green/red), SL/TP and distance-to-each. Empty state "No open positions."
- **Closed Trades** panel: entry/exit/qty/size/realized PnL/exit reason, newest
  first — reuse the `TradesTable` column style. Replaces the current raw
  "AI Trades" table (which showed entry-only rows).
- Both panels are agent-generic: candle agents populate them too once they trade.

## Data Flow

1. Signal → RiskPolicy PERMIT → `order` with `slPrice`/`tpPrice`/`sizeUSD`/`entryPrice`.
2. `_openPosition(order)` → qty computed, row in `ai_active_positions`, fill logged,
   `position:opened` broadcast.
3. Each tick → `_sweepExits(midBySymbol)` → `checkExits` → breached positions closed:
   `ai_closed_trades` row + closing fill + `ai_active_positions` delete +
   `position:closed`.
4. Cockpit polls `/positions` (live unrealized PnL) and `/closed-trades` (realized
   PnL); `_recordTelemetry` equity snapshots now move with realized PnL.

## Error Handling

- Missing mid for a symbol → position passed through untouched (no spurious close).
- DB write failure during close → logged; position remains open (retried next tick;
  no partial state — insert-then-delete ordered so a crash leaves the position open,
  never double-closed).
- `qty`/price non-finite → guard at `_openPosition`; skip with a broadcast warning.
- Existing-position lock prevents duplicate opens on repeated signals.

## Testing

- **Unit (`tests/test_position_ledger.mjs`):** long SL/TP, short SL/TP, no-mid
  pass-through, SL-priority on straddle, `realizedPnl` sign for long & short,
  `openPosition` qty derivation.
- **Integration:** extend `tests/test_orchestrator_ob_mode.mjs` to assert that a
  drained EXECUTE opens a position and a subsequent mid breaching TP closes it with
  the expected `pnl_usd` and `exit_reason`.
- **Regression:** existing OB engine + ai-agents suites stay green; non-OB path
  byte-compatible except the added open/exit calls.

## Open Questions

None. Time-stop/flip explicitly deferred; one-position-per-symbol confirmed; closed
trades in a dedicated table confirmed; Open Positions panel shared across all agents
confirmed.
