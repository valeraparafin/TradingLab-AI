# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Commands

### Bot Execution
- Run strategy manager (interactive): `node manager.js`
- Launch specific strategy: `node manager.js -s <strategy_name>`
- Run trading engine directly: `node bot_engine.js <path_to_strategy_json>`
- Generate tax summary: `node bot.js --tax-summary` (Note: if bot.js is missing, check server.js for summary endpoints)

### Server & Frontend
- Start Orchestrator Server: `npm run server` (runs `server.js`)
- Start Trading Lab Dashboard: `npm run frontend` (runs `cd frontend && npm run dev`)

### Frontend Development
- Build frontend: `cd frontend && npm run build`
- Lint frontend: `cd frontend && npm run lint`

### Testing & Validation
- Test Database initialization: `node test-db.js`
- Validate technical indicators: `node test_indicators.js`
- Test configuration resolver: `node tests/test_resolver.js`

## Architecture & Structure

### High-Level Flow
1. **Strategy Definition**: 
   - **Extraction**: Raw strategy descriptions or PineScript (`/strategy`) are processed using AI prompts (`/prompts`) to generate structured logic.
   - **Definition**: Strategies are stored as JSON configurations in the `/strategies` directory (or managed via the database).
   - **Templates**: Strategies use a template-based system (Logic and Risk templates) located in `/templates` to allow for reusable base configurations with specific overrides.
2. **Market Data**: Data is fetched from TradingView MCP (local) or Binance API (cloud).
3. **Trading Engine (`bot_engine.js`)**: 
   - Calculates indicators (Breakout Channels, SMC, Order Blocks, FVG).
   - Executes a **Safety Check** based on the resolved strategy configuration.
   - Places orders via BitGet API if all conditions pass.
   - Logs trades to `trades.csv` and `trading_lab.db`.
4. **Orchestrator (`server.js`)**:
   - Manages multiple bot processes as child processes.
   - Provides a REST API for toggling strategies and updating configs.
   - Broadcasts real-time events via Socket.io to the frontend.
5. **Dashboard (`/frontend`)**:
   - React-based UI to monitor strategy performance, win rates, and active positions.

### Key Files & Directories
- `manager.js`: Interactive CLI for launching trading strategies.
- `bot_engine.js`: Core trading logic and indicator calculations.
- `server.js`: Express/Socket.io server for managing bot instances.
- `db.js`: SQLite database management for trades and events.
- `src/`: Contains core utility logic, including the `config_resolver.js` used to merge strategy templates.
- `templates/`: Logic and Risk JSON templates for strategy definitions.
- `prompts/`: AI prompts used for strategy extraction and trade analysis.
- `strategy/`: Raw strategy descriptions and PineScript exported from TradingView.
- `docs/exchanges/`: Step-by-step API key setup guides for supported exchanges.
- `trades.csv`: Persistent, tax-ready log of all executions.

### Database Schema
The project uses SQLite (`trading_lab.db`) to track:
- `strategies`: Metadata and status of trading strategies.
- `trades`: History of all attempted and executed trades.
- `events`: Detailed logs of safety checks and engine events.
- `active_positions`: Currently open trades for monitoring and exit logic.
