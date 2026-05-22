# Server Modularization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `server.js` from a monolith into a modular Controller-Service-Schema architecture to improve maintainability and readability.

**Architecture:** 
- **Schemas Layer**: Centralized Zod validation.
- **Services Layer**: Pure business logic and data access (Bot management, Template handling, Strategy assembly).
- **Routes Layer**: Request handling and dispatching to services.
- **Entry Point**: `server.js` handles bootstrap and routing mounting.

**Tech Stack:** Node.js, Express, Zod, SQLite.

---

### Task 1: Schema Extraction

**Files:**
- Create: `src/server/schemas/strategy.schema.js`
- Modify: `server.js`

- [ ] **Step 1: Create schema file with all Zod definitions**
```javascript
import { z } from 'zod';

export const LogicTemplateSchema = z.object({
  name: z.string().min(1),
  type: z.string(),
  indicators: z.record(z.any()),
  safety_checks: z.array(z.object({
    id: z.string(),
    description: z.string(),
  })).optional(),
});

export const RiskTemplateSchema = z.object({
  name: z.string().min(1),
  settings: z.object({
    riskPerTradePercent: z.number().positive(),
    maxTradeSizeUSD: z.number().positive(),
    stopLossPercent: z.number().positive(),
    takeProfitPercent: z.number().positive(),
    maxTradesPerDay: z.number().int().positive(),
  }),
});

export const RiskSettingsSchema = z.object({
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

export const LogicConfigSchema = z.record(z.any());
```

- [ ] **Step 2: Replace schemas in `server.js` with imports**
```javascript
import { 
  LogicTemplateSchema, 
  RiskTemplateSchema, 
  RiskSettingsSchema, 
  LogicConfigSchema 
} from './src/server/schemas/strategy.schema.js';
```

- [ ] **Step 3: Commit**
```bash
git add src/server/schemas/strategy.schema.js server.js
git commit -m "refactor: extract zod schemas to separate module"
```

### Task 2: Bot Service Implementation

**Files:**
- Create: `src/server/services/bot.service.js`
- Modify: `server.js`

- [ ] **Step 1: Implement BotService class**
```javascript
import { spawn } from 'child_process';
import { getDB } from '../../db.js';

class BotService {
  constructor(io) {
    this.activeBots = new Map();
    this.io = io;
  }

  async spawnBot(strategyId) {
    const botProcess = spawn('node', ['bot_engine.js'], {
      stdio: 'inherit',
      env: { ...process.env, STRATEGY_ID: strategyId }
    });

    botProcess.on('exit', (code) => {
      console.log(`Bot for strategy ${strategyId} exited with code ${code}`);
      this.activeBots.delete(Number(strategyId));
      getDB().run('UPDATE strategies SET status = ? WHERE id = ?', ['stopped', strategyId]).catch(console.error);
      this.io.emit('event:update', {
        strategyId,
        type: 'status_change',
        payload: { status: 'stopped' }
      });
    });

    this.activeBots.set(Number(strategyId), botProcess);
    await getDB().run(
      'UPDATE strategies SET status = ?, last_run = CURRENT_TIMESTAMP WHERE id = ?',
      ['running', strategyId]
    );

    this.io.emit('event:update', {
      strategyId,
      type: 'status_change',
      payload: { status: 'running' }
    });

    return botProcess;
  }

  async stopBot(strategyId) {
    const botProcess = this.activeBots.get(Number(strategyId));
    if (botProcess) {
      botProcess.kill('SIGTERM');
      this.activeBots.delete(Number(strategyId));
    }
    const db = getDB();
    await db.run('UPDATE strategies SET status = ? WHERE id = ?', ['stopped', strategyId]);
    this.io.emit('event:update', {
      strategyId,
      type: 'status_change',
      payload: { status: 'stopped' }
    });
  }

  isActive(strategyId) {
    return this.activeBots.has(Number(strategyId));
  }
}

export const botService = new BotService(); // To be initialized with IO in server.js
```

- [ ] **Step 2: Update `server.js` to use `botService`**
Replace `activeBots` Map and `spawnBot`/`stopBot` functions with calls to `botService`.

- [ ] **Step 3: Commit**
```bash
git add src/server/services/bot.service.js server.js
git commit -m "refactor: move bot process management to BotService"
```

### Task 3: Template Service Implementation

**Files:**
- Create: `src/server/services/template.service.js`
- Modify: `server.js`

- [ ] **Step 1: Implement TemplateService**
(Extract the existing `TemplateService` class from `server.js` and add imports for `fsp`, `path`, and the new schemas).

- [ ] **Step 2: Update `server.js` to import `templateService`**
Remove the class definition from `server.js` and import it.

- [ ] **Step 3: Commit**
```bash
git add src/server/services/template.service.js server.js
git commit -m "refactor: move template management to TemplateService"
```

### Task 4: Strategy Service Implementation

**Files:**
- Create: `src/server/services/strategy.service.js`
- Modify: `server.js`

- [ ] **Step 1: Implement StrategyService**
Move `assembleStrategy`, `checkTemplateLock`, and the core logic of the `/api/strategies/config` endpoint into a `StrategyService` class.

- [ ] **Step 2: Update `server.js` to use `strategyService`**
Replace the standalone functions with service calls.

- [ ] **Step 3: Commit**
```bash
git add src/server/services/strategy.service.js server.js
git commit -m "refactor: move strategy assembly and DB logic to StrategyService"
```

### Task 5: Route Modularization

**Files:**
- Create: `src/server/routes/template.routes.js`
- Create: `src/server/routes/strategy.routes.js`
- Create: `src/server/routes/analytics.routes.js`
- Create: `src/server/routes/event.routes.js`
- Modify: `server.js`

- [ ] **Step 1: Create `template.routes.js`**
Move `/api/templates` endpoints here. Use `templateService`.

- [ ] **Step 2: Create `strategy.routes.js`**
Move `/api/strategies` and `/api/strategies/config` endpoints here. Use `strategyService` and `botService`.

- [ ] **Step 3: Create `analytics.routes.js`**
Move `/api/analytics`, `/api/export`, and `/api/strategies/stats` here.

- [ ] **Step 4: Create `event.routes.js`**
Move the `/event` webhook here.

- [ ] **Step 5: Mount all routers in `server.js`**
```javascript
import templateRoutes from './src/server/routes/template.routes.js';
import strategyRoutes from './src/server/routes/strategy.routes.js';
// ... other imports

app.use('/api/templates', templateRoutes);
app.use('/api/strategies', strategyRoutes);
app.use('/api/analytics', analyticsRoutes);
app.post('/event', eventRoutes);
```

- [ ] **Step 6: Commit**
```bash
git add src/server/routes/*.js server.js
git commit -m "refactor: modularize API routes into separate routers"
```

### Task 6: Final Cleanup and Verification

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Remove all legacy logic from `server.js`**
The file should now only contain: imports, Express setup, DB init, and router mounting.

- [ ] **Step 2: Run server and verify endpoints**
Test `/api/templates`, `/api/strategies/config`, and Bot toggling.

- [ ] **Step 3: Final Commit**
```bash
git add server.js
git commit -m "refactor: complete server modularization"
```
