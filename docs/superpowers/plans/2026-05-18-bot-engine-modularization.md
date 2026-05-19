# Bot Engine Modularization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `bot_engine.js` into a modular service-oriented architecture while maintaining 100% logic parity.

**Architecture:** Layered approach: `IndicatorManager` (Math) $\rightarrow$ `SafetyValidator` (Rules) $\rightarrow$ `ExchangeService` (API). Orchestrated by `bot_engine.js`.

**Tech Stack:** Node.js, SQLite, BitGet API.

---

### Task 1: Infrastructure & Base Math
**Files:**
- Create: `src/indicators/technical.js`

- [ ] **Step 1: Implement base math functions**
Extract `calcStdDev`, `ema`, `sma`, `lowest`, and `highest` from `bot_engine.js` into `src/indicators/technical.js`.

```javascript
export const Technicals = {
  calcStdDev(values, period) { /* code from bot_engine.js:428-435 */ },
  ema(values, period) { /* code from bot_engine.js:440-451 */ },
  sma(values, period) { /* code from bot_engine.js:456-464 */ },
  lowest(values, period) { /* code from bot_engine.js:469-476 */ },
  highest(values, period) { /* code from bot_engine.js:481-488 */ },
};
```

- [ ] **Step 2: Commit**
`git add src/indicators/technical.js && git commit -m "refactor: extract base technical indicators"`

### Task 2: Indicator Modules
**Files:**
- Create: `src/indicators/wave-trend.js`
- Create: `src/indicators/smc.js`
- Create: `src/indicators/breakout.js`

- [ ] **Step 1: Implement WaveTrend module**
Extract `calcWaveTrend` into `src/indicators/wave-trend.js`. Import `Technicals` from `./technical.js`.

- [ ] **Step 2: Implement SMC module**
Extract `findPivots`, `detectStructure`, `detectOrderBlocks`, and `detectFVG` into `src/indicators/smc.js`.

- [ ] **Step 3: Implement Breakout module**
Extract `calcBreakoutChannels` into `src/indicators/breakout.js`. Import `Technicals` from `./technical.js`.

- [ ] **Step 4: Commit**
`git add src/indicators/*.js && git commit -m "refactor: modularize indicator logic"`

### Task 3: Indicator Manager (The Orchestrator)
**Files:**
- Create: `src/indicators/index.js`

- [ ] **Step 1: Implement `IndicatorManager` class**
Create a class that encapsulates the logic from `LogicExecutors` in `bot_engine.js`.

```javascript
import { Technicals } from './technical.js';
import { WaveTrend } from './wave-trend.js';
import { SMC } from './smc.js';
import { Breakout } from './breakout.js';

export class IndicatorManager {
  constructor(config) { this.config = config; }
  
  calculate(type, candles) {
    switch(type) {
      case 'SMC': return SMC.execute(candles, this.config);
      case 'Breakout': return Breakout.execute(candles, this.config);
      case 'VMC_CipherB': return WaveTrend.execute(candles, this.config);
      // ... other types
    }
  }
}
```

- [ ] **Step 2: Commit**
`git add src/indicators/index.js && git commit -m "refactor: implement IndicatorManager"`

### Task 4: Validator Layer
**Files:**
- Create: `src/validators/safety-rules.js`
- Create: `src/validators/index.js`

- [ ] **Step 1: Implement `SafetyRules`**
Move the `SafetyValidators` object from `bot_engine.js` to `src/validators/safety-rules.js` as a set of exported functions.

- [ ] **Step 2: Implement `SafetyValidator` class**
Create `src/validators/index.js` to iterate through `logic.safety_checks` and call the corresponding rule from `safety-rules.js`.

- [ ] **Step 3: Commit**
`git add src/validators/*.js && git commit -m "refactor: modularize safety validators"`

### Task 5: Exchange Service
**Files:**
- Create: `src/services/exchange/base-exchange.js`
- Create: `src/services/exchange/bitget.js`

- [ ] **Step 1: Implement `BaseExchange` interface**
Create a class that defines required methods like `placeOrder()`, `cancelOrder()`, `getBalance()`.

- [ ] **Step 2: Implement `BitGetService`**
Move `signBitGet` and `placeBitGetOrder` into `BitGetService` extending `BaseExchange`. Use the `CONFIG` object for keys.

- [ ] **Step 3: Commit**
`git add src/services/exchange/*.js && git commit -m "refactor: implement BitGet exchange service"`

### Task 6: Integration & Shadow Mode (The Critical Part)
**Files:**
- Modify: `bot_engine.js`

- [ ] **Step 1: Instantiate services**
Import and create instances of `IndicatorManager`, `SafetyValidator`, and `BitGetService` at the start of `run()`.

- [ ] **Step 2: Implement Shadow Mode Logic**
Inside the `while` loop, execute both the OLD monolithic logic and the NEW modular logic.

```javascript
// OLD PATH
const oldResults = runOldSafetyCheck(...);

// NEW PATH
const newMarketData = indicatorManager.calculate(type, candles);
const newResults = safetyValidator.run(price, open, newMarketData, config);

// PARITY CHECK
if (JSON.stringify(oldResults) !== JSON.stringify(newResults)) {
    console.error("!!! PARITY ERROR !!!");
    await logEventSimple(strategyId, "CRITICAL", "Modular logic differs from monolithic");
}
```

- [ ] **Step 3: Verify Parity**
Run the bot for several cycles. Verify in logs that no "PARITY ERROR" occurs.

- [ ] **Step 4: Switch to Modular and Cleanup**
Remove the old monolithic functions and the shadow mode check. Ensure only the new services are used.

- [ ] **Step 5: Final Commit**
`git add bot_engine.js && git commit -m "refactor: complete modularization and verify parity"`
