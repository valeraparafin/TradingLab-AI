# Phase 5b — Backtest Lab Dashboard (read-only) — Design

**Status:** approved (brainstorming)
**Branch:** `feat/signal-core` (must NOT merge until all phases complete — spec §10 merge gate)
**Parent spec:** `docs/superpowers/specs/2026-06-02-signal-core-backtest-design.md`
**Date:** 2026-06-04

## 1. Goal & scope

Surface the backtest results already persisted in `backtest.db` (Phase 5a) in the
Trading Lab dashboard, **read-only**. The matrix is still launched from the CLI
(`node backtest/run-matrix.js …`); the dashboard only reads and visualises.

User flow:

1. **Backtest Lab page** (`/backtest`) — pick a run group → see a **comparison table**
   of that group's runs (one row per matrix cell, sorted by net PnL desc).
2. Click a row → **Run detail page** (`/backtest/run/:id`) — metric summary cards,
   an **equity curve** (recharts), and the **trade list**.

Out of scope (deferred / not this phase): launching matrices from the UI, editing
runs, deleting runs, live websocket updates, auth. The page reads static results.

## 2. Architecture

```
frontend (React/TS/Vite)
  pages/BacktestLabPage.tsx        GET /api/backtest/groups
  pages/BacktestRunPage.tsx        GET /api/backtest/groups/:group
                                   GET /api/backtest/runs/:id
        │  lib/api.ts → backtestApi
        ▼
server.js  app.use('/api/backtest', backtestRouter)
        ▼
src/server/routes/backtest.routes.js   (thin Express handlers, try/catch → 500)
        ▼
src/server/services/backtest.service.js (lazy-open backtest.db, DTO shaping/sort)
        ▼
src/backtest/BacktestRepo.js  (+ new listGroups())  → backtest.db (sqlite, gitignored)
```

All math/derivation (row mapping, sort, JSON parsing of `*_json` columns) lives on
the server (CLAUDE.md: server-side logic priority). The frontend only renders.

## 3. Backend

### 3.1 `BacktestRepo.listGroups()` (new method)

Returns one entry per distinct `run_group`, ordered most-recent first, plus a
synthetic bucket for ungrouped single runs so the dashboard can show CLI single
runs too:

```sql
SELECT run_group AS "group",
       COUNT(*)        AS run_count,
       MIN(period_from) AS period_from,
       MAX(period_to)   AS period_to,
       MAX(id)          AS latest_run_id
FROM backtest_runs
GROUP BY run_group
ORDER BY latest_run_id DESC
```

Rows with `run_group IS NULL` collapse into one entry with `group: null` (the
service labels it `"(ungrouped)"`). No new index needed (`idx_runs_group` exists).

### 3.2 `backtest.service.js` (new)

A module that lazily opens `backtest.db` once (memoised promise) via
`openBacktestDb(path.join(process.cwd(), 'backtest.db'))` + `BacktestRepo`.
`openBacktestDb` runs idempotent CREATE-TABLE DDL, so a first call on a machine
that never ran a matrix yields an empty (but valid) db — endpoints then return
empty arrays, never errors.

Exports (async functions, not a class needed, but a small object for symmetry with
`assetService`):

- `listGroups()` → `Array<{ group: string|null, label, runCount, periodFrom, periodTo, latestRunId }>`.
- `getGroup(group)` → `{ group, runs: Row[] }` where each `Row` is a flat DTO:
  `{ id, label, logicType, symbol, tf, leverage, trades, winRate, profitFactor,
     netPnlPct, finalEquity, maxDrawdownPct, sharpe, totalFunding, liquidations }`,
  built from each run's parsed `metrics_json`, sorted by `netPnlPct` desc with a
  nullish-safe comparator (`(b.netPnlPct ?? -Infinity) - (a.netPnlPct ?? -Infinity)`,
  mirroring `buildReport`). `group === null` selects `run_group IS NULL` runs.
- `getRunDetail(id)` → `{ run, equityCurve, trades }` where `run` has parsed
  `metrics`, `params`, `costs` (from the `*_json` columns) plus the scalar columns;
  `equityCurve` from `getEquityCurve`, `trades` from `getTrades`. Returns `null` if
  the run id does not exist (route → 404).

**Note on DTO vs `buildReport`:** the CLI's `buildReport` returns `{rows, table}`
but its rows carry no `id`, so they can't drive drill-down links. The service does
its own thin map (same fields + `id` + `label`) rather than mutate the tested 5a
`buildReport`. The shared knowledge (which metrics matter) is intentionally small;
the shapes differ by purpose (console table vs clickable API rows).

**Infinity handling:** `metrics_json` was written with the `finite` replacer
(Infinity/NaN → null), so parsed values are already JSON-safe; the service passes
them through untouched and the frontend renders `null` as `—`/`∞` per column.

### 3.3 `backtest.routes.js` (new) + mount

Mirrors `asset.routes.js` (try/catch → `res.status(500).json({error})`):

- `GET /api/backtest/groups` → `service.listGroups()`
- `GET /api/backtest/groups/:group` → `service.getGroup(req.params.group)`
  (the literal path segment `ungrouped` maps to `group: null`)
- `GET /api/backtest/runs/:id` → `service.getRunDetail(Number(req.params.id))`;
  `null` → `res.status(404).json({error:'run not found'})`

`server.js`: add `import backtestRouter from './src/server/routes/backtest.routes.js'`
and `app.use('/api/backtest', backtestRouter)` alongside the other mounts. No
service `init()` at startup (lazy open on first request keeps server boot decoupled
from `backtest.db`).

## 4. Frontend

### 4.1 `lib/api.ts`

Add interfaces (`BacktestGroup`, `BacktestRunRow`, `BacktestRunDetail`, `EquityPoint`,
`BacktestTrade`) and:

```ts
export const backtestApi = {
  getGroups: () => api.get<BacktestGroup[]>('/backtest/groups'),
  getGroup: (group: string) => api.get<{ group: string|null; runs: BacktestRunRow[] }>(`/backtest/groups/${encodeURIComponent(group)}`),
  getRun: (id: number) => api.get<BacktestRunDetail>(`/backtest/runs/${id}`),
};
```

### 4.2 Pages & components

- `pages/BacktestLabPage.tsx` (`/backtest`): fetches groups, renders a group
  selector (list/dropdown), and `<BacktestComparisonTable>` for the selected group.
  Empty-state when no groups: "No backtest runs yet — run `node backtest/run-matrix.js …`".
- `pages/BacktestRunPage.tsx` (`/backtest/run/:id`): fetches run detail; metric
  summary cards (reuse the muted-card style from `App.tsx`), `<EquityCurveChart>`,
  `<TradesTable>`. Back link to `/backtest`.
- `components/BacktestComparisonTable.tsx`: rows clickable → navigate
  `/backtest/run/:id`. Columns: label, symbol, tf, lev, trades, win%, PF, net%,
  final equity, maxDD%, sharpe, funding, liq. Non-finite/null → `—`; PF `null` → `∞`.
- `components/EquityCurveChart.tsx`: recharts `<LineChart>` over `equityCurve`
  (`time` x, `equity` y); responsive container; tooltip with formatted time/equity.
- `components/TradesTable.tsx`: side, entry/exit time+price, sizeUSD, pnl (red/green),
  fees, reason.

### 4.3 `App.tsx`

Add nav `<Link to="/backtest">Backtest</Link>` and routes `/backtest` +
`/backtest/run/:id`. No other changes.

## 5. Data flow & error handling

- Read-only; no sockets, no polling (results are static once written).
- `backtest.db` missing/empty → `listGroups()` returns `[]` → page shows empty-state.
- Unknown run id → 404 → run page shows "Run not found" with a back link.
- Network/server error → axios rejects → page shows an inline error message
  (consistent with existing pages' `console.error` + fallback render).

## 6. Testing

- **Backend (node:assert, project style):** `tests/test_backtest_service.js` —
  open `openBacktestDb(':memory:')`, seed 3 runs across 2 groups + 1 ungrouped via
  `BacktestRepo.saveRun/saveTrades/saveEquityCurve`, then assert:
  1. `listGroups()` returns the right groups with counts, ungrouped bucket present,
     ordered by latest run desc.
  2. `getGroup(g)` returns DTO rows sorted by `netPnlPct` desc with the expected
     fields; `getGroup(null)`/ungrouped path works.
  3. `getRunDetail(id)` parses `metrics`/`params`/`costs`, returns equity + trades;
     unknown id → `null`.
  The service must accept an injectable repo/db (or a test-only factory) so the test
  drives a `:memory:` db without touching the real file.
- **Backend regression:** full existing suite stays green (no changes to 5a files
  except the additive `listGroups`).
- **Frontend:** `cd frontend && npm run build` (typecheck) + `npm run lint`. No FE
  unit-test framework exists in this repo; build+lint is the gate.

## 7. Casing & conventions

- DB columns stay snake_case (`run_group`, `logic_type`, `period_from`); the service
  maps to camelCase DTOs at the boundary (CLAUDE.md casing policy).
- `*Pct` values are fractions; the frontend multiplies by 100 for display only.
- No new npm dependencies (recharts `^3.8.1` already present; axios already used).

## 8. Files touched

New: `src/server/services/backtest.service.js`, `src/server/routes/backtest.routes.js`,
`tests/test_backtest_service.js`, `frontend/src/pages/BacktestLabPage.tsx`,
`frontend/src/pages/BacktestRunPage.tsx`,
`frontend/src/components/BacktestComparisonTable.tsx`,
`frontend/src/components/EquityCurveChart.tsx`,
`frontend/src/components/TradesTable.tsx`.

Modified: `src/backtest/BacktestRepo.js` (+`listGroups`), `server.js` (mount),
`frontend/src/lib/api.ts` (+`backtestApi`), `frontend/src/App.tsx` (nav + routes).
