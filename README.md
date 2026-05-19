# 🚀 TradingLab_AI

**TradingLab_AI** is a high-performance automated trading laboratory designed for the rapid development, testing, and execution of algorithmic trading strategies. It leverages the power of AI and the TradingView MCP to bridge the gap between chart analysis and real-world exchange execution.

## 🌟 Core Concept

The system transforms trading strategies—whether derived from professional traders, quantitative models, or AI-generated hypotheses—into a strictly validated execution pipeline.

**Analysis $\rightarrow$ Validation $\rightarrow$ Execution $\rightarrow$ Monitoring**

## 🏗️ Architecture

The project is built as a modular ecosystem:

1.  **Orchestrator (`server.js`)**: The central nervous system. Manages multiple bot instances as child processes, provides a REST API for control, and broadcasts real-time events via Socket.io.
2.  **Trading Engine (`bot_engine.js`)**: The execution core.
    *   **Indicator Suite**: Calculates advanced technicals (Breakout Channels, SMC, Order Blocks, FVG, etc.).
    *   **Safety Check**: A rigid validation layer where every strategy rule must be `true` before an order is placed.
    *   **Exchange Integration**: Direct execution via API (e.g., BitGet).
3.  **Trading Lab Dashboard (`/frontend`)**: A professional React-based interface for real-time monitoring of active positions, strategy performance, and engine logs.
4.  **Strategy Layer**: JSON-based definitions that allow switching strategies without changing the core engine code.

## 🛠️ Getting Started

### Prerequisites
- **Node.js 18+**
- **TradingView MCP** configured locally.
- **Exchange API Keys** (with withdrawals disabled and IP whitelisting enabled).

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

### Running the Lab
- **Start the Server**: `npm run server`
- **Start the Dashboard**: `npm run frontend`
- **Run Bot Manually**: `node bot.js`

## 🛡️ Safety First

TradingLab_AI is designed with a **"Zero Trust"** approach to execution:
- **Hard Constraints**: Maximum trade size and daily caps are enforced at the engine level.
- **Detailed Logging**: Every decision, whether it resulted in a trade or a skip, is logged with the exact indicator values seen at that moment.
- **Paper Trading**: Built-in simulation mode to verify logic before risking capital.

---
*Disclaimer: This software is for educational and research purposes. Trading involves significant risk. Use at your own discretion.*
