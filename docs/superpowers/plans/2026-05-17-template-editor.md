# Template Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a full CRUD interface for trading logic and risk templates with a safety locking mechanism to prevent editing templates used by active bots.

**Architecture:** 
- **Backend:** Express API in `server.js` interacting with the filesystem (`/templates`) and SQLite (`strategies` table) for lock validation.
- **Frontend:** React-based Master-Detail page using a sidebar for template selection and a JSON editor for content management.
- **Locking:** Server-side check of active bot processes and DB status before any `PUT` or `DELETE` operation.

**Tech Stack:** Node.js, Express, SQLite, React, Tailwind CSS.

---

### Task 1: Server-side - Template List with Locking Logic

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Implement `checkTemplateLock(type, id)` helper**
  Create a helper function in `server.js` that checks if a template is used by any running strategy.

```javascript
async function checkTemplateLock(type, id) {
  const db = getDB();
  // Find strategies using this template
  const strategies = await db.all(
    `SELECT id, name FROM strategies WHERE config LIKE ?`, 
    [`%${id}%`] 
    // Note: A more precise check would parse the JSON, 
    // but for the list view, a LIKE check is a fast first pass.
    // We will do a precise check in the PUT/DELETE endpoints.
  );

  const usedBy = [];
  let isLocked = false;

  for (const s of strategies) {
    const config = JSON.parse(s.config || '{}');
    const isUsing = (type === 'logic' && config.metadata?.logicTemplateId === id) || 
                    (type === 'risk' && config.metadata?.riskTemplateId === id);
    
    if (isUsing) {
      usedBy.push(s.name);
      if (activeBots.has(s.id) || s.status === 'running') {
        isLocked = true;
      }
    }
  }

  return { isLocked, usedBy };
}
```

- [ ] **Step 2: Update `GET /api/templates` to include lock status**
  Modify the existing endpoint to use the helper.

```javascript
app.get('/api/templates', async (req, res) => {
  try {
    const logicDir = path.join(process.cwd(), 'templates', 'logic');
    const riskDir = path.join(process.cwd(), 'templates', 'risk');

    const getTemplatesWithLock = async (dir, type) => {
      if (!fs.existsSync(dir)) return [];
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
      return await Promise.all(files.map(async (f) => {
        const id = f.replace('.json', '');
        const content = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        const { isLocked, usedBy } = await checkTemplateLock(type, id);
        return { id, name: content.name, isLocked, usedBy };
      }));
    };

    const logic = await getTemplatesWithLock(logicDir, 'logic');
    const risk = await getTemplatesWithLock(riskDir, 'risk');

    res.json({ logic, risk });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 3: Verify with curl**
  Run: `curl http://localhost:3000/api/templates`
  Expected: JSON response containing `isLocked` and `usedBy` for each template.

- [ ] **Step 4: Commit**
  `git add server.js && git commit -m "feat: add lock status to template list API"`

### Task 2: Server-side - Read, Create, and Duplicate

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Implement `GET /api/templates/:type/:id`**
```javascript
app.get('/api/templates/:type/:id', (req, res) => {
  const { type, id } = req.params;
  const filePath = path.join(process.cwd(), 'templates', type, `${id}.json`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Template not found' });
  res.json(JSON.parse(fs.readFileSync(filePath, 'utf8')));
});
```

- [ ] **Step 2: Implement `POST /api/templates/:type` (Create)**
```javascript
app.post('/api/templates/:type', (req, res) => {
  const { type } = req.params;
  const { name, content } = req.body;
  if (!name || !content) return res.status(400).json({ error: 'Name and content are required' });

  const id = slugify(name);
  const dir = path.join(process.cwd(), 'templates', type);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  
  const filePath = path.join(dir, `${id}.json`);
  if (fs.existsSync(filePath)) return res.status(400).json({ error: 'Template ID already exists' });

  fs.writeFileSync(filePath, JSON.stringify({ ...content, name }, null, 2));
  res.json({ id, name });
});
```

- [ ] **Step 3: Implement `POST /api/templates/:type/:id/duplicate`**
```javascript
app.post('/api/templates/:type/:id/duplicate', (req, res) => {
  const { type, id } = req.params;
  const { newName } = req.body;
  if (!newName) return res.status(400).json({ error: 'newName is required' });

  const oldPath = path.join(process.cwd(), 'templates', type, `${id}.json`);
  if (!fs.existsSync(oldPath)) return res.status(404).json({ error: 'Original template not found' });

  const content = JSON.parse(fs.readFileSync(oldPath, 'utf8'));
  const newId = slugify(newName);
  const newPath = path.join(process.cwd(), 'templates', type, `${newId}.json`);

  if (fs.existsSync(newPath)) return res.status(400).json({ error: 'Duplicate template ID already exists' });

  fs.writeFileSync(newPath, JSON.stringify({ ...content, name: newName }, null, 2));
  res.json({ id: newId, name: newName });
});
```

- [ ] **Step 4: Verify with curl**
  - Get: `curl http://localhost:3000/api/templates/logic/some_id`
  - Create: `curl -X POST -H "Content-Type: application/json" -d '{"name":"Test","content":{"rules":[]}}' http://localhost:3000/api/templates/logic`
  - Duplicate: `curl -X POST -H "Content-Type: application/json" -d '{"newName":"Test Copy"}' http://localhost:3000/api/templates/logic/test/duplicate`

- [ ] **Step 5: Commit**
  `git add server.js && git commit -m "feat: implement read, create and duplicate templates"`

### Task 3: Server-side - Update and Delete with Lock Enforcement

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Implement `PUT /api/templates/:type/:id`**
```javascript
app.put('/api/templates/:type/:id', async (req, res) => {
  const { type, id } = req.params;
  const { name, content } = req.body;
  
  const { isLocked, usedBy } = await checkTemplateLock(type, id);
  if (isLocked) {
    return res.status(403).json({ 
      error: 'Template is locked', 
      details: `Used by active strategies: ${usedBy.join(', ')}` 
    });
  }

  const filePath = path.join(process.cwd(), 'templates', type, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify({ ...content, name }, null, 2));
  res.json({ status: 'updated' });
});
```

- [ ] **Step 2: Implement `DELETE /api/templates/:type/:id`**
```javascript
app.delete('/api/templates/:type/:id', async (req, res) => {
  const { type, id } = req.params;
  
  const { isLocked, usedBy } = await checkTemplateLock(type, id);
  if (isLocked) {
    return res.status(403).json({ 
      error: 'Template is locked', 
      details: `Used by active strategies: ${usedBy.join(', ')}` 
    });
  }

  const filePath = path.join(process.cwd(), 'templates', type, `${id}.json`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  res.json({ status: 'deleted' });
});
```

- [ ] **Step 3: Verify lock enforcement**
  1. Start a bot using template X.
  2. Try to `PUT` template X $\rightarrow$ Expected: `403 Forbidden`.
  3. Stop the bot.
  4. Try to `PUT` template X $\rightarrow$ Expected: `200 OK`.

- [ ] **Step 4: Commit**
  `git add server.js && git commit -m "feat: implement update and delete templates with lock enforcement"`

### Task 4: Frontend - API Client Extensions

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Create `templateApi` object**
```typescript
export const templateApi = {
  getTemplates: async () => {
    const res = await axios.get('/api/templates');
    return res.data;
  },
  getTemplate: async (type: string, id: string) => {
    const res = await axios.get(`/api/templates/${type}/${id}`);
    return res.data;
  },
  createTemplate: async (type: string, data: { name: string, content: any }) => {
    const res = await axios.post(`/api/templates/${type}`, data);
    return res.data;
  },
  updateTemplate: async (type: string, id: string, data: { name: string, content: any }) => {
    const res = await axios.put(`/api/templates/${type}/${id}`, data);
    return res.data;
  },
  deleteTemplate: async (type: string, id: string) => {
    const res = await axios.delete(`/api/templates/${type}/${id}`);
    return res.data;
  },
  duplicateTemplate: async (type: string, id: string, newName: string) => {
    const res = await axios.post(`/api/templates/${type}/${id}/duplicate`, { newName });
    return res.data;
  },
};
```

- [ ] **Step 2: Commit**
  `git add frontend/src/lib/api.ts && git commit -m "feat: add templateApi client"`

### Task 5: Frontend - Template Manager Component (Shell & Master List)

**Files:**
- Create: `frontend/src/components/TemplateManager.tsx`

- [ ] **Step 1: Implement basic layout and Tab switching**
  Create a component with `logic` and `risk` state, a top bar with tabs, and a 2-column layout.

- [ ] **Step 2: Implement the Master List (Left Panel)**
  - Fetch templates using `templateApi.getTemplates`.
  - Render list of cards showing Name, Lock Status (🔒/✅), and Usage.
  - Add search filter.

- [ ] **Step 3: Implement "Create New" functionality**
  - Add a simple prompt or small form to enter a new name for a template.
  - Call `templateApi.createTemplate` with a default empty object `{}` as content.

- [ ] **Step 4: Commit**
  `git add frontend/src/components/TemplateManager.tsx && git commit -m "feat: implement TemplateManager shell and master list"`

### Task 6: Frontend - Template Manager Component (Detail Editor)

**Files:**
- Modify: `frontend/src/components/TemplateManager.tsx`

- [ ] **Step 1: Implement Template Selection and Loading**
  - When a card is clicked, fetch content via `templateApi.getTemplate`.
  - Show a loading spinner in the right panel.

- [ ] **Step 2: Implement the JSON Editor**
  - Use a `textarea` (or a JSON-specialized component if available).
  - Implement real-time JSON validation (`JSON.parse` in a try-catch).
  - Show "Valid JSON" / "Invalid JSON" indicator.

- [ ] **Step 3: Implement Save, Duplicate, and Delete**
  - **Save**: Call `updateTemplate`. Handle `403` lock error with a notification.
  - **Duplicate**: Call `duplicateTemplate` $\rightarrow$ Refresh list.
  - **Delete**: Call `deleteTemplate` $\rightarrow$ Clear editor and refresh list.

- [ ] **Step 4: Implement Lock UI**
  - Show a prominent warning banner at the top of the editor when `isLocked` is true.
  - Disable the "Save" and "Delete" buttons.

- [ ] **Step 5: Commit**
  `git add frontend/src/components/TemplateManager.tsx && git commit -m "feat: implement template editor with lock enforcement and validation"`

### Task 7: Frontend - Routing Integration

**Files:**
- Modify: `frontend/src/App.tsx` (or routing config file)

- [ ] **Step 1: Add Route for `/templates`**
  - Import `TemplateManager`.
  - Add `<Route path="/templates" element={<TemplateManager />} />`.

- [ ] **Step 2: Add Navigation Link**
  - Add "Templates" link to the main navigation menu/sidebar.

- [ ] **Step 3: Final End-to-End Test**
  - Create template $\rightarrow$ Duplicate template $\rightarrow$ Edit template $\rightarrow$ Verify lock when bot starts $\rightarrow$ Delete template.

- [ ] **Step 4: Commit**
  `git add frontend/src/App.tsx && git commit -m "feat: integrate TemplateManager into application routing"`
