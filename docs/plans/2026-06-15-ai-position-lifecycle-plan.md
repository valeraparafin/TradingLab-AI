# AI Position Lifecycle & Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the open → monitor SL/TP → close → realized PnL lifecycle for ALL AI agents (candle + OB), and surface live open positions and closed trades in the cockpit.

**Architecture:** A pure `PositionLedger` (SL/TP decisioning + PnL math, no I/O) is persisted through new `aiStrategyService` methods (`ai_active_positions` gains side/sl/tp/opened_at; new `ai_closed_trades` table). `AgentOrchestrator` gains `_openPosition` (called on every EXECUTE in both `runCycle` and `_obDrainTick`) and `_sweepExits` (called once per tick in both paths) that feed the ledger current mids and persist closures. Two new read routes plus a shared cockpit UI render it.

**Tech Stack:** Node ESM, SQLite (`db.js` `getDB('ai')`), Express router, Socket.io, React/TS frontend. Tests: plain ESM + `node:assert`, run with `node tests/<file>.mjs`.

**Test idiom (use in every test file):**
```js
import assert from 'node:assert';
let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };
// ... assert(...); ok('name'); ...
console.log(`\n${p} checks passed`);
```

**Key existing facts the implementer must respect:**
- `verdict.order` (from `RiskPolicy.evaluate`) has `{ side: 'BUY'|'SELL', sizeUSD, entryPrice, slPrice, tpPrice }`.
- `tradeExecutor.executeTrade(...)` returns `{ success, mode, executedPrice, data }` for PAPER; it logs ONE entry row into `ai_paper_trades`. Leave that as-is.
- `ai_active_positions` PK is `(symbol, strategy_id)` — this IS the one-position-per-symbol lock.
- OB current mid: `this.obEngine.getLatestFeatures(symbol)?.futures?.mid`. Candle current price: existing `this._getCurrentPrice(symbol)`.
- Closes are recorded ONLY in `ai_closed_trades`. Do NOT write closing fills into `ai_paper_trades` — `tradesToday` (the `maxTradesPerDay` gate input) counts `ai_paper_trades` rows for the day, so logging closes there would falsely trip that gate. (This is a deliberate refinement over the spec's "log a closing fill" line, made for gate correctness.)

---

### Task 1: PositionLedger pure module

**Files:**
- Create: `src/agents/PositionLedger.js`
- Test: `tests/test_position_ledger.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/test_position_ledger.mjs
import assert from 'node:assert';
import { openPosition, checkExits, realizedPnl } from '../src/agents/PositionLedger.js';

let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

// openPosition normalizes + derives nothing it isn't given
const pos = openPosition({ symbol: 'BTCUSDT', side: 'BUY', entryPrice: 100, qty: 2, slPrice: 90, tpPrice: 120, openedAt: 't0' });
assert.deepEqual(pos, { symbol: 'BTCUSDT', side: 'BUY', entryPrice: 100, qty: 2, slPrice: 90, tpPrice: 120, openedAt: 't0' });
ok('openPosition normalizes');

// realizedPnl sign — long
assert.equal(realizedPnl({ side: 'BUY', entryPrice: 100, qty: 2 }, 120), 40);
ok('long pnl positive at TP');
assert.equal(realizedPnl({ side: 'BUY', entryPrice: 100, qty: 2 }, 90), -20);
ok('long pnl negative at SL');
// realizedPnl sign — short
assert.equal(realizedPnl({ side: 'SELL', entryPrice: 100, qty: 2 }, 80), 40);
ok('short pnl positive when price falls');
assert.equal(realizedPnl({ side: 'SELL', entryPrice: 100, qty: 2 }, 110), -20);
ok('short pnl negative when price rises');

// checkExits — long TP
let r = checkExits([pos], { BTCUSDT: 121 });
assert.equal(r.closed.length, 1);
assert.equal(r.closed[0].exitReason, 'TP');
assert.equal(r.closed[0].exitPrice, 121);
assert.equal(r.closed[0].pnlUsd, 42);
assert.equal(r.remaining.length, 0);
ok('long closes at TP with pnl from mid');

// checkExits — long SL
r = checkExits([pos], { BTCUSDT: 89 });
assert.equal(r.closed[0].exitReason, 'SL');
ok('long closes at SL');

// checkExits — short (sl above, tp below)
const sp = openPosition({ symbol: 'ETHUSDT', side: 'SELL', entryPrice: 100, qty: 1, slPrice: 110, tpPrice: 80, openedAt: 't1' });
assert.equal(checkExits([sp], { ETHUSDT: 79 }).closed[0].exitReason, 'TP');
ok('short closes at TP when price drops');
assert.equal(checkExits([sp], { ETHUSDT: 111 }).closed[0].exitReason, 'SL');
ok('short closes at SL when price rises');

// no mid → passthrough untouched
r = checkExits([pos], {});
assert.equal(r.closed.length, 0);
assert.equal(r.remaining.length, 1);
ok('no mid leaves position open');

// SL priority when one tick straddles both (gap)
const wide = openPosition({ symbol: 'BTCUSDT', side: 'BUY', entryPrice: 100, qty: 1, slPrice: 95, tpPrice: 105, openedAt: 't2' });
assert.equal(checkExits([wide], { BTCUSDT: 95 }).closed[0].exitReason, 'SL'); // mid<=sl wins
ok('SL takes priority on straddle');

console.log(`\n${p} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_position_ledger.mjs`
Expected: FAIL — `Cannot find module '../src/agents/PositionLedger.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/agents/PositionLedger.js
//
// Pure position decisioning + PnL math. No I/O, no DB. Persistence lives in
// aiStrategyService; orchestration lives in AgentOrchestrator. Mirrors the
// pure-module + node:assert pattern of ObAnalyst.js / obGuardrails.js.

/** Normalize a position object created from an executed order. */
export function openPosition({ symbol, side, entryPrice, qty, slPrice, tpPrice, openedAt }) {
  return { symbol, side, entryPrice, qty, slPrice, tpPrice, openedAt };
}

/** Signed realized PnL in USD for a fill at `exitPrice`. */
export function realizedPnl({ side, entryPrice, qty }, exitPrice) {
  const dir = side === 'SELL' ? -1 : 1;
  return dir * (exitPrice - entryPrice) * qty;
}

/**
 * Decide which open positions breach SL/TP given current mids.
 * LONG : SL when mid <= slPrice; TP when mid >= tpPrice.
 * SHORT: SL when mid >= slPrice; TP when mid <= tpPrice.
 * SL is checked first, so a single straddling tick closes conservatively at SL.
 * Positions with no mid in the map pass through to `remaining` untouched.
 */
export function checkExits(positions, midBySymbol) {
  const closed = [], remaining = [];
  for (const pos of positions) {
    const mid = midBySymbol[pos.symbol];
    if (typeof mid !== 'number' || !isFinite(mid)) { remaining.push(pos); continue; }
    const long = pos.side !== 'SELL';
    let reason = null;
    if (long) {
      if (mid <= pos.slPrice) reason = 'SL';
      else if (mid >= pos.tpPrice) reason = 'TP';
    } else {
      if (mid >= pos.slPrice) reason = 'SL';
      else if (mid <= pos.tpPrice) reason = 'TP';
    }
    if (reason) closed.push({ ...pos, exitPrice: mid, exitReason: reason, pnlUsd: realizedPnl(pos, mid) });
    else remaining.push(pos);
  }
  return { closed, remaining };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_position_ledger.mjs`
Expected: PASS — `12 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/agents/PositionLedger.js tests/test_position_ledger.mjs
git commit -m "feat(ai-positions): pure PositionLedger (SL/TP exits + PnL math)"
```

---

### Task 2: Schema — position columns + ai_closed_trades table

**Files:**
- Modify: `db.js` (CREATE block ~line 195 and the ALTER section ~line 235)
- Test: `tests/test_position_schema.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/test_position_schema.mjs
import assert from 'node:assert';
import { initDB, getDB } from '../db.js';

let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

await initDB();
const db = getDB('ai');

const apCols = (await db.all('PRAGMA table_info(ai_active_positions)')).map(c => c.name);
for (const c of ['side', 'sl_price', 'tp_price', 'opened_at']) {
  assert.ok(apCols.includes(c), `ai_active_positions has ${c}`); ok(`active_positions.${c}`);
}

const ctCols = (await db.all('PRAGMA table_info(ai_closed_trades)')).map(c => c.name);
for (const c of ['id', 'strategy_id', 'symbol', 'side', 'entry_price', 'exit_price', 'qty', 'size_usd', 'pnl_usd', 'exit_reason', 'opened_at', 'closed_at']) {
  assert.ok(ctCols.includes(c), `ai_closed_trades has ${c}`); ok(`closed_trades.${c}`);
}

console.log(`\n${p} checks passed`);
process.exit(0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_position_schema.mjs`
Expected: FAIL — `ai_closed_trades has id` assertion throws (table absent), or active-position column assertions throw.

- [ ] **Step 3a: Add the closed-trades table to the main CREATE block**

In `db.js`, immediately AFTER the `ai_equity_snapshots` index (line 198, the `CREATE INDEX ... idx_ai_equity_snap_agent_time` statement) and BEFORE the closing `` ` ``); of that `db.exec(\`...\`)` call, add:

```sql

        CREATE TABLE IF NOT EXISTS ai_closed_trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            strategy_id INTEGER NOT NULL,
            symbol TEXT,
            side TEXT,
            entry_price REAL,
            exit_price REAL,
            qty REAL,
            size_usd REAL,
            pnl_usd REAL,
            exit_reason TEXT,
            opened_at TEXT,
            closed_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_ai_closed_agent_time
            ON ai_closed_trades (strategy_id, closed_at);
```

- [ ] **Step 3b: Add idempotent ALTERs for the open-position columns**

In `db.js`, right AFTER the `aiStrategyColumns` for-loop (the block ending at line 235), add:

```js
    const aiActivePositionColumns = [
        'ALTER TABLE ai_active_positions ADD COLUMN side TEXT',
        'ALTER TABLE ai_active_positions ADD COLUMN sl_price REAL',
        'ALTER TABLE ai_active_positions ADD COLUMN tp_price REAL',
        'ALTER TABLE ai_active_positions ADD COLUMN opened_at TEXT',
    ];
    for (const stmt of aiActivePositionColumns) {
        try { await aiDb.exec(stmt); } catch (e) { /* column exists */ }
    }
```

(Note: `aiDb` is the ai-contour handle used by the surrounding ALTER blocks; confirm that is the variable in scope there and reuse it.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_position_schema.mjs`
Expected: PASS — `16 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add db.js tests/test_position_schema.mjs
git commit -m "feat(ai-positions): schema — position sl/tp/side + ai_closed_trades"
```

---

### Task 3: aiStrategyService position persistence + enrichment

**Files:**
- Modify: `src/server/services/aiStrategyService.js` (add methods to the exported object)
- Test: `tests/test_position_service.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/test_position_service.mjs
import assert from 'node:assert';
import { initDB, getDB } from '../db.js';
import { aiStrategyService } from '../src/server/services/aiStrategyService.js';

let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

await initDB();
const db = getDB('ai');
const AID = 990001; // test-only synthetic agent id
await db.run('DELETE FROM ai_active_positions WHERE strategy_id = ?', [AID]);
await db.run('DELETE FROM ai_closed_trades WHERE strategy_id = ?', [AID]);

// open
const o1 = await aiStrategyService.openPosition(AID, { symbol: 'BTCUSDT', side: 'BUY', entryPrice: 100, qty: 2, slPrice: 90, tpPrice: 120 });
assert.equal(o1.opened, true); ok('opens a position');
// one-per-symbol lock
const o2 = await aiStrategyService.openPosition(AID, { symbol: 'BTCUSDT', side: 'BUY', entryPrice: 101, qty: 1, slPrice: 91, tpPrice: 121 });
assert.equal(o2.opened, false); ok('duplicate symbol is locked out');

const open = await aiStrategyService.listOpenPositions(AID);
assert.equal(open.length, 1); ok('lists one open position');
assert.equal(open[0].side, 'BUY'); ok('maps side');
assert.equal(open[0].entryPrice, 100); ok('maps entryPrice');
assert.equal(open[0].slPrice, 90); ok('maps slPrice');
assert.equal(open[0].qty, 2); ok('maps qty');

// enrich with injected price fn (server-side unrealized PnL)
const enriched = await aiStrategyService.getOpenPositionsEnriched(AID, async () => 110);
assert.equal(enriched[0].mid, 110); ok('enriched carries mid');
assert.equal(enriched[0].unrealizedPnl, 20); ok('unrealized = (110-100)*2');

// close
await aiStrategyService.recordClosedTrade({
  strategy_id: AID, symbol: 'BTCUSDT', side: 'BUY', entry_price: 100, exit_price: 120,
  qty: 2, size_usd: 200, pnl_usd: 40, exit_reason: 'TP', opened_at: 't0', closed_at: 't1',
});
await aiStrategyService.closePosition(AID, 'BTCUSDT');
assert.equal((await aiStrategyService.listOpenPositions(AID)).length, 0); ok('close removes open position');
const closed = await aiStrategyService.listClosedTrades(AID, 10);
assert.equal(closed.length, 1); ok('lists one closed trade');
assert.equal(closed[0].pnl_usd, 40); ok('closed trade keeps pnl');

// cleanup
await db.run('DELETE FROM ai_active_positions WHERE strategy_id = ?', [AID]);
await db.run('DELETE FROM ai_closed_trades WHERE strategy_id = ?', [AID]);
console.log(`\n${p} checks passed`);
process.exit(0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_position_service.mjs`
Expected: FAIL — `aiStrategyService.openPosition is not a function`.

- [ ] **Step 3: Add the methods**

Insert these methods into the `aiStrategyService` object literal in
`src/server/services/aiStrategyService.js` (e.g. right after `getEquitySnapshots`).
The module already imports `getDB`. Add one import at the top of the file:

```js
import { realizedPnl } from '../../agents/PositionLedger.js';
```

Methods:

```js
    /**
     * Opens a position if none exists for (agentId, symbol). The PK on
     * ai_active_positions enforces one-per-symbol; INSERT OR IGNORE makes the
     * lock atomic. Returns { opened: boolean }.
     */
    async openPosition(agentId, { symbol, side, entryPrice, qty, slPrice, tpPrice }) {
        const db = getDB('ai');
        const r = await db.run(
            `INSERT OR IGNORE INTO ai_active_positions
               (symbol, strategy_id, total_quantity, total_cost, avg_entry_price, current_layer, side, sl_price, tp_price, opened_at)
             VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
            [symbol, agentId, qty, qty * entryPrice, entryPrice, side, slPrice, tpPrice, new Date().toISOString()]
        );
        return { opened: r.changes > 0 };
    },

    /** Lists open positions for an agent, mapped to PositionLedger shape. */
    async listOpenPositions(agentId) {
        const db = getDB('ai');
        const rows = await db.all(
            'SELECT symbol, side, avg_entry_price, total_quantity, sl_price, tp_price, opened_at FROM ai_active_positions WHERE strategy_id = ?',
            [agentId]
        );
        return rows.map((r) => ({
            symbol: r.symbol, side: r.side, entryPrice: r.avg_entry_price, qty: r.total_quantity,
            slPrice: r.sl_price, tpPrice: r.tp_price, openedAt: r.opened_at,
        }));
    },

    /**
     * Enriches open positions with a current mid and unrealized PnL.
     * `priceFn(symbol) => Promise<number>` is injected so the math stays
     * server-side and unit-testable. Positions whose price is unavailable get
     * mid=null and unrealizedPnl=null.
     */
    async getOpenPositionsEnriched(agentId, priceFn) {
        const positions = await this.listOpenPositions(agentId);
        const out = [];
        for (const pos of positions) {
            let mid = null, unrealizedPnl = null;
            try {
                const px = await priceFn(pos.symbol);
                if (typeof px === 'number' && isFinite(px) && px > 0) {
                    mid = px;
                    unrealizedPnl = realizedPnl(pos, px);
                }
            } catch (_) { /* leave nulls */ }
            out.push({ ...pos, mid, unrealizedPnl });
        }
        return out;
    },

    /** Deletes the open position row for (agentId, symbol). */
    async closePosition(agentId, symbol) {
        const db = getDB('ai');
        const r = await db.run('DELETE FROM ai_active_positions WHERE strategy_id = ? AND symbol = ?', [agentId, symbol]);
        return { changes: r.changes };
    },

    /** Inserts a completed round-trip into ai_closed_trades. */
    async recordClosedTrade(t) {
        const db = getDB('ai');
        await db.run(
            `INSERT INTO ai_closed_trades
               (strategy_id, symbol, side, entry_price, exit_price, qty, size_usd, pnl_usd, exit_reason, opened_at, closed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [t.strategy_id, t.symbol, t.side, t.entry_price, t.exit_price, t.qty, t.size_usd, t.pnl_usd, t.exit_reason, t.opened_at, t.closed_at]
        );
    },

    /** Lists closed trades for an agent, newest first. */
    async listClosedTrades(agentId, limit = 100) {
        const db = getDB('ai');
        return await db.all(
            'SELECT * FROM ai_closed_trades WHERE strategy_id = ? ORDER BY closed_at DESC LIMIT ?',
            [agentId, limit]
        );
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_position_service.mjs`
Expected: PASS — `13 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/aiStrategyService.js tests/test_position_service.mjs
git commit -m "feat(ai-positions): aiStrategyService open/close/closed-trade persistence + enrichment"
```

---

### Task 4: Orchestrator wiring — open on EXECUTE, sweep exits per tick

**Files:**
- Modify: `src/agents/AgentOrchestrator.js`
- Test: `tests/test_orchestrator_ob_mode.mjs` (extend existing)

**Scene:** `_obDrainTick` (OB) and `runCycle` (candle) both reach an EXECUTE branch
that calls `this.tradeExecutor.executeTrade(tradeParams)`. We add a position open
right after each execute, and a sweep at the start of each tick. The non-OB
EXECUTE branch is in `runCycle` around line 157; the OB one is in `_obDrainTick`
around line 92.

- [ ] **Step 1: Write the failing test (extend the existing OB-mode test)**

Append to `tests/test_orchestrator_ob_mode.mjs` (keep existing checks; reuse its
fake `io`/engine/executor harness). The new block drives one EXECUTE then one
sweep. Adjust the stub names to match what already exists in the file.

```js
// ─── Position lifecycle (Task 4) ───
// After a PERMITted drain produces a BUY @ entryMid 100 with SL 99 / TP 101.5,
// the orchestrator should open a tracked position, then close it at TP when the
// next sweep sees a mid >= 101.5.
{
  const opened = [];
  const closed = [];
  // Stub the service methods the orchestrator now calls.
  const svc = await import('../src/server/services/aiStrategyService.js');
  const orig = { ...svc.aiStrategyService };
  svc.aiStrategyService.openPosition = async (aid, pos) => { opened.push(pos); return { opened: true }; };
  svc.aiStrategyService.listOpenPositions = async () => opened.map((o) => ({ ...o }));
  svc.aiStrategyService.recordClosedTrade = async (t) => { closed.push(t); };
  svc.aiStrategyService.closePosition = async () => { opened.length = 0; return { changes: 1 }; };

  // Build an orchestrator in OB mode with a fake engine that yields ONE signal,
  // then a controllable mid via getLatestFeatures.
  let mid = 100;
  const fakeEngine = {
    start() {}, stop() {},
    drainSignals: (() => { let fired = false; return () => { if (fired) return []; fired = true;
      return [{ side: 'BUY', conviction: 0.7, entryMid: 100, invalidation: 99, rationale: 'ob' }]; }; })(),
    getLatestFeatures: () => ({ futures: { mid } }),
  };
  const io = { emit() {} };
  const { default: AgentOrchestrator } = await import('../src/agents/AgentOrchestrator.js');
  const o = new AgentOrchestrator(io, {
    agentId: 990002,
    execution: { agentId: 990002, symbols: ['BTCUSDT'], tradeMode: 'spot', paperTrading: true },
    guardrails: { stopMode: 'structural', structuralRR: 2, minRiskRewardRatio: 0, portfolioValue: 500, riskPerTradePercent: 1 },
    obEngine: fakeEngine, obConfig: { drainIntervalMs: 10000 },
  });
  o.isRunning = true;

  await o._obDrainTick();           // drains the signal → EXECUTE → open
  assert.equal(opened.length, 1); ok('drain opens one position');
  assert.equal(opened[0].side, 'BUY'); ok('opened side BUY');

  mid = 102;                         // now above TP
  await o._sweepExits({ BTCUSDT: mid });
  assert.equal(closed.length, 1); ok('sweep closes at TP');
  assert.equal(closed[0].exit_reason, 'TP'); ok('exit reason TP');
  assert.ok(closed[0].pnl_usd > 0, 'pnl positive'); ok('pnl positive at TP');

  Object.assign(svc.aiStrategyService, orig); // restore
}
```

NOTE for implementer: the existing test file already imports `assert` and defines
`ok`/`p`. Do not redeclare them. If the existing file's harness differs, adapt the
stub wiring but keep the four new `ok(...)` assertions and their meaning.

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_orchestrator_ob_mode.mjs`
Expected: FAIL — `o._sweepExits is not a function` (and `opened.length` is 0 because `_obDrainTick` doesn't open yet).

- [ ] **Step 3a: Add the import + two helpers to AgentOrchestrator**

At the top of `src/agents/AgentOrchestrator.js`, add:

```js
import { checkExits } from './PositionLedger.js';
import { aiStrategyService } from '../server/services/aiStrategyService.js';
```

Add these two methods to the class (e.g. just before `_getPortfolioState`):

```js
  /**
   * Records an opened position from an executed order. One position per
   * (agent, symbol) — the service's INSERT OR IGNORE is the lock. `executedPrice`
   * is the fill price returned by the executor (includes paper slippage).
   */
  async _openPosition(symbol, order, executedPrice) {
    if (!(executedPrice > 0) || !(order.sizeUSD > 0)) return;
    const qty = order.sizeUSD / executedPrice;
    if (!isFinite(qty) || qty <= 0) {
      this.broadcastThought({ agent: 'orchestrator', thought: `skip open ${symbol}: bad qty` });
      return;
    }
    const { opened } = await aiStrategyService.openPosition(this.agentId, {
      symbol, side: order.side, entryPrice: executedPrice, qty,
      slPrice: order.slPrice, tpPrice: order.tpPrice,
    });
    if (opened) {
      this.io.emit('position:opened', {
        agentId: this.agentId, symbol, side: order.side,
        entryPrice: executedPrice, qty, slPrice: order.slPrice, tpPrice: order.tpPrice,
      });
    }
  }

  /**
   * Closes any open positions whose mid breached SL/TP. `midBySymbol` is supplied
   * by the caller (OB: engine futures mid; candle: latest close). Records each
   * close in ai_closed_trades ONLY (never ai_paper_trades — keeps tradesToday=opens).
   * Record-then-delete order means a crash leaves the position open, never double-closed.
   */
  async _sweepExits(midBySymbol) {
    let positions;
    try { positions = await aiStrategyService.listOpenPositions(this.agentId); }
    catch (e) { console.error(`[Positions] list: ${e.message}`); return; }
    if (!positions.length) return;
    const { closed } = checkExits(positions, midBySymbol);
    for (const c of closed) {
      try {
        await aiStrategyService.recordClosedTrade({
          strategy_id: this.agentId, symbol: c.symbol, side: c.side,
          entry_price: c.entryPrice, exit_price: c.exitPrice, qty: c.qty,
          size_usd: c.qty * c.entryPrice, pnl_usd: c.pnlUsd, exit_reason: c.exitReason,
          opened_at: c.openedAt, closed_at: new Date().toISOString(),
        });
        await aiStrategyService.closePosition(this.agentId, c.symbol);
        this.io.emit('position:closed', {
          agentId: this.agentId, symbol: c.symbol, side: c.side,
          exitPrice: c.exitPrice, pnlUsd: c.pnlUsd, exitReason: c.exitReason,
        });
        this.broadcastThought({ agent: 'orchestrator',
          thought: `Closed ${c.side} ${c.symbol} @ ${c.exitPrice} (${c.exitReason}) PnL ${c.pnlUsd.toFixed(2)}` });
      } catch (e) { console.error(`[Positions] close ${c.symbol}: ${e.message}`); }
    }
  }

  /** Current mid for exit checks: OB engine futures mid, else latest candle close. */
  async _midFor(symbol) {
    if (this.isObMode) {
      const m = this.obEngine.getLatestFeatures?.(symbol)?.futures?.mid;
      if (typeof m === 'number' && isFinite(m) && m > 0) return m;
    }
    return await this._getCurrentPrice(symbol);
  }
```

- [ ] **Step 3b: Open on EXECUTE in `_obDrainTick`**

In `_obDrainTick`, replace the executor call + thought (currently lines ~92-94):

```js
          const r = await this.tradeExecutor.executeTrade(tradeParams);
          this.broadcastThought({ agent: 'orchestrator',
            thought: `OB trade ${r.success ? 'Executed' : 'Failed'} (${order.side} ${symbol})` });
```

with:

```js
          const r = await this.tradeExecutor.executeTrade(tradeParams);
          this.broadcastThought({ agent: 'orchestrator',
            thought: `OB trade ${r.success ? 'Executed' : 'Failed'} (${order.side} ${symbol})` });
          if (r.success) await this._openPosition(symbol, order, r.executedPrice ?? order.entryPrice);
```

- [ ] **Step 3c: Sweep exits inside `_obDrainTick`**

At the END of `_obDrainTick`, after the `for (const symbol ...)` loop closes and
before the method returns, add a sweep over all watched symbols:

```js
    // Monitor open positions for SL/TP breach (structural exits).
    const mids = {};
    for (const symbol of this.symbolsToWatch) mids[symbol] = await this._midFor(symbol);
    await this._sweepExits(mids);
```

- [ ] **Step 3d: Open on EXECUTE + sweep in `runCycle` (candle path)**

In `runCycle`, after the candle EXECUTE call (currently line ~157
`const executionResult = await this.tradeExecutor.executeTrade(tradeParams);`),
add right after the success thought:

```js
        if (executionResult.success) await this._openPosition(symbol, order, executionResult.executedPrice ?? order.entryPrice);
```

And add a sweep at the TOP of the candle branch — immediately AFTER the OB
short-circuit block returns (i.e. after line 114, before `let lastProposal = null;`):

```js
    // Candle path also monitors open positions each cycle.
    {
      const mids = {};
      for (const symbol of this.symbolsToWatch) mids[symbol] = await this._getCurrentPrice(symbol);
      await this._sweepExits(mids);
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_orchestrator_ob_mode.mjs`
Expected: PASS — existing checks + 4 new (`drain opens one position`, `opened side BUY`, `sweep closes at TP`, `exit reason TP`, `pnl positive at TP`).

- [ ] **Step 5: Commit**

```bash
git add src/agents/AgentOrchestrator.js tests/test_orchestrator_ob_mode.mjs
git commit -m "feat(ai-positions): orchestrator opens on EXECUTE + sweeps SL/TP exits (both modes)"
```

---

### Task 5: API routes — open positions + closed trades

**Files:**
- Modify: `src/server/routes/agents.routes.js`
- Test: `tests/test_position_routes.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/test_position_routes.mjs
import assert from 'node:assert';
import express from 'express';
import { initDB, getDB } from '../db.js';
import { aiStrategyService } from '../src/server/services/aiStrategyService.js';
import { createAgentsRouter } from '../src/server/routes/agents.routes.js';

let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

await initDB();
const db = getDB('ai');
const AID = 990003;
await db.run('DELETE FROM ai_active_positions WHERE strategy_id = ?', [AID]);
await db.run('DELETE FROM ai_closed_trades WHERE strategy_id = ?', [AID]);
await aiStrategyService.openPosition(AID, { symbol: 'BTCUSDT', side: 'BUY', entryPrice: 100, qty: 2, slPrice: 90, tpPrice: 120 });
await aiStrategyService.recordClosedTrade({ strategy_id: AID, symbol: 'ETHUSDT', side: 'SELL', entry_price: 50, exit_price: 45, qty: 1, size_usd: 50, pnl_usd: 5, exit_reason: 'TP', opened_at: 't0', closed_at: 't1' });

const app = express();
app.use('/api/agents', createAgentsRouter({ size: () => 0 }));
const server = app.listen(0);
const port = server.address().port;
const base = `http://localhost:${port}/api/agents`;

const posRes = await (await fetch(`${base}/${AID}/positions`)).json();
assert.equal(posRes.success, true); ok('positions route ok');
assert.equal(posRes.data.positions.length, 1); ok('one open position returned');
assert.ok('mid' in posRes.data.positions[0]); ok('position carries mid field');

const clRes = await (await fetch(`${base}/${AID}/closed-trades`)).json();
assert.equal(clRes.data.trades.length, 1); ok('one closed trade returned');
assert.equal(clRes.data.trades[0].exit_reason, 'TP'); ok('closed trade reason');

server.close();
await db.run('DELETE FROM ai_active_positions WHERE strategy_id = ?', [AID]);
await db.run('DELETE FROM ai_closed_trades WHERE strategy_id = ?', [AID]);
console.log(`\n${p} checks passed`);
process.exit(0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_position_routes.mjs`
Expected: FAIL — `/positions` returns 404/HTML (route absent) → JSON parse or assertion error.

- [ ] **Step 3: Add the two parameterized routes**

In `src/server/routes/agents.routes.js`, add an import at the top:

```js
import { toolRegistry } from '../../registry/ToolRegistry.js';
```

Then, in the parameterized section (after the `r.get('/:id/equity', ...)` handler,
before `r.put('/:id', ...)`), add:

```js
  r.get('/:id/positions', async (req, res) => {
    try {
      const agentId = Number(req.params.id);
      // Server-side mid + unrealized PnL (math stays on the server).
      const priceFn = async (symbol) => {
        const out = await toolRegistry.executeTool('get_candles', { symbol, interval: '1m', limit: 1 });
        return out.success && out.data.length ? out.data[0].close : 0;
      };
      const positions = await aiStrategyService.getOpenPositionsEnriched(agentId, priceFn);
      res.json({ success: true, data: { positions } });
    } catch (err) {
      console.error(`[AI Positions Error] ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  r.get('/:id/closed-trades', async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const trades = await aiStrategyService.listClosedTrades(Number(req.params.id), limit);
      res.json({ success: true, data: { trades } });
    } catch (err) {
      console.error(`[AI Closed Trades Error] ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_position_routes.mjs`
Expected: PASS — `5 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/agents.routes.js tests/test_position_routes.mjs
git commit -m "feat(ai-positions): GET /:id/positions (enriched) + /:id/closed-trades routes"
```

---

### Task 6: Cockpit UI — Open Positions + Closed Trades panels

**Files:**
- Modify: `frontend/src/pages/AICockpitPage.tsx`

- [ ] **Step 1: Add types + state + fetchers**

After the existing `Trade` interface (line ~26), add:

```tsx
interface OpenPosition {
  symbol: string;
  side: string;
  entryPrice: number;
  qty: number;
  slPrice: number;
  tpPrice: number;
  mid: number | null;
  unrealizedPnl: number | null;
}

interface ClosedTrade {
  id: number;
  symbol: string;
  side: string;
  entry_price: number;
  exit_price: number;
  qty: number;
  size_usd: number;
  pnl_usd: number;
  exit_reason: string;
  closed_at: string;
}
```

After the `const [trades, setTrades] = useState<Trade[]>([]);` line (~46), add:

```tsx
  const [positions, setPositions] = useState<OpenPosition[]>([]);
  const [closedTrades, setClosedTrades] = useState<ClosedTrade[]>([]);
```

After the `fetchEquity` effect (~188), add two fetchers + effects:

```tsx
  const fetchPositions = useCallback(async () => {
    try {
      const res = await fetch(`http://localhost:3000/api/agents/${id}/positions`);
      const data = await res.json();
      if (data.success) setPositions(data.data.positions);
    } catch (err) {
      console.error('Failed to fetch open positions', err);
    }
  }, [id]);

  const fetchClosedTrades = useCallback(async () => {
    try {
      const res = await fetch(`http://localhost:3000/api/agents/${id}/closed-trades`);
      const data = await res.json();
      if (data.success) setClosedTrades(data.data.trades);
    } catch (err) {
      console.error('Failed to fetch closed trades', err);
    }
  }, [id]);

  useEffect(() => {
    fetchPositions();
    fetchClosedTrades();
    const timer = setInterval(() => { fetchPositions(); fetchClosedTrades(); }, 10000);
    return () => clearInterval(timer);
  }, [fetchPositions, fetchClosedTrades]);
```

- [ ] **Step 2: Render the Open Positions panel**

Immediately BEFORE the `{/* AI Trades Table */}` comment (line ~389), insert:

```tsx
          {/* Open Positions */}
          <Card className="overflow-hidden">
            <div className="p-4 border-b border-border">
              <h2 className="text-lg font-bold">Open Positions</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="p-3 font-medium">Symbol</th>
                    <th className="p-3 font-medium">Side</th>
                    <th className="p-3 font-medium">Entry</th>
                    <th className="p-3 font-medium">Mid</th>
                    <th className="p-3 font-medium">uPnL</th>
                    <th className="p-3 font-medium">SL</th>
                    <th className="p-3 font-medium">TP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {positions.length === 0 ? (
                    <tr><td colSpan={7} className="p-8 text-center text-muted-foreground italic">No open positions.</td></tr>
                  ) : (
                    positions.map((pos, i) => (
                      <tr key={i} className="hover:bg-muted/50">
                        <td className="p-3 font-medium">{pos.symbol}</td>
                        <td className="p-3">
                          <Badge variant={pos.side === 'BUY' ? 'success' : 'danger'} className="text-[10px]">{pos.side}</Badge>
                        </td>
                        <td className="p-3">{pos.entryPrice?.toFixed(2)}</td>
                        <td className="p-3">{pos.mid != null ? pos.mid.toFixed(2) : '—'}</td>
                        <td className={'p-3 ' + ((pos.unrealizedPnl ?? 0) >= 0 ? 'text-green-500' : 'text-red-500')}>
                          {pos.unrealizedPnl != null ? `$${pos.unrealizedPnl.toFixed(2)}` : '—'}
                        </td>
                        <td className="p-3 text-muted-foreground">{pos.slPrice?.toFixed(2)}</td>
                        <td className="p-3 text-muted-foreground">{pos.tpPrice?.toFixed(2)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
```

- [ ] **Step 3: Render the Closed Trades panel**

Immediately AFTER the closing `</Card>` of the AI Trades Table (line ~450, before
the `</div>` that closes the right column), insert:

```tsx
          {/* Closed Trades */}
          <Card className="overflow-hidden">
            <div className="p-4 border-b border-border">
              <h2 className="text-lg font-bold">Closed Trades</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="p-3 font-medium">Closed</th>
                    <th className="p-3 font-medium">Symbol</th>
                    <th className="p-3 font-medium">Side</th>
                    <th className="p-3 font-medium">Entry</th>
                    <th className="p-3 font-medium">Exit</th>
                    <th className="p-3 font-medium">PnL</th>
                    <th className="p-3 font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {closedTrades.length === 0 ? (
                    <tr><td colSpan={7} className="p-8 text-center text-muted-foreground italic">No closed trades yet.</td></tr>
                  ) : (
                    closedTrades.map((t) => (
                      <tr key={t.id} className="hover:bg-muted/50">
                        <td className="p-3 text-xs text-muted-foreground">{new Date(t.closed_at).toLocaleString()}</td>
                        <td className="p-3 font-medium">{t.symbol}</td>
                        <td className="p-3">
                          <Badge variant={t.side === 'BUY' ? 'success' : 'danger'} className="text-[10px]">{t.side}</Badge>
                        </td>
                        <td className="p-3">{t.entry_price?.toFixed(2)}</td>
                        <td className="p-3">{t.exit_price?.toFixed(2)}</td>
                        <td className={'p-3 ' + ((t.pnl_usd ?? 0) >= 0 ? 'text-green-500' : 'text-red-500')}>${t.pnl_usd?.toFixed(2)}</td>
                        <td className="p-3"><Badge variant="default" className="text-[10px]">{t.exit_reason}</Badge></td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
```

- [ ] **Step 4: Build to verify it compiles**

Run: `cd frontend && npm run build`
Expected: build succeeds (no TS errors). If `npm run lint` is configured, also run it.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/AICockpitPage.tsx
git commit -m "feat(ai-positions): cockpit Open Positions + Closed Trades panels"
```

---

### Task 7: Regression, memory, graph

**Files:**
- No new code; verification + docs.

- [ ] **Step 1: Run the full relevant suite**

Run each and confirm PASS:
```bash
node tests/test_position_ledger.mjs
node tests/test_position_schema.mjs
node tests/test_position_service.mjs
node tests/test_orchestrator_ob_mode.mjs
node tests/test_position_routes.mjs
node tests/test_ob_analyst.mjs
node tests/test_ob_guardrails.mjs
node tests/test_ai_agents.mjs
```
Expected: all PASS, no regressions in the existing OB/ai-agent tests.

- [ ] **Step 2: Update memory**

Append to `C:\Users\iparafin\.claude\projects\C--Git-TradingLab-AI\memory\project_orderbook_feed.md`
a short entry: position lifecycle now closes the loop AI-wide (pure `PositionLedger`
+ `ai_closed_trades` + orchestrator `_openPosition`/`_sweepExits` + cockpit panels);
note SL/TP-only exits, one-position-per-symbol, closes recorded only in
`ai_closed_trades` to keep `tradesToday` = opens. Add a one-line pointer in
`MEMORY.md` if not already covered by the existing order-book entry.

- [ ] **Step 3: Update the knowledge graph**

Run: `graphify update .`
Expected: "Rebuilt: N nodes ...".

- [ ] **Step 4: Commit**

```bash
git add docs/
git commit -m "docs(ai-positions): regression notes; lifecycle closed AI-wide"
```

---

## Self-Review

**Spec coverage:**
- PositionLedger (open/checkExits/realizedPnl) → Task 1 ✓
- Schema (active-position cols + ai_closed_trades) → Task 2 ✓
- Persistence + enrichment (server-side PnL) → Task 3 ✓
- Orchestrator open-on-EXECUTE + sweep, both modes, mid sourcing → Task 4 ✓
- API /positions + /closed-trades → Task 5 ✓
- Shared cockpit Open Positions + Closed Trades panels → Task 6 ✓
- One-position-per-symbol lock → Task 3 (INSERT OR IGNORE on PK) ✓
- SL/TP-only exits, no time-stop/flip → ledger only checks SL/TP ✓
- Error handling: missing mid passthrough (Task 1), record-then-delete ordering (Task 4), bad-qty guard (Task 4) ✓
- Tests: ledger unit, schema, service, orchestrator integration, routes, regression → Tasks 1–7 ✓

**Deviation from spec (documented):** spec said to also log a closing fill into
`ai_paper_trades`; the plan records closes ONLY in `ai_closed_trades` so that
`tradesToday` (the `maxTradesPerDay` gate input, which counts `ai_paper_trades`
rows) keeps counting opens only. This is a correctness fix, not a scope change.

**Type consistency:** `order.{side,sizeUSD,entryPrice,slPrice,tpPrice}` used
identically in Tasks 4; ledger position shape `{symbol,side,entryPrice,qty,slPrice,
tpPrice,openedAt}` consistent across Tasks 1/3/4; closed-trade row keys
(`strategy_id,symbol,side,entry_price,exit_price,qty,size_usd,pnl_usd,exit_reason,
opened_at,closed_at`) consistent across Tasks 2/3/4/5. `checkExits` output
`{closed:[{...,exitPrice,exitReason,pnlUsd}],remaining}` consumed correctly in Task 4.

**Placeholder scan:** none — every code step has full code; every run step has an
exact command + expected output.
