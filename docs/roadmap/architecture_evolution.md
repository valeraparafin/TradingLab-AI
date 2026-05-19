# Architecture Evolution Roadmap

This document outlines the strategic technical debt and architectural improvements needed to evolve the Trading Lab from a prototype to a production-grade trading system.

## 1. Data Integrity & Truth Source
**Current Problem:** Configuration is duplicated across SQLite and JSON files. This leads to "split-brain" scenarios where the bot and dashboard might see different settings.

**Proposed Solution:**
- **Database-First Approach:** Move all strategy configurations exclusively to the database.
- **Dynamic Loading:** The bot should fetch its configuration via API call to the orchestrator server upon startup and on-demand during runtime.
- **Eliminate File-Based Configs:** Remove the `/strategies` folder entirely.

**Benefit:** Single source of truth, guaranteed consistency, and easier backups.

---

## 2. Runtime Configuration (Hot Reload)
**Current Problem:** Updating a setting requires killing the bot process and restarting it (`SIGTERM` $\rightarrow$ `spawn`). This causes trade gaps and unnecessary overhead.

**Proposed Solution:**
- **Signal-Based Updates:** Implement a communication channel (via `process.send` or a dedicated Socket.io event) to notify the bot that its config has changed.
- **Internal State Refresh:** Modify `bot_engine.js` to listen for these updates and refresh its internal `strategyConfig` object without exiting the loop.

**Benefit:** Zero-downtime updates and smoother operation.

---

## 3. Data Normalization & Analytics
**Current Problem:** Strategy settings are stored as a JSON blob in the database. This makes it impossible to perform efficient SQL queries (e.g., "Find all strategies with SL < 1%").

**Proposed Solution:**
- **Relational Settings Table:** Replace the `config` column with a separate `strategy_settings` table:
  `strategy_id | setting_key | setting_value`
- **Template Integration:** Store template overrides as explicit rows in this table.

**Benefit:** Advanced analytics, easier auditing, and professional-grade data management.

---

## 4. Scalability & Process Management
**Current Problem:** The orchestrator manages bots as raw child processes. As the number of strategies grows, this becomes hard to monitor and scale.

**Proposed Solution:**
- **Process Manager Integration:** Transition from raw `spawn` to a professional manager like **PM2** or a custom-built worker pool.
- **Health Checks:** Implement a "heartbeat" mechanism where bots report their status to the server every X seconds.

**Benefit:** Better stability, automatic recovery from crashes, and professional monitoring.

---

## 5. Performance & Latency
**Current Problem:** Frequent API calls and JSON parsing in the main loop.

**Proposed Solution:**
- **In-Memory Caching:** Use a fast cache (like Redis or a simple internal Map) for frequently accessed templates and common settings.
- **Optimized Data Flow:** Streamline the communication between the bot and the server to reduce JSON overhead.

**Benefit:** Reduced latency in trade execution.
