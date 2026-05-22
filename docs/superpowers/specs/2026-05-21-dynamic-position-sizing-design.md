# Design Spec: Dynamic Position Sizing & Portfolio Risk Management

**Date:** 2026-05-21
**Status:** Finalized
**Topic:** Transitioning from static trade sizing to a GCI-driven dynamic risk model with portfolio-level constraints.

## 1. Overview
The current bot logic allows only one active position per strategy and uses a static risk percentage. This spec implements a professional risk management system that scales position size based on the Global Confidence Index (GCI), allows multiple concurrent positions across different symbols, and enforces a total portfolio risk limit.

## 2. Risk Logic & Formulas

### 2.1 The Confidence Floor
To filter out low-conviction trades, a minimum GCI threshold is introduced.
- **Confidence Floor:** $0.8$
- **Rule:** If $\text{GCI} < 0.8$, the trade is blocked regardless of other safety checks.

### 2.2 Dynamic Position Sizing
For trades that meet the confidence floor, the risk amount is scaled linearly between $0.8$ and $1.0$.
- **Base Risk ($R_{base}$):** Defined in config (e.g., $\$2.00$).
- **Scaling Factor ($S$):** $\frac{\text{GCI} - 0.8}{1.0 - 0.8}$
- **Final Trade Risk ($R_{final}$):** $R_{base} \times (0.5 + 0.5 \times S)$
  - *Example GCI 0.8:* $R_{base} \times 0.5 = \$1.00$
  - *Example GCI 0.9:* $R_{base} \times 0.75 = \$1.50$
  - *Example GCI 1.0:* $R_{base} \times 1.0 = \$2.00$

### 2.3 Portfolio Risk Limit
To prevent over-exposure, the bot tracks the total risk of all open positions.
- **Max Portfolio Risk Limit:** $\text{Budget} \times \text{MaxRiskPercent}$ (e.g., $100 \times 10\% = \$10$).
- **Constraint:** $\sum (\text{Risk of all open positions}) + R_{final} \le \text{Max Portfolio Risk Limit}$.

## 3. Execution Flow (Decision Tree)

For every symbol in the watchlist:
1. **Symbol Check**: Is there an active position for this symbol? $\rightarrow$ **Yes**: Skip to monitoring exit. **No**: Proceed.
2. **Safety Checks**: Do all binary safety rules pass? $\rightarrow$ **No**: Block trade. **Yes**: Proceed.
3. **Confidence Check**: Is $\text{GCI} \ge 0.8$? $\rightarrow$ **No**: Block trade. **Yes**: Proceed.
4. **Portfolio Check**: Is $\text{Total Current Risk} + R_{final} \le \text{Limit}$? $\rightarrow$ **No**: Block trade. **Yes**: Proceed.
5. **Execution**: Place order with $R_{final}$.

## 4. Technical Changes

### 4.1 `bot_engine.js`
- **Refactor Position Checking**: Replace the single `activePosition` check with a call to a new function `calculateTotalOpenRisk()` that sums `size_usd` from `active_positions` table for the current `strategyId`.
- **Implement Sizing Logic**: Add the linear scaling formula for $R_{final}$.
- **Update Order Logic**: Pass the dynamic $R_{final}$ to the order placement service.

### 4.2 Configuration
Add the following to the strategy risk configuration:
- `confidenceFloor`: $0.8$
- `baseRiskUSD`: $2.0$
- `maxPortfolioRiskPercent`: $10$

## 5. Success Criteria
- **Risk Adherence**: No trade is ever placed with $\text{GCI} < 0.8$.
- **Portfolio Safety**: Total `size_usd` of open positions never exceeds the defined limit.
- **Correct Scaling**: A trade with GCI 0.8 is exactly half the size of a trade with GCI 1.0.
- **Concurrency**: Bot successfully holds positions in multiple different symbols simultaneously.
