# Design Spec: Trading Lab Dashboard

**Date:** 2026-05-16
**Status:** Draft
**Topic:** Multi-strategy Trading Management System with Real-time UI

## 1. Overview
The goal is to transform the current single-bot trading system into a "Trading Lab" — a professional-grade environment for testing, monitoring, and managing multiple trading strategies simultaneously. The system will move from a CLI-based approach to a hybrid architecture consisting of an autonomous bot engine, a central orchestrator server, and a high-fidelity React-based dashboard.

## 2. System Architecture

### 2.1 High-Level Components
- **Bot Engines (Workers):** Autonomous Node.js processes running specific strategies. They execute the trading logic, fetch market data, and interact with the exchange.
- **Orchestrator Server:** A central Node.js server (Express + Socket.io) that manages the lifecycle of bot processes, handles database access, and pushes real-time updates to the UI.
- **Database (SQLite):** A local relational database serving as the single source of truth for configurations, trade history, active positions, and event logs.
- **Frontend Dashboard:** A React SPA (Vite + Tailwind CSS + shadcn/ui) providing a visual interface for control and analysis.

### 2.2 Data Flow
1. **Execution Flow:** `Bot Engine` $\rightarrow$ `SQLite` (Save trade/event) $\rightarrow$ `Orchestrator` (Emit event) $\rightarrow$ `WebSocket` $\rightarrow$ `UI` (Update view).
2. **Control Flow:** `UI` $\rightarrow$ `REST API` $\rightarrow$ `Orchestrator` $\rightarrow$ `Child Process Signal/Config Update` $\rightarrow$ `Bot Engine`.

## 3. Technical Specifications

### 3.1 Database Schema (SQLite)
- **`strategies`**: 
  - `id` (PK), `name` (string), `config` (JSON), `status` (enum: running/stopped), `last_run` (datetime).
- **`trades`**: 
  - `id` (PK), `strategy_id` (FK), `timestamp` (datetime), `symbol` (string), `side` (enum: LONG/SHORT), `price` (float), `size_usd` (float), `status` (enum: PAPER/LIVE/BLOCKED), `result` (float), `notes` (text).
- **`events`**: 
  - `id` (PK), `strategy_id` (FK), `timestamp` (datetime), `type` (enum: CHECK/SIGNAL/ERROR), `payload` (JSON).
- **`active_positions`**: 
  - `id` (PK), `strategy_id` (FK), `symbol` (string), `side` (enum: LONG/SHORT), `entry_price` (float), `size_usd` (float), `stop_loss` (float), `take_profit` (float), `timestamp` (datetime).

### 3.2 API & WebSocket Events
- **REST Endpoints:**
  - `GET /api/strategies`: List all strategies and their statuses.
  - `POST /api/strategies/:id/toggle`: Start/Stop a specific bot.
  - `POST /api/strategies/:id/config`: Update strategy parameters.
  - `GET /api/analytics/leaderboard`: Get aggregated performance metrics.
  - `GET /api/export/:id`: Export trade history to CSV.
- **WebSocket Events:**
  - `event:update`: Pushes a new event card to the live monitor.
  - `status:update`: Updates the running/stopped status of a bot in the UI.
  - `position:update`: Updates the PnL of active positions in real-time.

### 3.3 Frontend Design (shadcn/ui)
- **Strategy Hub:** A data table with `Switch` components for bot control and `Badge` for status.
- **Live Monitor:** A `ScrollArea` containing `Card` components for events, with color-coding (Green = Long, Red = Short, Gray = Blocked).
- **Analytics Center:** KPI cards for total profit/win rate and a sorted table for the strategy leaderboard.
- **Position Tracker:** A real-time list of open trades with a `Progress` bar showing distance to Stop Loss/Take Profit.

## 4. Implementation Strategy
1. **Phase 1 (Infrastructure):** Implement SQLite schema and modify `bot_engine.js` to write to DB instead of just CSV.
2. **Phase 2 (Orchestrator):** Build the Express server with Socket.io and process management logic.
3. **Phase 3 (Frontend):** Setup React + Vite + shadcn/ui and implement the three main views.
4. **Phase 4 (Integration):** Connect the UI to the server and verify real-time event streaming.

## 5. Success Criteria
- Ability to launch/stop multiple strategies via UI.
- Real-time event streaming without page refresh.
- Accurate tracking of active positions and their PnL.
- Reliable export of trade history to CSV from the dashboard.
- No conflict between concurrent bot processes accessing the SQLite DB.
