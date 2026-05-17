# Strategy Archiving and Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a "Recycle Bin" system for strategies where they are first archived (stopped and hidden) before being permanently deleted (DB record and .json file removed).

**Architecture:**
- Backend: Add `is_archived` column to SQLite `strategies` table. Add API endpoints for archiving, restoring, and permanent deletion.
- Frontend: Implement a Tab-based view in `StrategyHub` to switch between "Active" and "Archive" strategies.
- Safety: Enforce that only archived strategies can be permanently deleted.

**Tech Stack:** Node.js (Express), SQLite, React (TypeScript).

---

### Task 1: Database Schema Update

**Files:**
- Modify: `db.js`

- [ ] **Step 1: Update `initDB` to add `is_archived` column**
Modify `initDB` function in `db.js` to include `is_archived BOOLEAN DEFAULT FALSE` in the `strategies` table creation.

```javascript
// In db.js, within the CREATE TABLE IF NOT EXISTS strategies block:
CREATE TABLE IF NOT EXISTS strategies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    config TEXT,
    status TEXT DEFAULT 'stopped',
    last_run DATETIME,
    is_archived BOOLEAN DEFAULT FALSE
);
```

- [ ] **Step 2: Handle existing database migration**
Since the table might already exist, add a migration check in `initDB` to add the column if it's missing.

```javascript
// Add this after the CREATE TABLE block in db.js:
try {
    await db.exec('ALTER TABLE strategies ADD COLUMN is_archived BOOLEAN DEFAULT FALSE');
} catch (e) {
    // Column already exists, ignore error
}
```

- [ ] **Step 3: Commit**
```bash
git add db.js
git commit -m "feat: add is_archived column to strategies table"
```

### Task 2: Backend - Archive and Restore Endpoints

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Implement `POST /api/strategies/archive`**
Add the endpoint to `server.js`. It must stop the bot if running and set `is_archived = 1`.

```javascript
app.post('/api/strategies/archive', async (req, res) => {
  const { strategyId } = req.body;
  if (!strategyId) return res.status(400).json({ error: 'strategyId is required' });

  try {
    await stopBot(strategyId);
    await getDB().run('UPDATE strategies SET is_archived = 1 WHERE id = ?', [strategyId]);
    res.json({ status: 'archived', strategyId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 2: Implement `POST /api/strategies/restore`**
Add the endpoint to `server.js`.

```javascript
app.post('/api/strategies/restore', async (req, res) => {
  const { strategyId } = req.body;
  if (!strategyId) return res.status(400).json({ error: 'strategyId is required' });

  try {
    await getDB().run('UPDATE strategies SET is_archived = 0 WHERE id = ?', [strategyId]);
    res.json({ status: 'restored', strategyId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 3: Update `GET /api/strategies` for filtering**
Modify the `GET /api/strategies` endpoint to handle the `archived` query parameter.

```javascript
app.get('/api/strategies', async (req, res) => {
  try {
    const archived = req.query.archived === 'true';
    const db = getDB();
    const strategies = await db.all('SELECT * FROM strategies WHERE is_archived = ?', [archived ? 1 : 0]);
    
    // ... existing stats mapping logic ...
    const strategiesWithStats = await Promise.all(strategies.map(async (s) => {
        // (Keep existing stat calculation logic here)
        // ...
    }));

    res.json(strategiesWithStats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 4: Commit**
```bash
git add server.js
git commit -m "feat: implement archive and restore endpoints"
```

### Task 3: Backend - Permanent Deletion

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Implement `DELETE /api/strategies/:id`**
Add the endpoint to `server.js`. It must verify the strategy is archived before deleting.

```javascript
app.delete('/api/strategies/:id', async (req, res) => {
  const strategyId = req.params.id;
  try {
    const db = getDB();
    const strategy = await db.get('SELECT name, is_archived FROM strategies WHERE id = ?', [strategyId]);
    
    if (!strategy) return res.status(404).json({ error: 'Strategy not found' });
    if (!strategy.is_archived) {
      return res.status(400).json({ error: 'Strategy must be archived before permanent deletion' });
    }

    // 1. Delete from DB (Cascade handles trades/events)
    await db.run('DELETE FROM strategies WHERE id = ?', [strategyId]);

    // 2. Delete JSON file
    const strategiesDir = path.join(process.cwd(), 'strategies');
    const fileName = `${slugify(strategy.name)}.json`;
    const filePath = path.join(strategiesDir, fileName);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    res.json({ status: 'permanently_deleted', strategyId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 2: Commit**
```bash
git add server.js
git commit -m "feat: implement permanent deletion of archived strategies"
```

### Task 4: Frontend - StrategyHub Tabs and UI

**Files:**
- Modify: `frontend/src/components/StrategyHub.tsx`
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Update API client in `api.ts`**
Add functions to call the new endpoints.

```typescript
export const archiveStrategy = (id: number) => 
  fetch('/api/strategies/archive', { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify({ strategyId: id }) 
  }).then(res => res.json());

export const restoreStrategy = (id: number) => 
  fetch('/api/strategies/restore', { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify({ strategyId: id }) 
  }).then(res => res.json());

export const deleteStrategyPermanently = (id: number) => 
  fetch(`/api/strategies/${id}`, { method: 'DELETE' }).then(res => res.json());

// Update fetchStrategies to accept archived param
export const fetchStrategies = (archived = false) => 
  fetch(`/api/strategies?archived=${archived}`).then(res => res.json());
```

- [ ] **Step 2: Implement Tabs in `StrategyHub.tsx`**
Add a state variable `view` ('active' | 'archive') and a tab switcher.

```tsx
const [view, setView] = useState<'active' | 'archive'>('active');
// ...
<div className="flex gap-2 mb-4">
  <button 
    onClick={() => setView('active')} 
    className={view === 'active' ? 'bg-blue-500 text-white' : 'bg-gray-200'}
  >
    Active Strategies
  </button>
  <button 
    onClick={() => setView('archive')} 
    className={view === 'archive' ? 'bg-blue-500 text-white' : 'bg-gray-200'}
  >
    Archive
  </button>
</div>
```

- [ ] **Step 3: Filter strategy list based on view**
Update the data fetching logic to use the `view` state.

```tsx
useEffect(() => {
  loadStrategies();
}, [view]);

const loadStrategies = async () => {
  const data = await fetchStrategies(view === 'archive');
  setStrategies(data);
};
```

- [ ] **Step 4: Implement "Archive" button for active strategies**
Add button with confirmation.

```tsx
{view === 'active' && (
  <button onClick={() => handleArchive(s.id)}>Archive</button>
)}

const handleArchive = async (id: number) => {
  if (confirm('Archive this strategy? It will be stopped and moved to the archive.')) {
    await archiveStrategy(id);
    loadStrategies();
  }
};
```

- [ ] **Step 5: Implement "Restore" and "Delete" buttons for archived strategies**
Add buttons with strict confirmation for deletion.

```tsx
{view === 'archive' && (
  <div className="flex gap-2">
    <button onClick={() => handleRestore(s.id)}>Restore</button>
    <button 
      onClick={() => handleDelete(s.id)} 
      className="text-red-500"
    >
      Delete Permanently
    </button>
  </div>
)}

const handleRestore = async (id: number) => {
  await restoreStrategy(id);
  loadStrategies();
};

const handleDelete = async (id: number) => {
  if (confirm('WARNING! This operation is irreversible. All trade history and the configuration file will be permanently deleted.')) {
    await deleteStrategyPermanently(id);
    loadStrategies();
  }
};
```

- [ ] **Step 6: Commit**
```bash
git add frontend/src/lib/api.ts frontend/src/components/StrategyHub.tsx
git commit -m "feat: implement strategy archive/restore/delete UI"
```

### Task 5: End-to-End Verification

- [ ] **Step 1: Verify Archiving**
Create strategy $\rightarrow$ Start strategy $\rightarrow$ Click "Archive".
Expected: Bot stops, strategy disappears from "Active", appears in "Archive".

- [ ] **Step 2: Verify Restoration**
Go to "Archive" $\rightarrow$ Click "Restore".
Expected: Strategy reappears in "Active", disappears from "Archive".

- [ ] **Step 3: Verify Permanent Deletion**
Archive strategy $\rightarrow$ Go to "Archive" $\rightarrow$ Click "Delete Permanently".
Expected: Record gone from DB, `.json` file deleted from `/strategies` folder.

- [ ] **Step 4: Verify Safety Gate**
Attempt to call `DELETE /api/strategies/:id` for a non-archived strategy via curl.
Expected: `400 Bad Request`.
