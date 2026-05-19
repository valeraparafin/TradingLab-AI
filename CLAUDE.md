# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Commands

### Bot Execution
- Run bot manually: `node bot.js`
- Run trading engine for a specific strategy: `node bot_engine.js <path_to_strategy_json>`
- Generate tax summary: `node bot.js --tax-summary`

### Server & Frontend
- Start Orchestrator Server: `npm run server` (runs `server.js`)
- Start Trading Lab Dashboard: `npm run frontend` (runs `cd frontend && npm run dev`)

### Frontend Development
- Build frontend: `cd frontend && npm run build`
- Lint frontend: `cd frontend && npm run lint`

## Architecture & Structure

### High-Level Flow
1. **Strategy Definition**: Rules are defined in `rules.json` (or other `.json` files in `/strategies`).
2. **Market Data**: Data is fetched from TradingView MCP (local) or Binance API (cloud).
3. **Trading Engine (`bot_engine.js`)**: 
   - Calculates indicators (Breakout Channels, SMC, Order Blocks, FVG).
   - Executes a **Safety Check** based on `rules.json`.
   - Places orders via BitGet API if all conditions pass.
   - Logs trades to `trades.csv` and `trading_lab.db`.
4. **Orchestrator (`server.js`)**:
   - Manages multiple bot processes as child processes.
   - Provides a REST API for toggling strategies and updating configs.
   - Broadcasts real-time events via Socket.io to the frontend.
5. **Dashboard (`/frontend`)**:
   - React-based UI to monitor strategy performance, win rates, and active positions.

### Key Files
- `bot.js`: Entry point for manual execution.
- `bot_engine.js`: Core trading logic and indicator calculations.
- `server.js`: Express/Socket.io server for managing bot instances.
- `db.js`: SQLite database management for trades and events.
- `rules.json`: Configuration for indicators, entry rules, and risk management.
- `trades.csv`: Persistent, tax-ready log of all executions.

### Database Schema
The project uses SQLite (`trading_lab.db`) to track:
- `strategies`: Metadata and status of trading strategies.
- `trades`: History of all attempted and executed trades.
- `events`: Detailed logs of safety checks and engine events.
- `active_positions`: Currently open trades for monitoring and exit logic.
