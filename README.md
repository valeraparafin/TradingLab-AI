# 🚀 TradingLab AI

Professional-grade automated trading laboratory for rapid development, testing, and execution of algorithmic strategies. Bridges the gap between TradingView analysis and real-world exchange execution using AI and a rigid validation pipeline.

**Analysis $\rightarrow$ Validation $\rightarrow$ Execution $\rightarrow$ Monitoring**

---

## 🌟 Key Capabilities

- **Centralized Orchestration**: Manage multiple bots and strategies from a single professional dashboard.
- **AI-Driven Pipeline**: Automated transition from chart analysis to exchange execution.
- **Zero-Trust Safety**: Rigid validation layer where every strategy rule must be `true` before any order is placed.
- **Real-time Observability**: Live monitoring of active positions, engine logs, and strategy performance.
- **Audit Trail**: Automatic trade logging for tax accounting and performance analysis.

---

## 🏗️ Architecture

- **Orchestrator (`server.js`)**: Central nervous system. Manages bot processes, REST API, and real-time Socket.io broadcasts.
- **Trading Engine (`bot_engine.js`)**: Execution core featuring:
    - **Indicator Suite**: Advanced technicals (SMC, Order Blocks, FVG, Breakout Channels, etc.).
    - **Safety Validator**: Final guardrail for risk and rule compliance.
    - **Exchange Services**: Modular integration (e.g., BitGet).
- **Control Dashboard (`/frontend`)**: React-based UI for strategy toggling, configuration, and live monitoring.
- **Strategy Layer**: Dynamic JSON-based definitions for logic and risk management.

---

## 🛠️ Quick Start

### Prerequisites
- **Node.js 18+**
- **TradingView MCP** configured locally.
- **Exchange API Keys** (Withdrawals OFF, IP Whitelist ON).

### Installation
```bash
git clone https://github.com/valeraparafin/TradingLab_AI.git
cd TradingLab_AI
npm install
cd frontend && npm install && cd ..
cp .env.example .env # Configure your API keys and portfolio
```

### Launch
1. **Start Server**: `npm run server`
2. **Start Dashboard**: `npm run frontend`
3. **Activate**: Open the dashboard, select a strategy, and toggle to **Active**.

---

## 🛡️ Safety & Risk Management

- **Hard Caps**: Maximum trade size and daily trade limits enforced via `.env`.
- **Dynamic Sizing**: Position sizes calculated automatically based on real-time portfolio value.
- **Paper Trading**: Full simulation mode (`PAPER_TRADING=true`) for risk-free strategy validation.
- **Decision Logs**: Every execution step is recorded in `safety-check-log.json`.

---

## 📈 Strategy Development

Strategies are decoupled from code via JSON templates:
- **Logic Templates**: Define the technical conditions and indicators.
- **Risk Templates**: Define stop-loss, take-profit, and aggressive/conservative profiles.

*Disclaimer: For educational and research purposes. Trading involves significant risk.*
