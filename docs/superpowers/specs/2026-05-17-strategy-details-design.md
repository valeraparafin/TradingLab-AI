# Strategy Details & Real-time Terminal Design

**Date:** 2026-05-17
**Status:** Draft
**Topic:** Implementation of a detailed strategy monitoring page with a real-time log terminal and performance KPIs.

## 1. Overview
The goal is to move from a simple "Start/Stop" toggle in the Strategy Hub to a dedicated "Strategy Details" page. This page provides deep observability into a specific strategy's health, real-time execution logs (terminal style), and comprehensive trading performance metrics.

## 2. Backend Architecture (The Managed Engine)

### 2.1 `bot_engine.js` (The Daemon)
The bot will be converted from a one-time script to a long-running process.

- **Execution Loop**: Wrap the main `run()` logic in an async loop.
- **Adaptive Trigger**: 
    - If `mode === 'adaptive'`, sleep for `timeframe / 10`.
    - If `mode === 'manual'`, sleep for the user-defined `intervalSeconds`.
- **Structured Logging**: Replace standard `console.log` with a `logEvent(type, message)` helper that sends a POST request to `/event` with:
    - `strategyId`: The ID of the bot.
    - `type`: `INFO`, `CHECK`, `TRADE`, `ERROR`.
    - `payload`: The log message.
- **Heartbeat**: Send a `heartbeat` event every 30 seconds to let the server know the process is still healthy.

### 2.2 `server.js` (The Bot Manager)
The server will evolve to manage these long-running processes more formally.

- **`BotManager` Class**:
    - `activeBots`: Map of `strategyId` $\rightarrow$ `{ process, startTime, settings }`.
    - `startBot(strategyId)`: Spawns the process and sets up the loop config.
    - `stopBot(strategyId)`: Sends `SIGTERM` and updates DB status.
- **KPI Engine**: A new set of internal helpers to calculate metrics from `trading_lab.db` on demand:
    - `getStrategyStats(strategyId)`: Calculates Net PnL, Profit Factor, Win Rate, and Max Drawdown.
    - `getActivePositions(strategyId)`: Fetches currently open trades.
- **Event Routing**: The `/event` endpoint will continue to broadcast via Socket.io, but the frontend will now filter these by `strategyId`.

## 3. Frontend Design (Shadcn UI)

The page will be located at `/strategy/:id` (or managed via a state-driven view in the existing app).

### 3.1 Layout Structure
Using a `Resizable` layout or a grid of `Card` components:

#### A. Performance Header (Top Row)
A series of `Card` components containing `Badge` and `Text` for high-level KPIs:
- **Realized PnL**: Large numeric display with `text-emerald-500` (profit) or `text-rose-500` (loss).
- **Profit Factor**: A ratio (e.g., "1.85") with a small descriptive tooltip.
- **Win Rate**: A percentage (e.g., "64%").
- **Current Exposure**: Amount of capital tied up.

#### B. Active Positions (Middle Left)
A `Table` component within a `Card`:
- Columns: `Symbol`, `Side`, `Entry`, `Current`, `PnL`, `SL/TP Progress`.
- `Progress` bar using the `Progress` component to show how close the price is to the Stop Loss or Take Profit.

#### C. Control Panel (Middle Right)
A `Card` with a form for bot management:
- **Status**: `Button` (Start/Stop) with dynamic colors.
- **Trigger Mode**: `ToggleGroup` (Adaptive vs. Manual).
- **Interval**: `Input` (number) visible only when Manual is selected.
- **Quick Settings**: `Switch` for Paper Trading.

#### D. Strategy Terminal (Bottom Row)
A large, dedicated `Card` designed to look like a terminal:
- **Styling**: `bg-zinc-950`, `text-zinc-300`, `font-mono`, `text-xs`.
- **Behavior**: 
    - Use `ScrollArea` for the log history.
    - Auto-scroll to bottom on new events.
    - Color-coded prefixes: `[INFO]` (zinc), `[CHECK]` (emerald), `[TRADE]` (blue), `[ERROR]` (rose).
- **Actions**: "Clear Logs" button in the header.

## 4. Data Flow
1. **Bot** $\rightarrow$ `/event` $\rightarrow$ **Server** $\rightarrow$ **Socket.io** $\rightarrow$ **Frontend**.
2. **Frontend** $\rightarrow$ `/api/strategies/stats/:id` $\rightarrow$ **Server** $\rightarrow$ **DB** $\rightarrow$ **Frontend**.
3. **Frontend** $\rightarrow$ `/api/strategies/config` $\rightarrow$ **Server** $\rightarrow$ **Bot Process (Restart)**.

## 5. Success Criteria
- Bot runs continuously without manual restart.
- Logs appear in the terminal in real-time with $<1$s latency.
- Performance metrics update accurately after every closed trade.
- Trigger interval adapts correctly to the selected timeframe.
