# Transparency & Auditability Roadmap

This document focuses on making the bot's decision-making process fully transparent and debuggable.

## 1. Decision Audit Log (Snape-shots)
- [ ] **Current State**: General event logs (e.g., "All conditions met").
- [ ] **Goal**: Store the exact values of all indicators at the moment of entry/exit.
- [ ] **Details**:
    - Instead of just logging the result, save a JSON snapshot of all calculated indicators to the `events` table.
    - Example: `{ "WaveTrend": -65, "Trend": "Bullish", "Price_in_OB": true }`.
    - This allows for precise retrospective analysis of why a trade was opened or closed.

## 2. Trade Lifecycle Visualization
- [ ] **Current State**: Simple trade list.
- [ ] **Goal**: A detailed view of a single position's life.
- [ ] **Details**:
    - Link the entry trade, all intermediate events (monitoring logs), and the exit trade.
    - Create a timeline view for each position.

## 3. Performance Analytics (Deep Dive)
- [ ] **Current State**: Basic win rate and net PnL.
- [ ] **Goal**: Advanced trading metrics.
- [ ] **Details**:
    - Profit Factor (Gross Profit / Gross Loss).
    - Max Drawdown (the largest drop from peak to trough).
    - Expectancy (average amount won/lost per trade).
    - Equity curve visualization.
