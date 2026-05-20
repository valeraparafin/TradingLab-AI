# Dynamic Price Precision and PnL% Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hard-coded `.toFixed(2)` with asset-specific precision and add server-calculated PnL percentages to the Active Positions table.

**Architecture:** The server provides a precision API and calculates PnL%. The frontend uses a centralized API client to fetch precision once per session/asset and renders the formatted values.

**Tech Stack:** Node.js, Express, Socket.io, React, TypeScript, Axios.

---

### Task 1: Precision API (Backend)

**Files:**
- Modify: `server.js`
- Reference: `src/utils/precision.js`

- [ ] **Step 1: Import PrecisionManager in server.js**
  Add `import { PrecisionManager } from './src/utils/precision.js';` and instantiate `const precisionManager = new PrecisionManager();`.

- [ ] **Step 2: Implement GET /api/precision endpoint**
  ```javascript
  app.get('/api/precision', async (req, res) => {
    const { symbol } = req.query;
    if (!symbol) return res.status(400).json({ error: 'Symbol is required' });
    try {
      const precision = await precisionManager.getPrecision(symbol);
      res.json({ symbol, precision });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  ```

- [ ] **Step 3: Verify endpoint**
  Run server and test: `curl "http://localhost:3000/api/precision?symbol=BTCUSDT"`
  Expected: `{"symbol":"BTCUSDT","precision":2}`

- [ ] **Step 4: Commit**
  `git add server.js`
  `git commit -m "feat: add precision API endpoint"`

### Task 2: Server-side PnL Percentage (Backend)

**Files:**
- Modify: `bot_engine.js`

- [ ] **Step 1: Update position_active event payload**
  In the `while` loop, where `logEvent(strategyId, "position_active", ...)` is called (around line 298), calculate `pnl_percent`.
  ```javascript
  const pnl = activePosition.side === "BUY"
      ? activePosition.size_usd * (price / activePosition.entry_price - 1)
      : activePosition.size_usd * (1 - price / activePosition.entry_price);
  
  const pnl_percent = activePosition.side === "BUY"
      ? (price / activePosition.entry_price - 1) * 100
      : (1 - price / activePosition.entry_price) * 100;

  await logEvent(strategyId, "position_active", {
    symbol,
    side: activePosition.side,
    entry_price: activePosition.entry_price,
    size_usd: activePosition.size_usd,
    stop_loss: activePosition.stop_loss,
    take_profit: activePosition.take_profit,
    current_price: price,
    pnl,
    pnl_percent,
    message: "Active position found, monitoring for exit.",
  });
  ```

- [ ] **Step 2: Verify payload in logs**
  Run bot and check `safety-check-log.json` or server logs to ensure `pnl_percent` is present in `position_active` events.

- [ ] **Step 3: Commit**
  `git add bot_engine.js`
  `git commit -m "feat: add pnl_percent to position_active event"`

### Task 3: Precision and PnL UI (Frontend)

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/components/StrategyDetails.tsx`

- [ ] **Step 1: Add precision method to api.ts**
  Add `getPrecision: (symbol: string) => api.get<{ precision: number }>(`/precision?symbol=${symbol}`),` to the `strategyApi` object.

- [ ] **Step 2: Update Position interface in StrategyDetails.tsx**
  Add `pnl_percent: number;` to the `Position` interface.

- [ ] **Step 3: Implement precision state and fetching in StrategyDetails.tsx**
  ```tsx
  const [precision, setPrecision] = useState(2);
  
  // In the socket.on('event:update') handler
  if (data.type === 'position_active') {
    const payload = data.payload;
    // Fetch precision for the symbol if it's a new symbol or first time
    strategyApi.getPrecision(payload.symbol).then(res => {
      setPrecision(res.data.precision);
    });
    // ... existing setPositions logic
  }
  ```

- [ ] **Step 4: Update price formatting in table**
  Replace `.toFixed(2)` with `.toFixed(precision)` for:
  - `pos.entryPrice`
  - `pos.currentPrice`
  - `pos.sl`
  - `pos.tp`

- [ ] **Step 5: Update PnL column display**
  ```tsx
  <td className={cn("py-3 font-medium", pos.pnl >= 0 ? "text-emerald-500" : "text-rose-500")}>
    {pos.pnl >= 0 ? `+${pos.pnl?.toFixed(2)}` : pos.pnl?.toFixed(2)} USDT ({pos.pnl >= 0 ? '+' : ''}{pos.pnl_percent?.toFixed(2)}%)
  </td>
  ```

- [ ] **Step 6: Update Socket connection to use env variable**
  Replace `io('http://localhost:3000')` with a dynamic URL. Use `import.meta.env.VITE_SOCKET_URL || 'http://localhost:3000'`.

- [ ] **Step 7: Commit**
  `git add frontend/src/lib/api.ts frontend/src/components/StrategyDetails.tsx`
  `git commit -m "feat: implement dynamic precision and relative PnL display"`
