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

### Backtesting
- **Full runbook: [`backtest/README.md`](backtest/README.md)** — flags, risk templates, the sizing/leverage caveat, HTF gate. Read it before running or wiring backtests instead of re-deriving from source.
- Single cell (CLI-driven): `node backtest/run-backtest.js --symbol XRPUSDT --tf 1H --logic SMC --equity 200 --riskPerTrade 0.10 --sl 0.03 --tp 0.06 --leverage 10 --htf`
- Matrix sweep (risk × logic × symbol × tf, uses `templates/risk/*.json`): `node backtest/run-matrix.js --risks <ids> --logics SMC --symbols BTCUSDT,XRPUSDT --tfs 1H --htf --group <name>`

### Testing & Validation
There is **no `npm test` runner**. Tests are ~130 standalone scripts in `tests/` (mix of `.js`/`.mjs`, plain `node:assert`, no framework) — run one directly and it exits non-zero on failure:
- Single test: `node tests/test_simulator.mjs` (substitute any file)
- Most subsystems have a matching test: `test_<indicator>.mjs`, `test_ob_*.mjs` (order book), `test_backtest_*`, `test_pipeline.js`, `test_resolver.js`.
- Legacy smoke checks: `node test-db.js` (DB init), `node test_indicators.js` (indicators).
- When you change a file, run its sibling test(s); there is no aggregate command, so run the handful relevant to the diff.

### MOEX / T-Bank research & sandbox forward-test
The active research line (recent work) targets MOEX equities via the **T-Invest MCP**, separate from the crypto bot:
- Validated edge: `node backtest/moex-walkforward.mjs` (DONCHIANTREND 1D + 200-DMA regime gate, frozen-holdout). See `backtest/moex-xsectional.mjs`, `ob-probe.mjs`, `ob-fade.mjs` for the negative results.
- Live signal/sizing snapshot: `node backtest/live-signals.mjs` (reads `market_data.db`).
- Daily sandbox forward-test routine: `node backtest/merge-candles.mjs from` → fetch tail via MCP into `data/live-candles/_incoming/` → `node backtest/merge-candles.mjs` (dedup/merge) → `node backtest/routine-signals.mjs` (emits a JSON trade plan). Orchestrated by a scheduled task; see its SKILL.md.

## Architecture & Structure

### High-Level Flow
1. **Strategy Definition**: 
   - **Extraction**: Raw strategy descriptions or PineScript (`/strategy`) are processed using AI prompts (`/prompts`) to generate structured logic.
   - **Definition**: Strategies are stored as JSON configurations in the `/strategies` directory (or managed via the database).
   - **Templates**: Strategies use a template-based system (Logic and Risk templates) located in `/templates` to allow for reusable base configurations with specific overrides.
2. **Market Data**: Data is fetched from TradingView MCP (local) or Binance API (cloud).
3. **Trading Engine (`bot_engine.js`)**: 
   - Calculates indicators (Breakout Channels, SMC, Order Blocks, FVG).
   - Determines trade side (BUY/SELL) based on trend or breakout direction.
   - Executes a **Safety Check** based on the resolved strategy configuration.
   - Places orders via BitGet API if all conditions pass.
   - Logs trades to `trades.csv` and `trading_lab.db`.
4. **Orchestrator (`server.js`)**:
   - Manages multiple bot processes as child processes.
   - Provides a REST API for toggling strategies and updating configs.
   - Broadcasts real-time events via Socket.io to the frontend.
5. **Dashboard (`/frontend`)**:
   - React-based UI to monitor strategy performance, win rates, and active positions.

### `src/` layered architecture (the part that needs multiple files to grasp)
The root files (`bot_engine.js`, `manager.js`, `server.js`, `db.js`) are thin; the logic lives under `src/`:
- `src/core/`: the **shared signal→decision pipeline** (`pipeline.js`, `SignalAdapter.js`, `contracts.js`). This is the spine — both live (`bot_engine.js`) and backtest (`src/backtest/simulator.js`) feed candles through the *same* path so behavior is identical. **Invariant: this path must stay byte-identical between live and sim — the backtest never forks the decision logic.** `aggregateHTF.js`/`classifyHTFTrend.js` build the higher-timeframe context.
- `src/indicators/`: pluggable logic types registered in `index.js` (SMC, Breakout, Reversal, VMC_CipherB, plus research ones: `donchianTrend`, `rangeFilter`, `smcZone`, `scalpBreakout`, `trendPullback`). Each exports a pure `execute(candles, config)` → `{side, ...}`. `technical.js` holds primitives (ATR, Donchian, etc.).
- `src/agents/`: the AI agent layer — `AgentOrchestrator` drives `AnalystAgent`/`ObAnalyst` → `deriveAgentProposal` → `RiskPolicy` (sizing & guardrails, the single source of truth for `sizeUSD`, leverage, minRR — see backtest README) → `TradeExecutor`. `PositionLedger` tracks open state.
- `src/backtest/`: the deterministic engine (`simulator.js`, `execution.js`, `exitPolicy.js`, `metrics.js`, `htfGate.js`, `funding.js`, `liquidation.js`) + `BacktestRepo.js`.
- `src/marketdata/orderbook/`: order-book/tape subsystem (`OrderBookFeed`, `LocalOrderBook`, `Recorder`/`replay`, `obFeatures`/`tapeFeatures`, `obGate`, `liveObEngine`). Powers the order-flow research probes.
- `src/data/`: `MarketDataRepo` + `marketDataSchema` — candle storage and fetch.
- `src/server/`: the routed API (`routes/`, `services/`, `dtos/`, `schemas/`) that `server.js` mounts.
- `src/config_resolver.js`: merges Logic + Risk templates into a runtime config (see Casing Policy).

### Three separate SQLite databases (don't conflate them)
- `trading_lab.db` (via `db.js`): live bot state — `strategies`, `trades`, `events`, `active_positions`.
- `market_data.db` (via `src/data/`): historical candles for research/backtest (`candles`, `contract_specs`). Query it, don't assume contents (see backtest README).
- `backtest.db` (via `src/backtest/BacktestRepo.js`): persisted backtest runs/trades/equity, tagged by `--group`.

### T-Invest (T-Bank) MCP — execution safety
Two MCP servers: **`t-invest`** (production) is **READ-ONLY** (market data/candles only — never place orders with it) and **`t-invest-sandbox`** (order placement authorized for paper-testing only). Real-money execution must never route through MCP. Tokens live in MCP config / `.env` (gitignored), never committed.

## Development Guidelines

### Casing Policy
To prevent configuration mismatches between DB/JSON and JS:
- **Storage**: Use `snake_case` for keys in JSON templates and Database columns.
- **Runtime**: Use `camelCase` for keys in JavaScript objects after `resolveConfig` is called.
- **Caution**: Always check if a key should be `safetyChecks` (JS) or `safety_checks` (JSON/DB). Use `src/utils/casing.js` for transformations.

### Trade Execution Logic
- **Side Determination**: The `side` (BUY/SELL) is decided dynamically by the `IndicatorManager` based on the strategy type.
- **Position Locking**: A new trade for a symbol is only attempted if no `active_position` exists for that symbol in the database.
- **Mirrored Risk**: Ensure Stop Loss and Take Profit are calculated relative to the `side` (e.g., for SELL, SL is above price).

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
