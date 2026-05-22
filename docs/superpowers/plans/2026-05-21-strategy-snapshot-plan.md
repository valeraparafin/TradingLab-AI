# Strategy Snapshot & Hybrid Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transition from template-merging to a snapshot model with decomposed professional risk parameters in DB columns and flexible trading logic in JSON.

**Architecture:** 
1. **Database**: Move risk parameters to a dedicated `strategy_risk_settings` table (1:1) and rename `strategies.config` to `strategies.logic_config`.
2. **Validation**: Use Zod schemas to enforce strict typing for risk parameters and structural integrity for logic configs.
3. **API**: Implement targeted `PATCH` endpoints for risk and logic, and a `POST` assembler for initial creation.
4. **UI**: Create a multi-section Strategy Editor with typed inputs, tooltips, and a restart guard.

**Tech Stack:** Node.js, SQLite, Zod, React, Tailwind CSS.

---

### Task 1: Database Schema & Data Migration

**Files:**
- Modify: `db.js`

- [ ] **Step 1: Update `initDB` to create `strategy_risk_settings` table**
  Add the following table definition to the `db.exec` call in `initDB()`:
  ```javascript
  CREATE TABLE IF NOT EXISTS strategy_risk_settings (
      strategy_id INTEGER PRIMARY KEY,
      risk_per_trade_percent REAL NOT NULL,
      stop_loss_percent REAL NOT NULL,
      take_profit_percent REAL NOT NULL,
      min_risk_reward_ratio REAL NOT NULL,
      max_portfolio_heat_percent REAL NOT NULL,
      max_open_positions INTEGER NOT NULL,
      max_trades_per_day INTEGER NOT NULL,
      daily_loss_limit_percent REAL NOT NULL,
      daily_profit_target_percent REAL NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (strategy_id) REFERENCES strategies (id) ON DELETE CASCADE
  );
  ```

- [ ] **Step 2: Implement migration function `migrateToSnapshotModel()`**
  Create a function in `db.js` that:
  1. Selects all from `strategies`.
  2. Parses the old `config` JSON.
  3. Extracts risk parameters (falling back to template defaults if missing).
  4. Inserts into `strategy_risk_settings`.
  5. Updates `strategies` by renaming `config` to `logic_config` (via temporary table if SQLite `RENAME COLUMN` is unavailable in the target version).

- [ ] **Step 3: Execute migration and verify**
  Run the migration and verify that `strategy_risk_settings` is populated and `strategies.logic_config` contains the logic part.

- [ ] **Step 4: Commit**
  ```bash
  git add db.js
  git commit -m "feat(db): implement hybrid snapshot schema and migration"
  ```

---

### Task 2: Backend Validation & API Layer

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Define Zod Schemas**
  Implement `RiskSettingsSchema` and `LogicConfigSchema`.
  ```javascript
  const RiskSettingsSchema = z.object({
    risk_per_trade_percent: z.number().positive().max(100),
    stop_loss_percent: z.number().positive().max(100),
    take_profit_percent: z.number().positive().max(100),
    min_risk_reward_ratio: z.number().positive(),
    max_portfolio_heat_percent: z.number().positive().max(100),
    max_open_positions: z.number().int().positive(),
    max_trades_per_day: z.number().int().positive(),
    daily_loss_limit_percent: z.number().positive().max(100),
    daily_profit_target_percent: z.number().positive().max(100),
  });
  ```

- [ ] **Step 2: Implement `POST /api/strategies` (Snapshot Assembler)**
  Update the handler to:
  1. Load logic and risk templates.
  2. Merge with overrides.
  3. Save `logic_config` to `strategies` and decomposed risk fields to `strategy_risk_settings` in a single transaction.

- [ ] **Step 3: Implement `PATCH /api/strategies/:id/risk`**
  Create endpoint that validates with `RiskSettingsSchema` and updates the `strategy_risk_settings` table.

- [ ] **Step 4: Implement `PATCH /api/strategies/:id/logic`**
  Create endpoint that merges updates into `logic_config` and saves it back to `strategies`.

- [ ] **Step 5: Implement `GET /api/strategies/full-config/:id`**
  Create endpoint that JOINs the two tables and returns a unified flat object.

- [ ] **Step 6: Add bot restart trigger**
  In both `PATCH` endpoints, if `activeBots.has(strategyId)`, call `stopBot(strategyId)` then `startBot(strategyId)`.

- [ ] **Step 7: Commit**
  ```bash
  git add server.js
  git commit -m "feat(api): implement snapshot API with Zod validation"
  ```

---

### Task 3: Bot Engine Integration

**Files:**
- Modify: `bot_engine.js`

- [ ] **Step 1: Update configuration loading**
  Replace the logic that reads `strategies.config` with a call to the new `full-config` structure (or a direct DB JOIN if the bot reads DB directly).
  Ensure the bot expects risk parameters as top-level properties rather than inside a `risk` object.

- [ ] **Step 2: Verify configuration consumption**
  Add logs to print the loaded professional risk parameters at startup.

- [ ] **Step 3: Commit**
  ```bash
  git add bot_engine.js
  git commit -m "feat(bot): consume flat snapshot configuration"
  ```

---

### Task 4: Frontend Strategy Editor - Risk & General

**Files:**
- Create: `frontend/src/components/StrategyEditor/RiskForm.tsx`
- Create: `frontend/src/pages/StrategyEditor.tsx`

- [ ] **Step 1: Build `RiskForm` component**
  Implement a grid-based form for the 10 professional risk parameters.
  Include `(?)` tooltips for each field with descriptions from the Design Spec.

- [ ] **Step 2: Build `StrategyEditor` main page**
  Implement the "General Info" section (Name, Status, Archive).
  Integrate the `RiskForm` component.

- [ ] **Step 3: Implement "Save" logic for Risk**
  Connect the form to `PATCH /api/strategies/:id/risk`. Implement a "Dirty State" check to only send requests if values changed.

- [ ] **Step 4: Commit**
  ```bash
  git add frontend/src/components/StrategyEditor/RiskForm.tsx frontend/src/pages/StrategyEditor.tsx
  git commit -m "feat(ui): add professional risk editor"
  ```

---

### Task 5: Frontend Strategy Editor - Dynamic Logic

**Files:**
- Create: `frontend/src/components/StrategyEditor/LogicForm.tsx`
- Modify: `frontend/src/pages/StrategyEditor.tsx`

- [ ] **Step 1: Build `LogicForm` component**
  Implement a dynamic form that maps over the `logic_config` JSON object.
  Use collapsible accordions to group settings (e.g., "Indicators", "Filters").

- [ ] **Step 2: Implement "Save" logic for Logic**
  Connect to `PATCH /api/strategies/:id/logic`.

- [ ] **Step 3: Implement Restart Guard**
  Add a confirmation modal that triggers when saving changes to a `running` strategy.

- [ ] **Step 4: Commit**
  ```bash
  git add frontend/src/components/StrategyEditor/LogicForm.tsx frontend/src/pages/StrategyEditor.tsx
  git commit -m "feat(ui): add dynamic logic editor with restart guard"
  ```

---

### Task 6: End-to-End Verification

- [ ] **Step 1: Test Creation Flow**
  Create a strategy using templates $\rightarrow$ Verify DB has separate records in `strategies` and `strategy_risk_settings`.

- [ ] **Step 2: Test Risk Update**
  Change a risk parameter in UI $\rightarrow$ Verify DB column updated $\rightarrow$ Verify bot restarts and logs new value.

- [ ] **Step 3: Test Logic Update**
  Change an indicator period in UI $\rightarrow$ Verify `logic_config` JSON updated $\rightarrow$ Verify bot restarts.

- [ ] **Step 4: Test Validation**
  Attempt to save a negative risk value $\rightarrow$ Verify Zod blocks the request and UI shows red error.

- [ ] **Step 5: Final Commit**
  ```bash
  git commit -m "test: verify strategy snapshot and hybrid config end-to-end"
  ```
