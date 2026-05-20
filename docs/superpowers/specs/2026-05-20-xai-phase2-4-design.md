# Design Spec: XAI Phase 2-4 - Quantitative Persistence, Flow & Visualization

**Date:** 2026-05-20
**Status:** Finalized
**Topic:** Extending the XAI (Explainable AI) framework from calculation to persistence, real-time delivery, and visual representation.

## 1. Overview
Phase 1 introduced the Global Confidence Index (GCI) and individual rule scoring. This spec covers the remaining phases to make these insights permanent, real-time, and human-readable.

## 2. Phase 2: Data Persistence (The Memory)
To move beyond simple logging and enable strategy optimization, we transition from JSON-blobs to a relational scoring model.

### 2.1 Database Schema
A new table `event_scores` will be created to store the atomic result of every safety check.

**Table: `event_scores`**
- `id` (INTEGER, PK): Unique identifier.
- `event_id` (INTEGER, FK $\rightarrow$ `events.id`): Link to the parent event.
- `rule_id` (TEXT): The identifier of the rule (e.g., `wt_oversold`).
- `score` (REAL): The calculated confidence score (0.0 to 1.0).
- `actual_value` (TEXT): The raw indicator value at the time of check.
- `timestamp` (DATETIME): Record creation time.

### 2.2 Persistence Strategy
- **Atomic writes**: Every `safety_check` event in the `events` table will be accompanied by $N$ rows in `event_scores` (where $N$ is the number of rules executed).
- **Analytical Capability**: This allows SQL queries to calculate average rule performance, identify "bottleneck" rules, and correlate specific scores with trade success/failure.

## 3. Phase 3: Real-time Flow (The Pipe)
The goal is to deliver XAI insights to the dashboard with zero impact on the bot's execution performance.

### 3.1 Architecture: Asynchronous Relay
1.  **Bot Engine**: Performs a non-blocking HTTP POST to the server's `/event` endpoint.
2.  **Orchestrator Server**:
    - **DB Transaction**: Wraps the `events` insert and the `event_scores` bulk insert in a single transaction to ensure data integrity.
    - **WebSocket Broadcast**: Immediately emits the payload via Socket.io (`event:update`) to all connected clients.
3.  **Frontend**: Listens for `safety_check` events and updates the UI state reactively.

### 3.2 Performance Guarantee
The bot does not perform direct DB operations. By offloading persistence and broadcasting to the server, the bot's main loop latency remains constant regardless of the complexity of the XAI logging.

## 4. Phase 4: Frontend Visualization (The Insight)
Transform raw numbers into a "Confidence Dashboard" that allows traders to understand the *why* behind every decision.

### 4.1 UI Components
- **GCI Gauge**: A semi-circular gauge reflecting the Global Confidence Index.
    - **Red (0.0-0.4)**: Critical dissonance.
    - **Yellow (0.4-0.7)**: Neutral/Uncertain.
    - **Green (0.7-1.0)**: Strong confirmation.
- **Confidence List**: A list of rules where each rule has a mini-progress bar representing its specific score.
- **XAI Tooltips**: Hovering over a rule score reveals the mathematical logic:
    - *Format*: "Score [X]: Current [Value] vs Threshold [T] (Buffer: [B])".

## 5. Success Criteria
- **Zero Latency Spike**: Bot execution time remains unchanged.
- **Data Integrity**: Every event in the `events` table has corresponding entries in `event_scores`.
- **Real-time Update**: The GCI Gauge on the dashboard updates within <100ms of the bot's calculation.
- **Interpretability**: A user can identify exactly which rule lowered the GCI without looking at the code.
