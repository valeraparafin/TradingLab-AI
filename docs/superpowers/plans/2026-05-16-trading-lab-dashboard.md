# Trading Lab Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a professional-grade management interface (Dashboard) for a multi-strategy trading system, featuring real-time monitoring via WebSockets, a centralized SQLite database, and a shadcn/ui React frontend.

**Architecture:** Hybrid Orchestrator-Worker model. `bot_engine.js` (Worker) handles trading and writes to SQLite. `server.js` (Orchestrator) manages processes and provides a WebSocket/REST API. `Frontend` (React/Vite) provides the visual control panel.

**Tech Stack:** Node.js, Express, Socket.io, SQLite3, React, Vite, Tailwind CSS, shadcn/ui.

---

## File Structure

### Backend
- `server.js`: Central orchestrator. Handles process management, API routes, and WebSocket hub.
- `db.js`: Database utility. Handles SQLite schema initialization and queries.
- `bot_engine.js`: (Modify) Updated to use SQLite for logging and communicate with the server.
- `manager.js`: (Modify) Update to support server-mode launch.

### Frontend (React/Vite)
- `src/App.tsx`: Main routing and layout.
- `src/components/StrategyHub.tsx`: Table for managing bot status and configs.
- `src/components/LiveMonitor.tsx`: Event stream with event cards.
- `src/components/AnalyticsCenter.tsx`: Leaderboard and performance metrics.
- `src/components/PositionTracker.tsx`: Real-time active positions list.
- `src/hooks/useSocket.ts`: Custom hook for WebSocket communication.
- `src/lib/api.ts`: API client for REST requests.

---

## Implementation Tasks

### Task 1: Database Infrastructure
**Files:**
- Create: `db.js`

- [ ] **Step 1: Implement database initialization**
```javascript
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

export async function initDB() {
  const db = await open({
    filename: './trading_lab.db',
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS strategies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      config TEXT,
      status TEXT DEFAULT 'stopped',
      last_run DATETIME
    );
    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      strategy_id INTEGER,
      timestamp DATETIME,
      symbol TEXT,
      side TEXT,
      price REAL,
      size_usd REAL,
      status TEXT,
      result REAL,
      notes TEXT,
      FOREIGN KEY(strategy_id) REFERENCES strategies(id)
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      strategy_id INTEGER,
      timestamp DATETIME,
      type TEXT,
      payload TEXT,
      FOREIGN KEY(strategy_id) REFERENCES strategies(id)
    );
    CREATE TABLE IF NOT EXISTS active_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      strategy_id INTEGER,
      symbol TEXT,
      side TEXT,
      entry_price REAL,
      size_usd REAL,
      stop_loss REAL,
      take_profit REAL,
      timestamp DATETIME,
      FOREIGN KEY(strategy_id) REFERENCES strategies(id)
    );
  `);
  return db;
}
```

- [ ] **Step 2: Verify DB creation**
Run: `node -e "import { initDB } from './db.js'; initDB().then(() => console.log('DB Init OK'))"`
Expected: `DB Init OK` and `trading_lab.db` file created.

- [ ] **Step 3: Commit**

### Task 2: Bot Engine Migration to DB
**Files:**
- Modify: `bot_engine.js`

- [ ] **Step 1: Update `bot_engine.js` to use `db.js` for logging**
Replace `writeTradeCsv` and `saveLog` calls with database inserts.
```javascript
import { initDB } from './db.js';
const db = await initDB();
// Replace: writeTradeCsv(logEntry)
await db.run(
  `INSERT INTO trades (strategy_id, timestamp, symbol, side, price, size_usd, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  [strategyId, logEntry.timestamp, logEntry.symbol, side, logEntry.price, logEntry.tradeSize, mode, notes]
);
```

- [ ] **Step 2: Implement active position tracking**
Add logic to check `active_positions` table before entering a trade and update it upon entry/exit.

- [ ] **Step 3: Add WebSocket signal emission**
Add a simple HTTP POST request to the local server (`localhost:3000/event`) whenever a significant event occurs.

- [ ] **Step 4: Run bot in paper mode to verify DB entries**
Run: `node manager.js -s smc`
Expected: Records appear in `trading_lab.db`.

- [ ] **Step 5: Commit**

### Task 3: The Orchestrator Server
**Files:**
- Create: `server.js`

- [ ] **Step 1: Basic Express + Socket.io setup**
```javascript
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { initDB } from './db.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });
const db = await initDB();

app.use(express.json());
httpServer.listen(3000, () => console.log('Server running on port 3000'));
```

- [ ] **Step 2: Implement Process Management**
Use `child_process.spawn` to start/stop bots based on `strategies` table.

- [ ] **Step 3: Implement REST API for UI**
Create endpoints: `/api/strategies` (GET), `/api/strategies/toggle` (POST), `/api/analytics/leaderboard` (GET).

- [ ] **Step 4: Implement WebSocket event relay**
Create endpoint `POST /event` that receives data from bots and emits it via `io.emit('event:update', data)`.

- [ ] **Step 5: Commit**

### Task 4: Frontend Setup (React + Vite + shadcn/ui)
**Files:**
- Create: `frontend/` directory and initialize Vite project.
- Create: `frontend/src/lib/api.ts` and `frontend/src/hooks/useSocket.ts`.

- [ ] **Step 1: Install Tailwind CSS and shadcn/ui components**
Run: `npx shadcn-ui@latest init`
Install: `Table`, `Switch`, `Button`, `Card`, `Dialog`, `Badge`, `ScrollArea`.

- [ ] **Step 2: Implement Strategy Hub (Main Table)**
Build the table that calls `/api/strategies` and allows toggling bots.

- [ ] **Step 3: Implement Live Monitor (Event Stream)**
Connect to Socket.io and render event cards in a `ScrollArea`.

- [ ] **Step 4: Implement Analytics Center (Leaderboard)**
Fetch data from `/api/analytics/leaderboard` and render the performance table.

- [ ] **Step 5: Implement Position Tracker**
Build a real-time list of open positions with PnL calculations.

- [ ] **Step 6: Commit**

### Task 5: End-to-End Integration & Testing
- [ ] **Step 1: Launch Server $\rightarrow$ Launch UI $\rightarrow$ Start Bot.**
- [ ] **Step 2: Verify real-time event flow** (Bot $\rightarrow$ Server $\rightarrow$ UI).
- [ ] **Step 3: Verify config changes** (UI $\rightarrow$ Server $\rightarrow$ Bot).
- [ ] **Step 4: Verify CSV export from UI.**
- [ ] **Step 5: Final Commit.**
