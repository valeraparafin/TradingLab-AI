# Technical Debt & Feature Backlog

This document tracks specific technical improvements and feature requests that are not yet implemented but are planned for future iterations.

## 🛠 Technical Debt (High Priority)

- [ ] **Unify Config Source:** Move from `DB + JSON Files` $\rightarrow$ `DB Only`.
- [ ] **Implement Hot Reload:** Enable config updates without restarting bot processes.
- [ ] **Normalize Strategy Tables:** Move JSON config blobs to a relational `settings` table.
- [ ] **Add Heartbeat System:** Implement a health check for active bot processes.

## 🚀 Feature Requests (Future Enhancements)

### 📈 Trading Engine
- [ ] **ATR-Based Stops:** Replace fixed percentage SL/TP with volatility-based stops (Average True Range).
- [ ] **Partial Profit Taking:** Implement logic to close portions of a position (e.g., 50% at TP1, 50% at TP2).
- [ ] **Break-Even Logic:** Automatically move SL to entry price after a certain profit threshold is reached.
- [ ] **Trailing Stop:** Implement a trailing stop based on swing highs/lows or ATR.

### 📊 Dashboard & UX
- [ ] **Explainable AI (XAI) Framework:** Transition from binary safety checks to quantitative confidence scores (AI Logic Breakdown).
- [ ] **Visual Strategy Editor:** A GUI for building logic/risk templates without editing JSON.
- [ ] **Real-time PnL Charting:** Integration of TradingView charts showing actual trade entry/exit points.
- [ ] **Advanced Analytics:** Correlation matrix between different strategies to avoid over-exposure to one asset.

### ⚙️ System & Infrastructure
- [ ] **Multi-Exchange Support:** Expand beyond BitGet to include Binance/Bybit.
- [ ] **Notification System:** Telegram/Discord alerts for trades, errors, and daily summaries.
- [ ] **Auto-Optimization (Backtesting):** A tool to find the best SL/TP percentages for a strategy based on historical data.
