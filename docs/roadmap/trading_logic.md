# Trading Logic & Math Roadmap

This document focuses on improving the mathematical accuracy and risk management of the trading strategies.

## 1. Realistic PnL Calculation
- [ ] **Current State**: Simple price difference calculation.
- [ ] **Goal**: Account for all trading costs.
- [ ] **Details**:
    - **Exchange Fees**: Subtract maker/taker fees from the final PnL.
    - **Slippage Simulation**: In Paper Trading, add a small random penalty (0.01%-0.05%) to exit prices to simulate real market conditions.

## 2. Advanced Risk Management
- [ ] **Current State**: Per-trade limit and daily limit.
- [ ] **Goal**: Portfolio-level protection.
- [ ] **Details**:
    - **Global Drawdown Limit**: Stop all bots if the total account value drops by X% in a day.
    - **Correlation Filter**: Prevent opening too many positions in highly correlated assets (e.g., don't buy 5 different AI coins at once).
    - **Dynamic Position Sizing**: Adjust the amount invested based on the confidence level of the signal.

## 3. Strategy Optimization Tools
- [ ] **Current State**: Manual parameter tuning.
- [ ] **Goal**: Data-driven optimization.
- [ ] **Details**:
    - **Backtesting Engine**: Create a tool to run the strategy over historical data to find the best parameters.
    - **A/B Testing**: Run two versions of the same strategy with different settings to see which performs better on paper.
