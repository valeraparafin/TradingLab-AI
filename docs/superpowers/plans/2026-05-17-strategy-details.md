# Strategy Details & Real-time Terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a dedicated strategy monitoring page with a real-time log terminal, performance KPIs via SQL Views, and a daemonized bot execution model.

**Architecture:** 
1. **Bot Engine**: Converted to a long-running process with a configurable sleep loop.
2. **Server**: Manages bot processes and provides a pre-calculated KPI view via SQLite.
3. **Frontend**: A new detail view using Shadcn components for KPIs, active positions, and a monospace terminal.

**Tech Stack:** Node.js, SQLite, Socket.io, React, Tailwind CSS, Shadcn UI.

---

## File Mapping

### Backend
- Modify: `bot_engine.js` (Daemon loop, structured logging)
- Modify: `server.js` (Process management, KPI API)
- Modify: `db.js` (SQL View creation)

### Frontend
- Modify: `frontend/src/lib/api.ts` (Add stats endpoint)
- Create: `frontend/src/components/StrategyDetails.tsx` (Main view)
- Create: `frontend/src/components/StrategyTerminal.tsx` (Terminal component)
- Modify: `frontend/src/App.tsx` (Routing)

---

## Implementation Tasks

### Task 1: Database KPI View
Implement a SQL View to calculate strategy performance metrics in real-time.

- [ ] **Step 1: Add `createStatsView` function to `db.js`**
  Implement a function that creates a view `strategy_stats` calculating:
  - `total_profit`: `SUM(result)`
  - `win_rate`: `(COUNT(CASE WHEN result > 0 THEN 1 END) * 100.0 / COUNT(*))`
  - `profit_factor`: `SUM(CASE WHEN result > 0 THEN result ELSE 0 END) / ABS(SUM(CASE WHEN result < 0 THEN result ELSE 0 END))`
  - `total_trades`: `COUNT(*)`

- [ ] **Step 2: Execute view creation on server start**
  Call `createStatsView()` in `server.js` during initialization.

- [ ] **Step 3: Commit**
  `git add db.js server.js && git commit -m "feat: add SQL view for strategy performance KPIs"`

### Task 2: Bot Engine Daemonization
Convert `bot_engine.js` from a one-shot script to a long-running process.

- [ ] **Step 1: Implement `logEvent` helper**
  Create a function that sends structured logs to `http://localhost:3000/event` with `type` (`INFO`, `CHECK`, `TRADE`, `ERROR`).

- [ ] **Step 2: Wrap `run()` in a `while(true)` loop**
  Modify the main entry point to loop continuously.

- [ ] **Step 3: Implement Adaptive/Manual sleep logic**
  Calculate sleep time:
  - Manual: `config.intervalSeconds * 1000`
  - Adaptive: `(timeframe_in_minutes * 60 * 1000) / 10`

- [ ] **Step 4: Commit**
  `git add bot_engine.js && git commit -m "feat: convert bot engine to long-running daemon with adaptive triggers"`

### Task 3: Server Bot Management & Stats API
Update the server to manage the daemon processes and expose the KPI view.

- [ ] **Step 1: Update `spawnBot` to handle daemon processes**
  Ensure `activeBots` map correctly tracks the long-running processes and handles cleanup on exit.

- [ ] **Step 2: Implement `GET /api/strategies/stats/:id`**
  Create an endpoint that queries the `strategy_stats` view for a specific ID.

- [ ] **Step 3: Implement `GET /api/strategies/positions/:id`**
  Create an endpoint that returns open positions from the `active_positions` table.

- [ ] **Step 4: Commit**
  `git add server.js && git commit -m "feat: implement bot manager and strategy stats API"`

### Task 4: Frontend API & Routing
Prepare the frontend to handle the new detail view.

- [ ] **Step 1: Update `strategyApi` in `frontend/src/lib/api.ts`**
  Add `getStats(id)` and `getPositions(id)` methods.

- [ ] **Step 2: Add Strategy Detail route to `frontend/src/App.tsx`**
  Implement routing to allow navigating to `/strategy/:id`.

- [ ] **Step 3: Commit**
  `git add frontend/src/lib/api.ts frontend/src/App.tsx && git commit -m "feat: add routing and API clients for strategy details"`

### Task 5: Strategy Terminal Component
Build the monospace terminal for real-time logs.

- [ ] **Step 1: Create `StrategyTerminal.tsx`**
  Implement a component with:
  - `bg-zinc-950`, `text-zinc-300`, `font-mono`.
  - `useSocket` integration filtered by `strategyId`.
  - Auto-scroll to bottom logic.
  - Color-coded prefixes.

- [ ] **Step 2: Commit**
  `git add frontend/src/components/StrategyTerminal.tsx && git commit -m "feat: implement real-time strategy terminal"`

### Task 6: Strategy Details Page
Assemble the final page using Shadcn components.

- [ ] **Step 1: Implement KPI Header**
  Use `Card` components to display Realized PnL, Profit Factor, and Win Rate.

- [ ] **Step 2: Implement Active Positions Table**
  Use `Table` to show open trades with PnL and SL/TP progress bars.

- [ ] **Step 3: Implement Control Panel**
  Add buttons for Start/Stop and a `ToggleGroup` for Trigger Mode (Adaptive/Manual).

- [ ] **Step 4: Integrate `StrategyTerminal`**
  Place the terminal at the bottom of the page.

- [ ] **Step 5: Commit**
  `git add frontend/src/components/StrategyDetails.tsx && git commit -m "feat: complete strategy details page with KPIs and terminal"`

---

## Testing Plan

1. **Backend Loop**: Start a bot and verify in `server.js` logs that it triggers every N seconds without exiting.
2. **KPI Accuracy**: Manually insert a few trades into `trades` table, then verify `GET /api/strategies/stats/:id` returns the correct Profit Factor and Win Rate.
3. **Terminal Streaming**: Open the Strategy Details page and verify that `[INFO]` and `[CHECK]` logs appear in real-time as the bot runs.
4. **Control Panel**: Toggle the bot from "Running" to "Stopped" and verify the process is killed on the server.
5. **Adaptive Mode**: Change timeframe from `1m` to `1H` and verify the log frequency changes accordingly.
