# Dynamic Position Sizing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement GCI-driven dynamic position sizing, a confidence floor (0.8), and portfolio-level risk management to allow multiple concurrent positions.

**Architecture:** 
1. **Portfolio Risk Tracking**: Replace single-position check with a sum of `size_usd` from `active_positions` table.
2. **Confidence Filtering**: Insert a hard check for $\text{GCI} \ge 0.8$ before trade execution.
3. **Linear Scaling**: Calculate trade size based on the formula $R_{final} = R_{base} \times (0.5 + 0.5 \times \frac{\text{GCI} - 0.8}{0.2})$.
4. **One-Way Constraints**: Maintain "one position per symbol" while allowing multiple symbols.

**Tech Stack:** Node.js, SQLite.

---

### Task 1: Risk Calculation Helpers

**Files:**
- Modify: `bot_engine.js`

- [ ] **Step 1: Implement `calculateTotalOpenRisk(strategyId)`**
  Create a helper function that queries `active_positions` for the given `strategyId` and returns the sum of `size_usd` for all 'OPEN' positions.
  ```javascript
  async function calculateTotalOpenRisk(strategyId) {
    const db = getDB();
    const result = await db.get(
      "SELECT SUM(size_usd) as totalRisk FROM active_positions WHERE strategy_id = ? AND status = 'OPEN'",
      [strategyId]
    );
    return result?.totalRisk || 0;
  }
  ```

- [ ] **Step 2: Verify helper with a test run**
  Add a temporary log to print total risk at the start of the cycle.

- [ ] **Step 3: Commit**
  ```bash
  git add bot_engine.js
  git commit -m "feat(risk): add total open risk calculation"
  ```

---

### Task 2: Confidence Floor & Sizing Logic

**Files:**
- Modify: `bot_engine.js`

- [ ] **Step 1: Implement GCI Floor and Scaling Formula**
  In the main loop, after `safetyValidator.run`, implement the logic:
  ```javascript
  const confidenceFloor = 0.8;
  const baseRiskUSD = 2.0; // This should eventually come from config

  if (gci < confidenceFloor) {
    // Block trade logic...
  } else {
    const scalingFactor = (gci - confidenceFloor) / (1.0 - confidenceFloor);
    const finalTradeSize = baseRiskUSD * (0.5 + 0.5 * scalingFactor);
    // Use finalTradeSize for order...
  }
  ```

- [ ] **Step 2: Integrate GCI Floor into the Decision Tree**
  Update the `if (!allPass)` block to also include `if (gci < confidenceFloor)`. Log the specific reason: "Blocked by Confidence Floor (GCI: X.XX)".

- [ ] **Step 3: Commit**
  ```bash
  git add bot_engine.js
  git commit -m "feat(risk): implement GCI confidence floor and dynamic scaling"
  ```

---

### Task 3: Portfolio Risk Enforcement

**Files:**
- Modify: `bot_engine.js`

- [ ] **Step 1: Update Trade Entry Condition**
  Replace the logic that blocks trades if *any* position is active with:
  1. Check if current symbol has an active position (Keep this).
  2. Calculate `totalOpenRisk` using the helper from Task 1.
  3. Check if `totalOpenRisk + finalTradeSize <= (portfolioValue * 0.10)`. (Using 10% as default limit).

- [ ] **Step 2: Log Portfolio Risk Status**
  Print `Current Portfolio Risk: $X.XX / $Limit` in the console during the decision phase.

- [ ] **Step 3: Commit**
  ```bash
  git add bot_engine.js
  git commit -m "feat(risk): enforce total portfolio risk limit"
  ```

---

### Task 4: Order Placement Update

**Files:**
- Modify: `bot_engine.js`

- [ ] **Step 1: Replace static `tradeSize` with `finalTradeSize`**
  Ensure the variable calculated in Task 2 is passed to `bitgetService.placeOrder` and `recordTrade`.

- [ ] **Step 2: Update `updateActivePosition` call**
  Ensure the `sizeUSD` passed to the database is the dynamic `finalTradeSize`.

- [ ] **Step 3: Commit**
  ```bash
  git add bot_engine.js
  git commit -m "feat(risk): update order placement to use dynamic size"
  ```

---

### Task 5: End-to-End Verification

- [ ] **Step 1: Test Confidence Floor**
  Force a strategy to have GCI 0.7 $\rightarrow$ Verify trade is BLOCKED.
- [ ] **Step 2: Test Scaling**
  Run with GCI 0.8 $\rightarrow$ Verify size is $\approx \$1.0$.
  Run with GCI 1.0 $\rightarrow$ Verify size is $\approx \$2.0$.
- [ ] **Step 3: Test Portfolio Limit**
  Open 2-3 positions $\rightarrow$ Verify that once the sum of risk hits the limit, new trades are BLOCKED even with high GCI.
- [ ] **Step 4: Test Symbol Isolation**
  Verify that having an open position in BTC does NOT block a signal for ETH.
- [ ] **Step 5: Final Commit**
  ```bash
  git commit -m "test: verify dynamic position sizing and portfolio risk"
  ```
