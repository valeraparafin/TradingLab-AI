# Backtest Lab Dashboard (read-only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface persisted backtest results (`backtest.db`) in the dashboard read-only: group selector → comparison table → run detail (equity curve + trades).

**Architecture:** New `listGroups`/`listUngroupedRuns` on `BacktestRepo`; a lazy-opening `backtest.service.js` that shapes snake_case rows into camelCase DTOs and sorts by net PnL; thin `/api/backtest` Express routes; React pages/components using existing recharts + axios. No new deps. No live-code touch (strangler discipline — spec §10).

**Tech Stack:** Node ESM, sqlite (`sqlite`/`sqlite3`), Express, React + TypeScript + Vite, react-router-dom, recharts ^3.8.1, axios. Tests: `node:assert` scripts run via `node tests/<file>.js`.

**Spec:** `docs/superpowers/specs/2026-06-04-backtest-dashboard-design.md`

---

### Task 1: `BacktestRepo` group queries

**Files:**
- Modify: `src/backtest/BacktestRepo.js` (add two methods after `listRunsByGroup`)
- Test: `tests/test_backtest_repo_listgroups.js` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/test_backtest_repo_listgroups.js`:

```js
// tests/test_backtest_repo_listgroups.js
import assert from 'node:assert';
import { openBacktestDb } from '../src/backtest/backtestSchema.js';
import { BacktestRepo } from '../src/backtest/BacktestRepo.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

const db = await openBacktestDb(':memory:');
const repo = new BacktestRepo(db);
const base = { logicType: 'SMC', symbol: 'BTCUSDT', timeframe: '1H', periodFrom: 5, periodTo: 50, leverage: 1, params: {}, costs: {}, metrics: {} };
try {
  await repo.saveRun({ ...base, strategyLabel: 'a', group: 'g1' });
  await repo.saveRun({ ...base, strategyLabel: 'b', group: 'g1' });
  await repo.saveRun({ ...base, strategyLabel: 'c', group: 'g2' });
  await repo.saveRun({ ...base, strategyLabel: 'd', group: null });

  // 1. aggregates per run_group (NULLs collapse into one bucket)
  {
    const rows = await repo.listGroups();
    const g1 = rows.find(r => r.group === 'g1');
    assert.strictEqual(g1.run_count, 2);
    assert.strictEqual(g1.period_from, 5);
    assert.strictEqual(g1.period_to, 50);
    assert.ok(rows.some(r => r.group === null && r.run_count === 1), 'null group bucket present');
    ok('listGroups aggregates counts/period per group');
  }
  // 2. ordered by latest run id descending
  {
    const rows = await repo.listGroups();
    assert.ok(rows[0].latest_run_id >= rows[rows.length - 1].latest_run_id, 'ordered desc');
    ok('listGroups ordered by latest run desc');
  }
  // 3. listUngroupedRuns returns only null-group runs
  {
    const rows = await repo.listUngroupedRuns();
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].strategy_label, 'd');
    ok('listUngroupedRuns returns null-group runs only');
  }
} finally {
  await db.close();
}
console.log(`\n${passed} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_backtest_repo_listgroups.js`
Expected: FAIL — `repo.listGroups is not a function`.

- [ ] **Step 3: Implement the two methods**

In `src/backtest/BacktestRepo.js`, immediately after the `listRunsByGroup` method (before the closing `}` of the class), add:

```js
  /** One row per distinct run_group (NULLs collapse into one bucket), latest run first. */
  async listGroups() {
    return this.db.all(
      `SELECT run_group AS "group",
              COUNT(*)         AS run_count,
              MIN(period_from) AS period_from,
              MAX(period_to)   AS period_to,
              MAX(id)          AS latest_run_id
         FROM backtest_runs
        GROUP BY run_group
        ORDER BY latest_run_id DESC`
    );
  }

  /** Runs with no group (run_group IS NULL), oldest first. */
  async listUngroupedRuns() {
    return this.db.all('SELECT * FROM backtest_runs WHERE run_group IS NULL ORDER BY id ASC');
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_backtest_repo_listgroups.js`
Expected: PASS — `3 checks passed`.

- [ ] **Step 5: Run the existing repo group test (regression)**

Run: `node tests/test_backtest_repo_group.js`
Expected: PASS (unchanged — additive methods only).

- [ ] **Step 6: Commit**

```bash
git add src/backtest/BacktestRepo.js tests/test_backtest_repo_listgroups.js
git commit -m "feat(backtest): BacktestRepo.listGroups + listUngroupedRuns"
```

---

### Task 2: `backtest.service.js` (DTO shaping + sort)

**Files:**
- Create: `src/server/services/backtest.service.js`
- Test: `tests/test_backtest_service.js` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/test_backtest_service.js`:

```js
// tests/test_backtest_service.js
import assert from 'node:assert';
import { openBacktestDb } from '../src/backtest/backtestSchema.js';
import { BacktestRepo } from '../src/backtest/BacktestRepo.js';
import { createBacktestService } from '../src/server/services/backtest.service.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

const db = await openBacktestDb(':memory:');
const repo = new BacktestRepo(db);
const svc = createBacktestService(repo);

const mkMetrics = (netPnlPct) => ({
  trades: { count: 5, wins: 3, losses: 2, winRate: 0.6, profitFactor: 1.5 },
  return: { netPnl: 100, netPnlPct, finalEquity: 10000 * (1 + netPnlPct) },
  risk: { maxDrawdownPct: 0.05, sharpe: 1.1, sortino: 1.4 },
  costs: { totalFees: 5, slippageCost: 1, totalFunding: 0, liquidationCount: 0 },
  breakdown: { long: { count: 3 }, short: { count: 2 } },
});
const base = { logicType: 'SMC', symbol: 'BTCUSDT', timeframe: '1H', periodFrom: 1, periodTo: 100, leverage: 1, costs: {} };

let a1, u1;
try {
  a1 = await repo.saveRun({ ...base, strategyLabel: 'SMC/aggressive BTCUSDT 1H', params: { lookback: 250 }, metrics: mkMetrics(0.05), group: 'gA' });
  await repo.saveRun({ ...base, strategyLabel: 'SMC/conservative BTCUSDT 1H', params: {}, metrics: mkMetrics(0.20), group: 'gA' });
  await repo.saveRun({ ...base, symbol: 'ETHUSDT', timeframe: '4H', leverage: 3, strategyLabel: 'SMC/aggressive ETHUSDT 4H', params: {}, metrics: mkMetrics(0.10), group: 'gB' });
  u1 = await repo.saveRun({ ...base, strategyLabel: 'SMC BTCUSDT 1H', params: {}, metrics: mkMetrics(0.01), group: null });
  await repo.saveTrades(a1, [{ side: 'BUY', entryTime: 10, entryPrice: 100, exitTime: 20, exitPrice: 110, sizeUSD: 50, pnl: 5, fees: 0.1, reason: 'tp' }]);
  await repo.saveEquityCurve(a1, [{ time: 10, equity: 10000 }, { time: 20, equity: 10050 }]);

  // 1. listGroups buckets runs incl. ungrouped, with labels
  {
    const groups = await svc.listGroups();
    const labels = groups.map(g => g.label);
    assert.ok(labels.includes('gA') && labels.includes('gB') && labels.includes('(ungrouped)'), 'all groups present');
    assert.strictEqual(groups.find(g => g.group === 'gA').runCount, 2);
    assert.strictEqual(groups.find(g => g.group === null).runCount, 1);
    ok('listGroups buckets runs incl. ungrouped');
  }
  // 2. getGroup returns camelCase DTO rows sorted by netPnlPct desc
  {
    const { runs } = await svc.getGroup('gA');
    assert.strictEqual(runs.length, 2);
    assert.ok(runs[0].netPnlPct >= runs[1].netPnlPct, 'sorted desc');
    assert.strictEqual(runs[0].netPnlPct, 0.20);
    assert.strictEqual(runs[0].logicType, 'SMC');
    assert.strictEqual(runs[0].trades, 5);
    ok('getGroup returns sorted camelCase DTO rows');
  }
  // 3. getGroup('ungrouped') maps to run_group IS NULL
  {
    const { group, runs } = await svc.getGroup('ungrouped');
    assert.strictEqual(group, null);
    assert.strictEqual(runs.length, 1);
    assert.strictEqual(runs[0].id, u1);
    ok('getGroup(ungrouped) selects null-group runs');
  }
  // 4. getRunDetail parses json + camelCases trades + returns equity
  {
    const d = await svc.getRunDetail(a1);
    assert.strictEqual(d.run.id, a1);
    assert.strictEqual(d.run.metrics.return.netPnlPct, 0.05, 'metrics parsed');
    assert.strictEqual(d.run.params.lookback, 250, 'params parsed');
    assert.strictEqual(d.equityCurve.length, 2);
    assert.strictEqual(d.trades.length, 1);
    assert.strictEqual(d.trades[0].entryTime, 10, 'trade camelCase entryTime');
    assert.strictEqual(d.trades[0].sizeUSD, 50, 'trade camelCase sizeUSD');
    ok('getRunDetail parses json and camelCases trades');
  }
  // 5. unknown id -> null
  {
    assert.strictEqual(await svc.getRunDetail(99999), null);
    ok('unknown run id returns null');
  }
} finally {
  await db.close();
}
console.log(`\n${passed} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_backtest_service.js`
Expected: FAIL — cannot find module `backtest.service.js`.

- [ ] **Step 3: Implement the service**

Create `src/server/services/backtest.service.js`:

```js
// src/server/services/backtest.service.js
import path from 'path';
import { openBacktestDb } from '../../backtest/backtestSchema.js';
import { BacktestRepo } from '../../backtest/BacktestRepo.js';

/** Parse a JSON column safely; return `fallback` on null/parse error. */
function parseJson(s, fallback) {
  if (s == null) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

/** Nullish-safe descending comparator on netPnlPct (mirrors buildReport). */
const byNetPnlDesc = (a, b) => (b.netPnlPct ?? -Infinity) - (a.netPnlPct ?? -Infinity);

/** Map a raw snake_case run row to a flat camelCase comparison-table DTO. */
function toRow(run) {
  const m = parseJson(run.metrics_json, {});
  return {
    id: run.id,
    label: run.strategy_label,
    logicType: run.logic_type,
    symbol: run.symbol,
    tf: run.timeframe,
    leverage: run.leverage,
    trades: m.trades?.count ?? 0,
    winRate: m.trades?.winRate ?? null,
    profitFactor: m.trades?.profitFactor ?? null,
    netPnlPct: m.return?.netPnlPct ?? null,
    finalEquity: m.return?.finalEquity ?? null,
    maxDrawdownPct: m.risk?.maxDrawdownPct ?? null,
    sharpe: m.risk?.sharpe ?? null,
    totalFunding: m.costs?.totalFunding ?? null,
    liquidations: m.costs?.liquidationCount ?? 0,
  };
}

/** Map a raw snake_case trade row to a camelCase DTO. */
function toTrade(t) {
  return {
    idx: t.idx, side: t.side,
    entryTime: t.entry_time, entryPrice: t.entry_price,
    exitTime: t.exit_time, exitPrice: t.exit_price,
    sizeUSD: t.size_usd, pnl: t.pnl, fees: t.fees, reason: t.reason,
  };
}

/**
 * Build a read-only backtest service over an injected BacktestRepo.
 * Exposed for tests (drive a :memory: db); production uses the lazy singleton below.
 */
export function createBacktestService(repo) {
  return {
    async listGroups() {
      const rows = await repo.listGroups();
      return rows.map(r => ({
        group: r.group ?? null,
        label: r.group ?? '(ungrouped)',
        runCount: r.run_count,
        periodFrom: r.period_from,
        periodTo: r.period_to,
        latestRunId: r.latest_run_id,
      }));
    },

    async getGroup(group) {
      const isNull = group == null || group === 'ungrouped';
      const runs = isNull ? await repo.listUngroupedRuns() : await repo.listRunsByGroup(group);
      return { group: isNull ? null : group, runs: runs.map(toRow).sort(byNetPnlDesc) };
    },

    async getRunDetail(id) {
      const run = await repo.getRun(id);
      if (!run) return null;
      const [equityCurve, rawTrades] = await Promise.all([repo.getEquityCurve(id), repo.getTrades(id)]);
      return {
        run: {
          id: run.id,
          label: run.strategy_label,
          logicType: run.logic_type,
          symbol: run.symbol,
          tf: run.timeframe,
          leverage: run.leverage,
          periodFrom: run.period_from,
          periodTo: run.period_to,
          group: run.run_group ?? null,
          metrics: parseJson(run.metrics_json, {}),
          params: parseJson(run.params_json, {}),
          costs: parseJson(run.costs_json, {}),
        },
        equityCurve,
        trades: rawTrades.map(toTrade),
      };
    },
  };
}

// Lazy singleton: open backtest.db once on first request. openBacktestDb runs
// idempotent CREATE-TABLE DDL, so a never-run-a-matrix machine yields an empty
// (valid) db and endpoints return empty arrays instead of erroring.
let _instancePromise = null;
async function getInstance() {
  if (!_instancePromise) {
    _instancePromise = (async () => {
      const db = await openBacktestDb(path.join(process.cwd(), 'backtest.db'));
      return createBacktestService(new BacktestRepo(db));
    })();
  }
  return _instancePromise;
}

export const backtestService = {
  listGroups: async () => (await getInstance()).listGroups(),
  getGroup: async (g) => (await getInstance()).getGroup(g),
  getRunDetail: async (id) => (await getInstance()).getRunDetail(id),
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_backtest_service.js`
Expected: PASS — `5 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/backtest.service.js tests/test_backtest_service.js
git commit -m "feat(backtest): read-only backtest service (groups/runs DTOs)"
```

---

### Task 3: `/api/backtest` routes + server mount

**Files:**
- Create: `src/server/routes/backtest.routes.js`
- Modify: `server.js` (import + mount)
- Test: `tests/test_backtest_routes.js` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/test_backtest_routes.js`:

```js
// tests/test_backtest_routes.js
// Structural test: assert the router exposes the 3 read routes. Importing the
// router does NOT open backtest.db (the service opens lazily on first call),
// so this stays a pure import-time check with no db side effects.
import assert from 'node:assert';
import router from '../src/server/routes/backtest.routes.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

assert.strictEqual(typeof router, 'function', 'express router is a function');
const paths = router.stack.filter(l => l.route).map(l => l.route.path);
assert.ok(paths.includes('/groups'), 'GET /groups registered');
assert.ok(paths.includes('/groups/:group'), 'GET /groups/:group registered');
assert.ok(paths.includes('/runs/:id'), 'GET /runs/:id registered');
ok('backtest router exposes the 3 read routes');

console.log(`\n${passed} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_backtest_routes.js`
Expected: FAIL — cannot find module `backtest.routes.js`.

- [ ] **Step 3: Implement the routes**

Create `src/server/routes/backtest.routes.js`:

```js
import express from 'express';
import { backtestService } from '../services/backtest.service.js';

const router = express.Router();

/** GET /groups — distinct run groups (+ ungrouped bucket). */
router.get('/groups', async (req, res) => {
  try {
    res.json(await backtestService.listGroups());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /groups/:group — comparison rows for one group ('ungrouped' => null group). */
router.get('/groups/:group', async (req, res) => {
  try {
    res.json(await backtestService.getGroup(req.params.group));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /runs/:id — run detail: metrics/params/costs + equity curve + trades. */
router.get('/runs/:id', async (req, res) => {
  try {
    const detail = await backtestService.getRunDetail(Number(req.params.id));
    if (!detail) return res.status(404).json({ error: 'run not found' });
    res.json(detail);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
```

- [ ] **Step 4: Mount the router in `server.js`**

In `server.js`, add the import alongside the other route imports (immediately after the `assetRouter` import on line 19):

```js
import backtestRouter from './src/server/routes/backtest.routes.js';
```

And add the mount alongside the other `app.use('/api/...')` lines (immediately after the `assetRouter` mount, currently line 39):

```js
app.use('/api/backtest', backtestRouter);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node tests/test_backtest_routes.js`
Expected: PASS — `1 checks passed`.

- [ ] **Step 6: Verify server.js still parses**

Run: `node --check server.js`
Expected: no output, exit 0 (syntax OK).

- [ ] **Step 7: Commit**

```bash
git add src/server/routes/backtest.routes.js server.js tests/test_backtest_routes.js
git commit -m "feat(backtest): /api/backtest read routes + server mount"
```

---

### Task 4: Frontend API layer (`backtestApi` + types)

**Files:**
- Modify: `frontend/src/lib/api.ts` (append interfaces + `backtestApi`)

- [ ] **Step 1: Append types and the API object**

At the END of `frontend/src/lib/api.ts` (after the `assetApi` export), add:

```ts
// ---- Backtest Lab (read-only) ----

export interface BacktestGroup {
  group: string | null;
  label: string;
  runCount: number;
  periodFrom: number;
  periodTo: number;
  latestRunId: number;
}

export interface BacktestRunRow {
  id: number;
  label: string;
  logicType: string;
  symbol: string;
  tf: string;
  leverage: number;
  trades: number;
  winRate: number | null;
  profitFactor: number | null;
  netPnlPct: number | null;
  finalEquity: number | null;
  maxDrawdownPct: number | null;
  sharpe: number | null;
  totalFunding: number | null;
  liquidations: number;
}

export interface EquityPoint {
  time: number;
  equity: number;
}

export interface BacktestTrade {
  idx: number;
  side: string;
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  sizeUSD: number;
  pnl: number;
  fees: number;
  reason: string;
}

export interface BacktestRunDetail {
  run: {
    id: number;
    label: string;
    logicType: string;
    symbol: string;
    tf: string;
    leverage: number;
    periodFrom: number;
    periodTo: number;
    group: string | null;
    metrics: any;
    params: any;
    costs: any;
  };
  equityCurve: EquityPoint[];
  trades: BacktestTrade[];
}

export const backtestApi = {
  getGroups: () => api.get<BacktestGroup[]>('/backtest/groups'),
  getGroup: (group: string) =>
    api.get<{ group: string | null; runs: BacktestRunRow[] }>(`/backtest/groups/${encodeURIComponent(group)}`),
  getRun: (id: number) => api.get<BacktestRunDetail>(`/backtest/runs/${id}`),
};
```

- [ ] **Step 2: Typecheck (compiles cleanly)**

Run: `cd frontend && npm run build`
Expected: build succeeds (no TS errors). This also covers later tasks' consumers once they exist; here it confirms the new types compile.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat(backtest-ui): backtestApi client + result types"
```

---

### Task 5: Presentational components (table, chart, trades)

**Files:**
- Create: `frontend/src/components/BacktestComparisonTable.tsx`
- Create: `frontend/src/components/EquityCurveChart.tsx`
- Create: `frontend/src/components/TradesTable.tsx`

- [ ] **Step 1: Create the comparison table**

Create `frontend/src/components/BacktestComparisonTable.tsx`:

```tsx
import React from 'react';
import { BacktestRunRow } from '../lib/api';
import { Card } from './ui/components';

const pct = (v: number | null) => (v == null || !isFinite(v) ? '—' : (v * 100).toFixed(2) + '%');
const num = (v: number | null) => (v == null || !isFinite(v) ? '—' : v.toFixed(2));
const pf = (v: number | null) => (v == null || !isFinite(v) ? '∞' : v.toFixed(2));

interface Props {
  rows: BacktestRunRow[];
  onSelect: (id: number) => void;
}

export function BacktestComparisonTable({ rows, onSelect }: Props) {
  if (!rows.length) return <Card className="p-6 text-muted-foreground">No runs in this group.</Card>;
  return (
    <Card className="p-0 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground border-b border-border">
            <th className="p-2">Strategy</th><th className="p-2">Sym</th><th className="p-2">TF</th>
            <th className="p-2">Lev</th><th className="p-2">Trades</th><th className="p-2">Win%</th>
            <th className="p-2">PF</th><th className="p-2">Net%</th><th className="p-2">Equity</th>
            <th className="p-2">MaxDD%</th><th className="p-2">Sharpe</th><th className="p-2">Funding</th><th className="p-2">Liq</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr
              key={r.id}
              className="border-b border-border hover:bg-muted cursor-pointer"
              onClick={() => onSelect(r.id)}
            >
              <td className="p-2 font-medium">{r.label}</td>
              <td className="p-2">{r.symbol}</td>
              <td className="p-2">{r.tf}</td>
              <td className="p-2">{r.leverage}x</td>
              <td className="p-2">{r.trades}</td>
              <td className="p-2">{pct(r.winRate)}</td>
              <td className="p-2">{pf(r.profitFactor)}</td>
              <td className={'p-2 ' + ((r.netPnlPct ?? 0) >= 0 ? 'text-green-500' : 'text-red-500')}>{pct(r.netPnlPct)}</td>
              <td className="p-2">{num(r.finalEquity)}</td>
              <td className="p-2">{pct(r.maxDrawdownPct)}</td>
              <td className="p-2">{num(r.sharpe)}</td>
              <td className="p-2">{num(r.totalFunding)}</td>
              <td className="p-2">{r.liquidations}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
```

- [ ] **Step 2: Create the equity curve chart**

Create `frontend/src/components/EquityCurveChart.tsx`:

```tsx
import React from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { EquityPoint } from '../lib/api';

export function EquityCurveChart({ data }: { data: EquityPoint[] }) {
  if (!data.length) return <div className="text-muted-foreground">No equity data.</div>;
  const fmtDate = (t: number) => new Date(t).toLocaleDateString();
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#333" />
        <XAxis dataKey="time" tickFormatter={fmtDate} stroke="#888" fontSize={12} />
        <YAxis domain={['auto', 'auto']} stroke="#888" fontSize={12} />
        <Tooltip
          labelFormatter={(t) => new Date(Number(t)).toLocaleString()}
          formatter={(v: number) => [Number(v).toFixed(2), 'Equity']}
        />
        <Line type="monotone" dataKey="equity" stroke="#22c55e" dot={false} strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 3: Create the trades table**

Create `frontend/src/components/TradesTable.tsx`:

```tsx
import React from 'react';
import { BacktestTrade } from '../lib/api';
import { Card } from './ui/components';

const time = (t: number) => new Date(t).toLocaleString();

export function TradesTable({ trades }: { trades: BacktestTrade[] }) {
  if (!trades.length) return <Card className="p-6 text-muted-foreground">No trades.</Card>;
  return (
    <Card className="p-0 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground border-b border-border">
            <th className="p-2">#</th><th className="p-2">Side</th><th className="p-2">Entry</th>
            <th className="p-2">Exit</th><th className="p-2">Size$</th><th className="p-2">PnL</th>
            <th className="p-2">Fees</th><th className="p-2">Reason</th>
          </tr>
        </thead>
        <tbody>
          {trades.map(t => (
            <tr key={t.idx} className="border-b border-border">
              <td className="p-2">{t.idx}</td>
              <td className={'p-2 font-medium ' + (t.side === 'BUY' ? 'text-green-500' : 'text-red-500')}>{t.side}</td>
              <td className="p-2">{time(t.entryTime)}<div className="text-xs text-muted-foreground">{t.entryPrice}</div></td>
              <td className="p-2">{time(t.exitTime)}<div className="text-xs text-muted-foreground">{t.exitPrice}</div></td>
              <td className="p-2">{t.sizeUSD?.toFixed(2)}</td>
              <td className={'p-2 ' + (t.pnl >= 0 ? 'text-green-500' : 'text-red-500')}>{t.pnl?.toFixed(2)}</td>
              <td className="p-2">{t.fees?.toFixed(2)}</td>
              <td className="p-2">{t.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npm run build`
Expected: build succeeds. (Components are not yet imported anywhere; this confirms they compile in isolation.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/BacktestComparisonTable.tsx frontend/src/components/EquityCurveChart.tsx frontend/src/components/TradesTable.tsx
git commit -m "feat(backtest-ui): comparison table, equity chart, trades table"
```

---

### Task 6: Pages + routing (`BacktestLabPage`, `BacktestRunPage`, `App.tsx`)

**Files:**
- Create: `frontend/src/pages/BacktestLabPage.tsx`
- Create: `frontend/src/pages/BacktestRunPage.tsx`
- Modify: `frontend/src/App.tsx` (nav link + 2 routes)

- [ ] **Step 1: Create the lab page**

Create `frontend/src/pages/BacktestLabPage.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { backtestApi, BacktestGroup, BacktestRunRow } from '../lib/api';
import { Card } from '../components/ui/components';
import { BacktestComparisonTable } from '../components/BacktestComparisonTable';

export function BacktestLabPage() {
  const [groups, setGroups] = useState<BacktestGroup[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [runs, setRuns] = useState<BacktestRunRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    backtestApi.getGroups()
      .then(res => {
        setGroups(res.data);
        if (res.data.length) setSelected(res.data[0].group ?? 'ungrouped');
      })
      .catch(e => setError(e.message));
  }, []);

  useEffect(() => {
    if (selected == null) return;
    backtestApi.getGroup(selected)
      .then(res => setRuns(res.data.runs))
      .catch(e => setError(e.message));
  }, [selected]);

  if (error) return <Card className="p-6 text-red-500">Error: {error}</Card>;
  if (!groups.length) {
    return (
      <Card className="p-6 text-muted-foreground">
        No backtest runs yet — run <code className="text-foreground">node backtest/run-matrix.js …</code>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <h2 className="text-xl font-bold">Backtest Lab</h2>
        <select
          className="bg-muted border border-border rounded-md px-3 py-1 text-sm"
          value={selected ?? ''}
          onChange={e => setSelected(e.target.value)}
        >
          {groups.map(g => (
            <option key={g.label} value={g.group ?? 'ungrouped'}>
              {g.label} ({g.runCount})
            </option>
          ))}
        </select>
      </div>
      <BacktestComparisonTable rows={runs} onSelect={id => navigate(`/backtest/run/${id}`)} />
    </div>
  );
}
```

- [ ] **Step 2: Create the run detail page**

Create `frontend/src/pages/BacktestRunPage.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { backtestApi, BacktestRunDetail } from '../lib/api';
import { Card } from '../components/ui/components';
import { EquityCurveChart } from '../components/EquityCurveChart';
import { TradesTable } from '../components/TradesTable';

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="p-4 rounded-lg bg-muted border border-border">
    <div className="text-xs text-muted-foreground uppercase">{label}</div>
    <div className="text-2xl font-bold">{value}</div>
  </div>
);

export function BacktestRunPage() {
  const { id } = useParams();
  const [detail, setDetail] = useState<BacktestRunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    backtestApi.getRun(Number(id))
      .then(res => setDetail(res.data))
      .catch(e => setError(e.response?.status === 404 ? 'Run not found' : e.message));
  }, [id]);

  if (error) {
    return (
      <Card className="p-6">
        <div className="text-red-500 mb-4">{error}</div>
        <Link to="/backtest" className="text-primary">← Back to Backtest Lab</Link>
      </Card>
    );
  }
  if (!detail) return <Card className="p-6 text-muted-foreground">Loading…</Card>;

  const m = detail.run.metrics || {};
  const pct = (v: number | undefined) => (v == null || !isFinite(v) ? '—' : (v * 100).toFixed(2) + '%');
  const num = (v: number | undefined) => (v == null || !isFinite(v) ? '—' : v.toFixed(2));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">{detail.run.label}</h2>
        <Link to="/backtest" className="text-sm text-primary">← Back</Link>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Net PnL" value={pct(m.return?.netPnlPct)} />
        <Stat label="Final Equity" value={num(m.return?.finalEquity)} />
        <Stat label="Win Rate" value={pct(m.trades?.winRate)} />
        <Stat label="Trades" value={String(m.trades?.count ?? 0)} />
        <Stat label="Max Drawdown" value={pct(m.risk?.maxDrawdownPct)} />
        <Stat label="Sharpe" value={num(m.risk?.sharpe)} />
        <Stat label="Funding" value={num(m.costs?.totalFunding)} />
        <Stat label="Liquidations" value={String(m.costs?.liquidationCount ?? 0)} />
      </div>
      <Card className="p-6">
        <h3 className="text-lg font-bold mb-4">Equity Curve</h3>
        <EquityCurveChart data={detail.equityCurve} />
      </Card>
      <div>
        <h3 className="text-lg font-bold mb-4">Trades</h3>
        <TradesTable trades={detail.trades} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire into `App.tsx`**

In `frontend/src/App.tsx`, add these imports after the existing page imports (after the `AICockpitPage` import on line 10):

```tsx
import { BacktestLabPage } from './pages/BacktestLabPage';
import { BacktestRunPage } from './pages/BacktestRunPage';
```

Add a nav link inside the `<nav>` block, after the Assets link (currently line 54):

```tsx
<Link to="/backtest" className="text-sm font-medium hover:text-primary transition-colors">Backtest</Link>
```

Add the two routes inside `<Routes>`, after the `/assets` route (currently line 103):

```tsx
<Route path="/backtest" element={<BacktestLabPage />} />
<Route path="/backtest/run/:id" element={<BacktestRunPage />} />
```

- [ ] **Step 4: Typecheck + lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: build succeeds (no TS errors); lint passes (no new errors).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/BacktestLabPage.tsx frontend/src/pages/BacktestRunPage.tsx frontend/src/App.tsx
git commit -m "feat(backtest-ui): Backtest Lab + run detail pages, routes, nav"
```

---

## Final verification (after all tasks)

- [ ] Run the full backtest test suite — all green:

```bash
node tests/test_backtest_repo_listgroups.js
node tests/test_backtest_repo_group.js
node tests/test_backtest_service.js
node tests/test_backtest_routes.js
node tests/test_backtest_integration.js
node tests/test_futures_integration.js
node tests/test_matrix.js
node tests/test_matrix_integration.js
node tests/test_build_report.js
node tests/test_run_one.js
node tests/test_risk_profile_to_guardrails.js
```

- [ ] Frontend builds + lints: `cd frontend && npm run build && npm run lint`
- [ ] `node --check server.js` passes.
- [ ] Branch is still `feat/signal-core` and NOT merged (spec §10 merge gate holds).

## Notes for the implementer

- **Casing:** DB columns are snake_case; the service is the boundary that maps to camelCase DTOs. Never leak `entry_time`/`size_usd` to the frontend.
- **No live touch:** Do not modify `bot_engine.js`, `paramResolver.js`, `resolveAgentParams`, or any live trading code. This phase is read-only over `backtest.db`.
- **No new deps:** recharts and axios are already installed. Do not add packages.
- **`*Pct` are fractions:** multiply by 100 only for display (the `pct()` helpers do this).
- **Empty state is normal:** a machine that never ran a matrix has an empty `backtest.db`; endpoints must return `[]`, not error.
