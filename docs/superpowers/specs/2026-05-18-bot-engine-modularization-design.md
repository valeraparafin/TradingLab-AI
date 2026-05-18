# Design: Bot Engine Modularization
Date: 2026-05-18
Status: Proposed

## 1. Objective
Refactor `bot_engine.js` from a monolithic file (~1200+ lines) into a modular, service-oriented architecture. The goal is to improve maintainability, enable easier debugging, and allow for future scalability (e.g., adding new exchanges or complex indicators) without risking the stability of the core trading logic.

## 2. Architecture

### 2.1 High-Level Structure
The system will move from a single file to a layered architecture located in `src/`.

```text
src/
├── indicators/
│   ├── index.js             # IndicatorManager: Orchestrates all calculations
│   ├── technical.js         # Base math: EMA, SMA, StdDev
│   ├── wave-trend.js        # WaveTrend logic
│   ├── smc.js               # SMC logic: Pivots, BOS, CHoCH, OB, FVG
│   └── breakout.js          # Breakout Channel logic
├── validators/
│   ├── index.js             # Validation orchestrator
│   └── safety-rules.js      # Individual safety check implementations
├── logic/
│   └── executors.js         # LogicExecutors: Maps strategies to indicator sets
└── services/
    └── exchange/
        ├── base-exchange.js # Abstract Exchange interface
        └── bitget.js        # BitGet specific implementation
```

### 2.2 Component Responsibilities
- **IndicatorManager**: Accepts `candles` and `config`, calls specific indicator modules, and returns a unified `strategyData` object.
- **SafetyValidator**: Accepts `price`, `open`, `strategyData`, and `config`. Executes rules from `safety-rules.js` and returns a pass/fail result.
- **ExchangeService**: Handles API authentication, request signing, and order placement. It abstracts the exchange-specific API calls.
- **BotEngine (bot_engine.js)**: Acts as the orchestrator. It manages the main loop, database interactions, and coordinates the flow between the services above.

## 3. Data Flow
The system follows a strict unidirectional data flow to ensure predictability:

`Market API` $\rightarrow$ `candles` $\rightarrow$ `IndicatorManager` $\rightarrow$ `strategyData` $\rightarrow$ `SafetyValidator` $\rightarrow$ `Decision (allPass)` $\rightarrow$ `ExchangeService` $\rightarrow$ `Order Execution`.

**Invariant:** The format of `strategyData` and the return values of validators must remain identical to the current implementation to prevent logic regression.

## 4. Error Handling & Safety

### 4.1 Layered Error Recovery
- **Module Level**: Each indicator/validator module uses internal `try-catch` to prevent a single calculation error from crashing the engine. Failed indicators return a `null` or `error` state.
- **Engine Level**: The main loop catches any service-level exceptions, logs them to the DB, and blocks trading for the affected symbol for that cycle, ensuring the bot continues to process other symbols.

### 4.2 Verification Strategy
To ensure zero regression:
1. **Shadow Mode**: Temporary implementation where both old (monolithic) and new (modular) logic run in parallel.
2. **Consistency Check**: The engine will compare results from both paths. Any discrepancy triggers a critical log event without placing a real trade.
3. **Phase-out**: Old code is removed only after $N$ successful identical cycles.

## 5. Success Criteria
- `bot_engine.js` size reduced by $\approx 70-80\%$.
- 100% parity in trading decisions between old and new architecture.
- Ability to add a new indicator or exchange by creating a new file without modifying the core loop logic.
- Verified logs showing successful "Shadow Mode" parity.
