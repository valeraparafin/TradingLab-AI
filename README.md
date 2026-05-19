# 🚀 TradingLab_AI

**TradingLab_AI** is a professional-grade automated trading laboratory designed for the rapid development, testing, and execution of algorithmic trading strategies. It leverages AI and the TradingView MCP to bridge the gap between chart analysis and real-world exchange execution.

---

## 🌟 Core Concept

The system transforms trading strategies—whether derived from professional traders, quantitative models, or AI-generated hypotheses—into a strictly validated execution pipeline.

**Analysis $\rightarrow$ Validation $\rightarrow$ Execution $\rightarrow$ Monitoring**

### Key Capabilities:
1. **AI-Driven Execution** — Reads TradingView charts and executes trades on supported exchanges automatically.
2. **Rigid Safety Check** — Every condition in your strategy must pass a validation layer before a trade is placed.
3. **24/7 Cloud Readiness** — Designed for deployment on VPS to run on a schedule without local hardware.
4. **Automatic Tax Accounting** — Every trade is logged to `trades.csv` with price, fees, and net amount, ready for reporting.
5. **Modular Architecture** — Decouples strategy logic (JSON) from the execution engine (JS).

---

## 🏗️ Architecture

The project is built as a modular ecosystem:

1.  **Orchestrator (`server.js`)**: The central nervous system. Manages multiple bot instances as child processes, provides a REST API for control, and broadcasts real-time events via Socket.io.
2.  **Trading Engine (`bot_engine.js`)**: The execution core.
    *   **Indicator Suite**: Calculates advanced technicals (Breakout Channels, SMC, Order Blocks, FVG, etc.).
    *   **Safety Check**: A rigid validation layer where every strategy rule must be `true` before an order is placed.
    *   **Exchange Integration**: Direct execution via API (e.g., BitGet).
3.  **Trading Lab Dashboard (`/frontend`)**: A professional React-based interface for real-time monitoring of active positions, strategy performance, and engine logs.
4.  **Strategy Layer**: JSON-based definitions that allow switching strategies without changing the core engine code.

---

## 🛠️ Getting Started

### Prerequisites
- **Node.js 18+**
- **TradingView MCP** configured locally.
- **Exchange API Keys** (IMPORTANT: withdrawals OFF, IP whitelist ON).

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/valeraparafin/TradingLab_AI.git
   cd TradingLab_AI
   ```
2. Install dependencies:
   ```bash
   npm install
   cd frontend && npm install && cd ..
   ```
3. Configure environment:
   ```bash
   cp .env.example .env
   # Edit .env with your API keys and portfolio settings
   ```

### Basic Usage
- **Start the Server**: `npm run server`
- **Start the Dashboard**: `npm run frontend`
- **Run Bot Manually**: `node bot.js`

---

## ☁️ Cloud Deployment (VPS)

To run the bot 24/7 without keeping your laptop open, deploy it to a VPS (e.g., Hostinger, AWS, DigitalOcean).

### 1. Setup
SSH into your VPS and install dependencies:
```bash
apt update && apt install -y nodejs npm git
git clone https://github.com/valeraparafin/TradingLab_AI.git bot && cd bot
npm install
```

### 2. Environment
Create a `.env` file on the VPS with your credentials, portfolio value, and risk limits.

### 3. Automation (Cron)
Schedule the bot to run based on your chart timeframe:
- **4H chart**: `0 */4 * * * cd /root/bot && /usr/bin/node bot.js >> bot.log 2>&1`
- **1D chart**: `0 9 * * * cd /root/bot && /usr/bin/node bot.js >> bot.log 2>&1`
- **1H chart**: `0 * * * * cd /root/bot && /usr/bin/node bot.js >> bot.log 2>&1`

---

## 📈 Strategy Development

### Building Custom Rules
Strategies are defined in JSON. You can create new logic by defining:
1. **Indicators**: Which technicals to monitor.
2. **Entry Rules**: The exact conditions (e.g., "Price > EMA 200") that must be met.
3. **Risk Rules**: Stop-loss, take-profit, and position sizing.

### Paper Trading
Set `PAPER_TRADING=true` in `.env`. The bot will log every decision and "simulate" the trade without sending real orders to the exchange. **Always paper trade a new strategy for several days before going live.**

---

## 🧾 Tax & Accounting

Every executed trade is recorded in `trades.csv`. This provides a transparent audit trail for accountants:

| Column | Description |
|--------|-------------|
| Date/Time | Exact timestamp of execution |
| Symbol | Asset traded (e.g., BTCUSDT) |
| Side | Buy or Sell |
| Price | Execution price |
| Total USD | Gross trade value |
| Fee | Estimated exchange fee |
| Net Amount | Final value after fees |

For a quick summary, run:
```bash
node bot.js --tax-summary
```

---

## 🛡️ Safety & Guardrails

TradingLab_AI implements a **Zero Trust** execution model:
- **Maximum Trade Size**: Capped by `MAX_TRADE_SIZE_USD` in `.env`.
- **Daily Cap**: Capped by `MAX_TRADES_PER_DAY` in `.env`.
- **Position Sizing**: Automatically calculated based on portfolio value (default max 1% risk per trade).
- **Detailed Logs**: Every decision is logged to `safety-check-log.json` with the exact values of indicators at the time of the check.

---
*Disclaimer: This software is for educational and research purposes. Trading involves significant risk. Use at your own discretion.*
