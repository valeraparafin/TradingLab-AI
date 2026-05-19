# Single Source of Truth (SSOT) Configuration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate duplication of strategy configurations between the database and the filesystem, making the database the sole source of truth.

**Architecture:**
1. The Orchestrator Server (`server.js`) exposes a new API endpoint `GET /api/strategies/config/:id`.
2. This endpoint uses the existing `assembleStrategy` logic to build the final configuration from the DB and templates.
3. The Bot Engine (`bot_engine.js`) fetches its configuration via this API using its `STRATEGY_ID` at startup.
4. All `fs` operations related to the `/strategies` directory are removed from the server.

**Tech Stack:** Node.js, Express, SQLite, Fetch API.

---

### Task 1: Server-side Configuration Provider

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Implement `GET /api/strategies/config/:id` endpoint**

Add the following endpoint to `server.js`:

```javascript
app.get('/api/strategies/config/:id', async (req, res) => {
  const strategyId = req.params.id;
  try {
    const db = getDB();
    const strategy = await db.get('SELECT * FROM strategies WHERE id = ?', [strategyId]);
    if (!strategy) {
      return res.status(404).json({ error: `Strategy ${strategyId} not found` });
    }

    const config = JSON.parse(strategy.config);
    
    // Re-use the existing assembleStrategy logic
    const finalConfig = await assembleStrategy(
      strategy.name,
      config, // config contains overrides and settings
      config.metadata?.logicTemplateId || config.logicTemplateId,
      config.metadata?.riskTemplateId || config.riskTemplateId
    );

    res.json(finalConfig);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 2: Verify endpoint works**
Run the server and test the endpoint with `curl`:
`curl http://localhost:3000/api/strategies/config/1`
Expected: A JSON object containing the fully assembled strategy configuration.

- [ ] **Step 3: Commit**
```bash
git add server.js
git commit -m "feat: add API endpoint for strategy configuration assembly"
```

---

### Task 2: Bot Engine API Integration

**Files:**
- Modify: `bot_engine.js`

- [ ] **Step 1: Replace `readFileSync` with API fetch**

In `bot_engine.js`, locate the `run` function. Replace the file reading logic:

```javascript
// OLD
const rawStrategyConfig = JSON.parse(readFileSync(strategyPath, "utf8"));

// NEW
const strategyId = process.env.STRATEGY_ID;
if (!strategyId) throw new Error("STRATEGY_ID environment variable is required");

const response = await fetch(`http://localhost:3000/api/strategies/config/${strategyId}`);
if (!response.ok) throw new Error(`Failed to fetch config: ${response.statusText}`);
const strategyConfig = await response.json();
const rawStrategyConfig = strategyConfig; // Keep variable name for compatibility
```

- [ ] **Step 2: Remove unnecessary `strategyPath` usage**
Remove the `strategyPath` argument from `run()` and the logic that constructs `strategyFilePath`.

- [ ] **Step 3: Verify bot startup**
Start a bot: `STRATEGY_ID=1 node bot_engine.js`
Expected: Bot starts successfully, logs "Loaded strategy" (or equivalent), and enters the main loop using data fetched from the API.

- [ ] **Step 4: Commit**
```bash
git add bot_engine.js
git commit -m "feat: switch bot engine to fetch config via API"
```

---

### Task 3: Server-side Cleanup (Filesystem Removal)

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Remove file writing from `POST /api/strategies`**

Remove the following block from `app.post('/api/strategies', ...)`:
```javascript
// REMOVE THIS
const strategiesDir = path.join(process.cwd(), 'strategies');
if (!fs.existsSync(strategiesDir)) {
  fs.mkdirSync(strategiesDir);
}

const fileName = `${slugify(name)}.json`;
const filePath = path.join(strategiesDir, fileName);
fs.writeFileSync(filePath, JSON.stringify(finalConfig, null, 2));
```

- [ ] **Step 2: Remove file updates from `POST /api/strategies/config`**

Remove the following block from `app.post('/api/strategies/config', ...)`:
```javascript
// REMOVE THIS
const strategiesDir = path.join(process.cwd(), 'strategies');
const oldFileName = `${slugify(oldStrategy.name)}.json`;
const newFileName = `${slugify(finalName)}.json`;
const oldPath = path.join(strategiesDir, oldFileName);
const newPath = path.join(strategiesDir, newFileName);

if (fs.existsSync(oldPath)) {
  if (oldPath !== newPath) {
    fs.renameSync(oldPath, newPath);
  }
} else {
  console.log(`Warning: Old strategy file not found at ${oldPath}. Creating new one.`);
}

fs.writeFileSync(newPath, JSON.stringify(finalConfig, null, 2));
```

- [ ] **Step 3: Remove `slugify` function and `strategies` folder references**
Delete the `slugify` function if it's no longer used anywhere else.

- [ ] **Step 4: Commit**
```bash
git add server.js
git commit -m "refactor: remove strategy filesystem persistence in favor of DB"
```

---

### Task 4: Final Verification and Purge

- [ ] **Step 1: End-to-end Test**
1. Create a new strategy via Dashboard.
2. Verify it exists in the DB.
3. Verify **no** new file was created in `/strategies`.
4. Start the strategy.
5. Verify it fetches config via API and runs correctly.

- [ ] **Step 2: Delete the `/strategies` folder**
```bash
rm -rf strategies/
```

- [ ] **Step 3: Final Commit**
```bash
git add .
git commit -m "cleanup: remove legacy strategies directory"
```
