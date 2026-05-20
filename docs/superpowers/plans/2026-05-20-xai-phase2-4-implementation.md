# XAI Phase 2-4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement quantitative data persistence for safety scores, establish a real-time delivery pipeline, and create a visual confidence dashboard.

**Architecture:** 
1. **Relational Persistence**: Move from JSON-only logging to a dedicated `event_scores` table for atomic rule results.
2. **Asynchronous Relay**: Bot $\rightarrow$ HTTP POST $\rightarrow$ Server $\rightarrow$ DB Transaction $\rightarrow$ Socket.io Broadcast.
3. **Reactive UI**: Frontend Gauge and Confidence List components reacting to WebSocket updates.

**Tech Stack:** SQLite, Node.js, Socket.io, React, Tailwind CSS.

---

### Task 1: Database Schema Expansion

**Files:**
- Modify: `db.js`

- [ ] **Step 1: Update `initDB` to create `event_scores` table**

```javascript
// Inside initDB() exec call
CREATE TABLE IF NOT EXISTS event_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    rule_id TEXT NOT NULL,
    score REAL NOT NULL,
    actual_value TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE
);
```

- [ ] **Step 2: Verify table creation**

Run: `node -e "import { initDB } from './db.js'; initDB().then(() => console.log('Success'))"`
Expected: Success

- [ ] **Step 3: Commit**

```bash
git add db.js
git commit -m "feat(db): add event_scores table for XAI persistence"
```

---

### Task 2: Server-side Persistence Logic

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Implement relational scoring transaction in `/event` endpoint**

Modify the `/event` handler to:
1. Insert the main event into `events` table.
2. Retrieve the `lastID` (event_id).
3. If `type === 'safety_check'`, iterate over `payload.results` and insert each rule's score into `event_scores`.

```javascript
// In app.post('/event', ...)
const eventId = await db.run(
  "INSERT INTO events (strategy_id, type, payload, timestamp) VALUES (?, ?, ?, ?)",
  [strategyId, type, JSON.stringify(payload), timestamp]
);

if (type === 'safety_check' && payload.results) {
  const scoreInserts = payload.results.map(r => 
    db.run(
      "INSERT INTO event_scores (event_id, rule_id, score, actual_value) VALUES (?, ?, ?, ?)",
      [eventId.lastID, r.label, r.score, r.actual]
    )
  );
  await Promise.all(scoreInserts);
}
```

- [ ] **Step 2: Verify DB inserts**

Run bot engine for one cycle, then:
`sqlite3 trading_lab.db "SELECT * FROM event_scores LIMIT 5;"`
Expected: Rows containing scores and rule IDs.

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat(server): implement relational scoring persistence for XAI"
```

---

### Task 3: Real-time Flow Verification

**Files:**
- Modify: `bot_engine.js` (Verify payload structure)

- [ ] **Step 1: Ensure bot sends `results` array with `score`**

Verify `bot_engine.js` sends the `results` array in the `safety_check` event payload. (This was done in Phase 1, but needs verification).

- [ ] **Step 2: Test WebSocket broadcast**

1. Start `npm run server`
2. Start `node bot_engine.js <id>`
3. Use a WebSocket client (or the frontend) to listen for `event:update`.
Expected: Event payload contains `gci` and `results` array with `score`.

- [ ] **Step 3: Commit**

```bash
git add bot_engine.js
git commit -m "chore: verify XAI real-time data flow"
```

---

### Task 4: GCI Gauge Component

**Files:**
- Create: `frontend/src/components/XAI/GCIGauge.tsx`

- [ ] **Step 1: Create Gauge component**

Implement a semi-circular gauge using SVG or a library like `recharts`. 
Logic: 
- 0.0-0.4: Red
- 0.4-0.7: Yellow
- 0.7-1.0: Green

- [ ] **Step 2: Integrate into Strategy Details view**

Add `<GCIGauge value={currentGci} />` to the main monitoring panel.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/XAI/GCIGauge.tsx frontend/src/components/StrategyDetails.tsx
git commit -m "feat(ui): add GCI Gauge for real-time confidence monitoring"
```

---

### Task 5: Rule Confidence List Component

**Files:**
- Create: `frontend/src/components/XAI/RuleConfidenceList.tsx`

- [ ] **Step 1: Create Rule List component**

Implement a list where each rule shows:
- Label
- Mini-progress bar (width = `score * 100%`)
- Numerical score (e.g., `0.85`)
- Tooltip showing `actual_value` vs `threshold`.

- [ ] **Step 2: Integrate into Strategy Details view**

Add `<RuleConfidenceList results={safetyResults} />` below the Gauge.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/XAI/RuleConfidenceList.tsx frontend/src/components/StrategyDetails.tsx
git commit -m "feat(ui): add detailed rule confidence list with XAI tooltips"
```

---

### Task 6: End-to-End Verification

- [ ] **Step 1: Functional Test**

1. Run bot $\rightarrow$ Check Dashboard.
2. Verify GCI Gauge moves in real-time.
3. Verify Rule bars match the console output.
4. Verify Tooltips show correct "actual" values.

- [ ] **Step 2: DB Audit**

Run: `sqlite3 trading_lab.db "SELECT * FROM event_scores ORDER BY timestamp DESC LIMIT 10;"`
Verify that every row matches a recent bot event.

- [ ] **Step 3: Final Commit**

```bash
git commit -m "test: verify end-to-end XAI flow and visualization"
```
