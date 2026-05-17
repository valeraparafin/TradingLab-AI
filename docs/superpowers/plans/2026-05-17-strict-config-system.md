# Strict Template-Driven Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the strategy configuration system to use a strict Template + Overrides pattern, eliminating data duplication and fixing the "max trades per day" bug.

**Architecture:** Move from a "snapshot" approach (where full configs are copied into strategy files) to a "resolved" approach. The `bot_engine.js` will resolve the final configuration at runtime by merging a base template with strategy-specific overrides.

**Tech Stack:** Node.js, Zod (validation), fs/path (filesystem).

---

## File Mapping

### Modified Files
- `server.js`: Update `assembleStrategy` and `api/strategies/config` to save only overrides.
- `bot_engine.js`: Implement `resolveConfig` to merge templates and overrides at startup.
- `db.js`: (Optional) Update strategy schema if necessary, though `config` column is JSON.

### New Files
- `src/config_resolver.js`: (New utility) Logic for deep merging templates and overrides and Zod validation.
- `scripts/migrate_strategies.js`: (New script) One-time utility to convert existing strategy JSONs to the new format.

---

## Implementation Tasks

### Task 1: Create Config Resolver Utility
**Files:**
- Create: `src/config_resolver.js`

- [ ] **Step 1: Implement `resolveConfig` function**
```javascript
import fs from 'fs';
import path from 'path';
import { z } from 'zod';

const RiskSchema = z.object({
  maxTradesPerDay: z.number().int().positive(),
  maxTradeSizeUSD: z.number().positive(),
  riskPerTradePercent: z.number().positive(),
  stopLossPercent: z.number().positive(),
  takeProfitPercent: z.number().positive(),
});

export function resolveConfig(strategyConfig) {
  const { riskTemplateId, riskOverrides = {}, logicTemplateId, logicOverrides = {} } = strategyConfig;

  // 1. Load Risk Template
  const riskTemplatePath = path.join(process.cwd(), 'templates', 'risk', `${riskTemplateId}.json`);
  const riskTemplate = JSON.parse(fs.readFileSync(riskTemplatePath, 'utf8'));
  
  // 2. Merge Risk
  const resolvedRisk = { 
    ...riskTemplate.settings, 
    ...riskOverrides 
  };

  // 3. Validate Risk
  RiskSchema.parse(resolvedRisk);

  // 4. Load Logic Template
  const logicTemplatePath = path.join(process.cwd(), 'templates', 'logic', `${logicTemplateId}.json`);
  const logicTemplate = JSON.parse(fs.readFileSync(logicTemplatePath, 'utf8'));

  // 5. Merge Logic
  const resolvedLogic = {
    ...logicTemplate,
    ...logicOverrides
  };

  return {
    ...strategyConfig,
    risk: resolvedRisk,
    logic: resolvedLogic
  };
}
```

- [ ] **Step 2: Create a test script `tests/test_resolver.js` to verify merging**
```javascript
// Mock data to test that overrides beat templates
const mockStrategy = {
  riskTemplateId: 'aggressive', 
  riskOverrides: { maxTradesPerDay: 50 }
};
// Expected: resolved.risk.maxTradesPerDay === 50
```

- [ ] **Step 3: Run test and commit**
```bash
git add src/config_resolver.js tests/test_resolver.js
git commit -m "feat: add config resolver utility for templates and overrides"
```

### Task 2: Update Bot Engine to use Resolver
**Files:**
- Modify: `bot_engine.js`

- [ ] **Step 1: Import `resolveConfig` and replace manual config loading**
Replace lines ~786-793 where `strategyConfig` is loaded.
```javascript
import { resolveConfig } from './src/config_resolver.js';

// Inside run(strategyPath):
const rawConfig = JSON.parse(readFileSync(strategyPath, "utf8"));
const strategyConfig = resolveConfig(rawConfig);
```

- [ ] **Step 2: Remove fallback defaults (e.g., `|| 3`)**
Modify line 811:
```javascript
// Old: const maxTradesDayLimit = strategyConfig.risk?.maxTradesPerDay || 3;
const maxTradesDayLimit = strategyConfig.risk.maxTradesPerDay; 
```

- [ ] **Step 3: Verify bot starts and uses the correct limit from template/overrides**
Run: `node bot_engine.js strategies/smart_money_breakout_channels__algoalpha_.json`
Expected: "Max trades per day" should show the resolved value (50).

- [ ] **Step 4: Commit**
```bash
git add bot_engine.js
git commit -m "feat: integrate config resolver into bot engine"
```

### Task 3: Update Server to save Overrides
**Files:**
- Modify: `server.js`

- [ ] **Step 1: Update `assembleStrategy` to separate base settings from overrides**
Modify `assembleStrategy` (lines 158-189) to only save the delta.
```javascript
async function assembleStrategy(name, settings, logicTemplateId, riskTemplateId) {
  const [logic, risk] = await Promise.all([
    templateService.loadTemplate('logic', logicTemplateId),
    templateService.loadTemplate('risk', riskTemplateId),
  ]);

  // Only save what differs from the template
  const riskOverrides = {};
  for (const [key, value] of Object.entries(settings)) {
    if (risk.settings[key] !== undefined && risk.settings[key] !== value) {
      riskOverrides[key] = value;
    }
  }

  return {
    name,
    timeframe: settings.timeframe,
    watchlist: settings.watchlist,
    riskTemplateId,
    riskOverrides,
    logicTemplateId,
    logicOverrides: settings.logicOverrides || {},
    metadata: { logicTemplateId, riskTemplateId, assembledAt: new Date().toISOString() }
  };
}
```

- [ ] **Step 2: Verify `POST /api/strategies/config` creates clean JSON files**
Use CURL or Dashboard to save a strategy. Check the `.json` file in `/strategies`. It should contain `riskOverrides` instead of a full `risk` object.

- [ ] **Step 3: Commit**
```bash
git add server.js
git commit -m "feat: update server to save strict overrides instead of full config"
```

### Task 4: Migration of Existing Strategies
**Files:**
- Create: `scripts/migrate_strategies.js`

- [ ] **Step 1: Implement migration logic**
Script should:
1. Loop through `strategies/*.json`.
2. Load the strategy and its template.
3. Compare `strategy.risk` with `template.settings`.
4. Create `riskOverrides` for differences.
5. Rewrite file with new structure.

- [ ] **Step 2: Run migration script**
Run: `node scripts/migrate_strategies.js`

- [ ] **Step 3: Verify all bots still start correctly**
Run a few bots manually to ensure `resolveConfig` works with migrated files.

- [ ] **Step 4: Commit**
```bash
git add scripts/migrate_strategies.js strategies/*.json
git commit -m "chore: migrate all strategies to strict template format"
```
