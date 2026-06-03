# Phase 5a — Matrix Runner + Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a matrix backtest runner that sweeps `{risk profiles} × {logic templates} × {symbols} × {timeframes}` into N persisted runs plus a comparison report, driven by a single canonical risk→guardrails bridge shared (by construction) with the live AI path.

**Architecture:** Extract the per-run execution body of `backtest/run-backtest.js` into a reusable `runOne(btRepo, params)`. Add a *pure* canonical `riskProfileToGuardrails(settings, {leverage, mmr})` that maps a version-controlled file risk template (`templates/risk/*.json`) into the exact `guardrails` shape `simulate`/`RiskPolicy` consume — using the same percent→fraction semantics the live `resolveAgentParams` uses, and locked to it by an equivalence test. A new `backtest/run-matrix.js` CLI expands the cross product, calls `runOne` per cell tagging all rows with one `run_group`, and prints a pure `buildReport` comparison table. **No live code is modified in this phase** (spec §10: Phase 5 "Touches live? no"). Unifying `resolveAgentParams` onto this bridge is deferred to Phase 6 behind characterization + flags.

**Tech Stack:** Node.js ESM, SQLite (`sqlite`/`sqlite3`), `node:assert` test scripts run via `node tests/<file>.js` (no framework, no new deps).

**Casing reminder:** storage (file templates / DB) is snake_case or camelCase-with-`Percent` suffix; runtime `guardrails` use camelCase with `*Pct` **fractions**. `maxTradeSizeUSD` keeps its uppercase `USD` in both template and guardrails (it has no underscore, so `toCamel` leaves it intact) — do NOT rename it to `maxTradeSizeUsd`.

---

## File Structure

- **Create** `src/agents/riskProfileToGuardrails.js` — pure canonical risk-settings → guardrails bridge (the "narrow waist" for risk config). Owns its own `normFraction` copy (intentional duplicate of `paramResolver.js`'s; Phase 6 unifies them).
- **Create** `backtest/buildReport.js` — pure comparison-table formatter over an array of run summaries.
- **Create** `backtest/run-matrix.js` — matrix CLI: expand dimensions, load risk templates, call `runOne` per cell with a shared group tag, print report.
- **Modify** `backtest/run-backtest.js` — extract `runOne(btRepo, params)` and `printSummary(...)`; `main()` becomes a thin single-cell caller. Behavior for single runs unchanged.
- **Modify** `src/backtest/backtestSchema.js` — add `run_group TEXT` column to `backtest_runs` (with idempotent ALTER migration for existing dbs) + a group index.
- **Modify** `src/backtest/BacktestRepo.js` — `saveRun` writes `run_group`; add `listRunsByGroup(group)`.
- **Create** `tests/test_risk_profile_to_guardrails.js`
- **Create** `tests/test_run_one.js`
- **Create** `tests/test_build_report.js`
- **Create** `tests/test_matrix.js`
- **Create** `tests/test_matrix_integration.js`

---

## Task 1: Canonical `riskProfileToGuardrails` bridge (pure) + equivalence to live

**Files:**
- Create: `src/agents/riskProfileToGuardrails.js`
- Test: `tests/test_risk_profile_to_guardrails.js`

**Context:** `resolveAgentParams` (`src/agents/paramResolver.js:38-50`) is the live AI bridge that turns a stored risk profile into `guardrails`. We need the SAME mapping available as a standalone pure function that consumes the **camelCase-with-`Percent`** settings shape produced by file templates (`templates/risk/*.json` after `toCamel`, validated by `config_resolver.js`'s `RiskSchema`). To keep Phase 5a zero-touch on live, this function carries its own copy of `normFraction`; the equivalence test guarantees it stays byte-identical to `resolveAgentParams`'s output, so Phase 6 can safely refactor `resolveAgentParams` to delegate here.

- [ ] **Step 1: Write the failing test**

```js
// tests/test_risk_profile_to_guardrails.js
import assert from 'node:assert';
import { riskProfileToGuardrails } from '../src/agents/riskProfileToGuardrails.js';
import { resolveAgentParams } from '../src/agents/paramResolver.js';

let passed = 0;
const ok = (name) => { console.log(`  ok - ${name}`); passed++; };

// 1. percent (whole-number) inputs normalize to fractions
{
  const g = riskProfileToGuardrails({
    riskPerTradePercent: 5, stopLossPercent: 5, takeProfitPercent: 15,
    maxTradeSizeUSD: 500, maxOpenPositions: 8, maxPortfolioHeatPercent: 15,
    dailyLossLimitPercent: 5, dailyProfitTargetPercent: 10,
    maxTradesPerDay: 10, minRiskRewardRatio: 1.5, portfolioValue: 1000,
  });
  assert.strictEqual(g.riskPerTrade, 0.05);
  assert.strictEqual(g.stopLossPct, 0.05);
  assert.strictEqual(g.takeProfitPct, 0.15);
  assert.strictEqual(g.maxPortfolioHeatPct, 0.15);
  assert.strictEqual(g.dailyLossLimitPct, 0.05);
  assert.strictEqual(g.dailyProfitTargetPct, 0.10);
  assert.strictEqual(g.maxTradeSizeUSD, 500);
  assert.strictEqual(g.maxOpenPositions, 8);
  assert.strictEqual(g.maxTradesPerDay, 10);
  assert.strictEqual(g.minRiskRewardRatio, 1.5);
  assert.strictEqual(g.portfolioValue, 1000);
  assert.strictEqual(g.leverage, 1);
  assert.strictEqual(g.mmr, null);
  ok('whole-number percents normalize to fractions');
}

// 2. already-fractional inputs pass through unchanged
{
  const g = riskProfileToGuardrails({
    riskPerTradePercent: 0.01, stopLossPercent: 0.02, takeProfitPercent: 0.04,
    maxPortfolioHeatPercent: 0.5, dailyLossLimitPercent: 0.03,
  });
  assert.strictEqual(g.riskPerTrade, 0.01);
  assert.strictEqual(g.stopLossPct, 0.02);
  assert.strictEqual(g.takeProfitPct, 0.04);
  assert.strictEqual(g.maxPortfolioHeatPct, 0.5);
  assert.strictEqual(g.dailyLossLimitPct, 0.03);
  ok('fractional inputs pass through');
}

// 3. missing optional gates default to Infinity / sane fallbacks
{
  const g = riskProfileToGuardrails({ riskPerTradePercent: 1 });
  assert.strictEqual(g.maxTradeSizeUSD, Infinity);
  assert.strictEqual(g.maxOpenPositions, Infinity);
  assert.strictEqual(g.maxPortfolioHeatPct, Infinity);
  assert.strictEqual(g.dailyLossLimitPct, Infinity);
  assert.strictEqual(g.maxTradesPerDay, Infinity);
  assert.strictEqual(g.minRiskRewardRatio, 0);
  assert.strictEqual(g.portfolioValue, 10000);
  ok('missing gates default to Infinity / fallbacks');
}

// 4. leverage + mmr flow through
{
  const g = riskProfileToGuardrails({ riskPerTradePercent: 1 }, { leverage: 10, mmr: 0.005 });
  assert.strictEqual(g.leverage, 10);
  assert.strictEqual(g.mmr, 0.005);
  ok('leverage and mmr flow through');
}

// 5. EQUIVALENCE: same logical profile via the live AI path produces identical guardrails.
//    snake_case DB profile + agent ; camelCase file-template settings.
{
  const snakeProfile = {
    risk_per_trade_percent: 5, stop_loss_percent: 5, take_profit_percent: 15,
    max_trade_size_usd: 500, max_open_positions: 8, max_portfolio_heat_percent: 15,
    daily_loss_limit_percent: 5, daily_profit_target_percent: 10,
    max_trades_per_day: 10, min_risk_reward_ratio: 1.5,
  };
  const agent = { id: 1, portfolio_value: 1000, watchlist: 'BTCUSDT', timeframe: '1H', trade_mode: 'spot' };
  const live = resolveAgentParams(agent, snakeProfile).guardrails;

  const camelSettings = {
    riskPerTradePercent: 5, stopLossPercent: 5, takeProfitPercent: 15,
    maxTradeSizeUSD: 500, maxOpenPositions: 8, maxPortfolioHeatPercent: 15,
    dailyLossLimitPercent: 5, dailyProfitTargetPercent: 10,
    maxTradesPerDay: 10, minRiskRewardRatio: 1.5, portfolioValue: 1000,
  };
  const bridged = riskProfileToGuardrails(camelSettings);

  // Compare only the keys the live path produces (it has no leverage/mmr).
  for (const k of Object.keys(live)) {
    assert.strictEqual(bridged[k], live[k], `mismatch on guardrails.${k}: bridge=${bridged[k]} live=${live[k]}`);
  }
  ok('bridge guardrails == resolveAgentParams guardrails (parity lock)');
}

console.log(`\n${passed} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_risk_profile_to_guardrails.js`
Expected: FAIL — `Cannot find module '.../riskProfileToGuardrails.js'`.

- [ ] **Step 3: Write the implementation**

```js
// src/agents/riskProfileToGuardrails.js

/**
 * Normalize a stored percent that may already be a fraction (0.05) or a whole
 * percent (5) into a FRACTION. Intentional copy of paramResolver.js's normFraction
 * so this module is self-contained; Phase 6 unifies the two (resolveAgentParams will
 * delegate here). The equivalence test in tests/test_risk_profile_to_guardrails.js
 * guarantees the two copies stay identical.
 */
function normFraction(v) {
  if (v == null || !isFinite(v)) return v;
  return v > 1 ? v / 100 : v;
}

/**
 * Canonical risk-config → guardrails bridge. Consumes the camelCase-with-`Percent`
 * settings shape produced by file risk templates (templates/risk/*.json after toCamel,
 * validated by config_resolver.js's RiskSchema) and produces the exact `guardrails`
 * object that simulate()/RiskPolicy consume. This is the single source of truth for the
 * percent→fraction mapping shared by the backtest matrix and (in Phase 6) the live path.
 *
 * @param {object} s    risk settings (camelCase, *Percent keys)
 * @param {{leverage?: number, mmr?: number|null}} [opts]
 * @returns {object} guardrails (camelCase, *Pct fractions) + leverage + mmr
 */
export function riskProfileToGuardrails(s = {}, { leverage = 1, mmr = null } = {}) {
  return {
    riskPerTrade: normFraction(s.riskPerTradePercent ?? 0.01),
    stopLossPct: normFraction(s.stopLossPercent),
    takeProfitPct: normFraction(s.takeProfitPercent),
    maxTradeSizeUSD: s.maxTradeSizeUSD ?? Infinity,
    maxOpenPositions: s.maxOpenPositions ?? Infinity,
    maxPortfolioHeatPct: normFraction(s.maxPortfolioHeatPercent) ?? Infinity,
    dailyLossLimitPct: normFraction(s.dailyLossLimitPercent) ?? Infinity,
    dailyProfitTargetPct: normFraction(s.dailyProfitTargetPercent),
    // Counts/ratios are NOT percents — never normalize.
    maxTradesPerDay: s.maxTradesPerDay ?? Infinity,
    minRiskRewardRatio: s.minRiskRewardRatio ?? 0,
    portfolioValue: s.portfolioValue ?? 10000,
    leverage,
    mmr,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_risk_profile_to_guardrails.js`
Expected: PASS — `5 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/agents/riskProfileToGuardrails.js tests/test_risk_profile_to_guardrails.js
git commit -m "feat(backtest): canonical riskProfileToGuardrails bridge with live-parity test"
```

---

## Task 2: `run_group` persistence (schema + repo)

**Files:**
- Modify: `src/backtest/backtestSchema.js`
- Modify: `src/backtest/BacktestRepo.js`
- Test: `tests/test_backtest_repo_group.js`

**Context:** Matrix runs must be grouped so the report and dashboard can fetch "all cells of one matrix." We add a nullable `run_group TEXT` column. `CREATE TABLE IF NOT EXISTS` will NOT add a column to a pre-existing `backtest_runs`, so include an idempotent `ALTER TABLE` migration. Single (non-matrix) runs pass `group: null` and are unaffected.

- [ ] **Step 1: Write the failing test**

```js
// tests/test_backtest_repo_group.js
import assert from 'node:assert';
import { openBacktestDb } from '../src/backtest/backtestSchema.js';
import { BacktestRepo } from '../src/backtest/BacktestRepo.js';

const baseRun = (over = {}) => ({
  strategyLabel: 'X', logicType: 'SMC', symbol: 'BTCUSDT', timeframe: '1H',
  periodFrom: 1, periodTo: 2, leverage: 1, params: {}, costs: {}, metrics: {}, ...over,
});

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

const db = await openBacktestDb(':memory:');
const repo = new BacktestRepo(db);

// 1. group is persisted and round-trips
{
  const id = await repo.saveRun(baseRun({ group: 'm_test_1' }));
  const row = await repo.getRun(id);
  assert.strictEqual(row.run_group, 'm_test_1');
  ok('group persisted on saveRun');
}

// 2. omitting group stores NULL (single-run back-compat)
{
  const id = await repo.saveRun(baseRun());
  const row = await repo.getRun(id);
  assert.strictEqual(row.run_group, null);
  ok('absent group stores NULL');
}

// 3. listRunsByGroup returns only that group
{
  await repo.saveRun(baseRun({ group: 'm_test_2', symbol: 'ETHUSDT' }));
  await repo.saveRun(baseRun({ group: 'm_test_2', symbol: 'LTCUSDT' }));
  const rows = await repo.listRunsByGroup('m_test_2');
  assert.strictEqual(rows.length, 2);
  assert.ok(rows.every(r => r.run_group === 'm_test_2'));
  ok('listRunsByGroup filters by group');
}

await db.close();
console.log(`\n${passed} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_backtest_repo_group.js`
Expected: FAIL — `run_group` is undefined (column/param missing) or `listRunsByGroup is not a function`.

- [ ] **Step 3: Add the column + migration in `backtestSchema.js`**

In `src/backtest/backtestSchema.js`, add `run_group TEXT` to the `backtest_runs` CREATE (after `metrics_json`), add a group index, and append an idempotent ALTER for pre-existing dbs. Replace the `backtest_runs` CREATE block and the trailing index line:

```js
    CREATE TABLE IF NOT EXISTS backtest_runs (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      strategy_label TEXT    NOT NULL,
      logic_type     TEXT    NOT NULL,
      symbol         TEXT    NOT NULL,
      timeframe      TEXT    NOT NULL,
      period_from    INTEGER,
      period_to      INTEGER,
      leverage       REAL    NOT NULL,
      params_json    TEXT,
      costs_json     TEXT,
      metrics_json   TEXT,
      run_group      TEXT
    );
```

Then immediately AFTER the `await db.exec(\`...\`)` block (before `return db;`), add the migration for older databases that predate the column:

```js
  // Idempotent migration: add run_group to pre-existing databases (CREATE IF NOT EXISTS
  // won't add columns to a table that already exists).
  const cols = await db.all(`PRAGMA table_info(backtest_runs)`);
  if (!cols.some(c => c.name === 'run_group')) {
    await db.exec(`ALTER TABLE backtest_runs ADD COLUMN run_group TEXT`);
  }
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_runs_group ON backtest_runs (run_group)`);
```

- [ ] **Step 4: Wire `run_group` through `BacktestRepo`**

In `src/backtest/BacktestRepo.js`, update `saveRun` to insert the group, and add `listRunsByGroup`. Replace the `saveRun` body:

```js
  /** Insert a run (metadata + JSON params/costs/metrics). Returns the new run id. */
  async saveRun(run) {
    const r = await this.db.run(
      `INSERT INTO backtest_runs
         (strategy_label, logic_type, symbol, timeframe, period_from, period_to, leverage, params_json, costs_json, metrics_json, run_group)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [run.strategyLabel, run.logicType, run.symbol, run.timeframe, run.periodFrom, run.periodTo, run.leverage,
       JSON.stringify(run.params || {}, finite), JSON.stringify(run.costs || {}, finite), JSON.stringify(run.metrics || {}, finite),
       run.group ?? null]
    );
    return r.lastID;
  }
```

And add after `listRuns()`:

```js
  /** All runs in a matrix group, oldest first (matrix cell order). */
  async listRunsByGroup(group) {
    return this.db.all('SELECT * FROM backtest_runs WHERE run_group = ? ORDER BY id ASC', [group]);
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node tests/test_backtest_repo_group.js`
Expected: PASS — `3 checks passed`.

- [ ] **Step 6: Regression — existing repo/integration tests still green**

Run: `node tests/test_backtest_integration.js`
Expected: PASS, still 21 trades (column addition is backward compatible).

- [ ] **Step 7: Commit**

```bash
git add src/backtest/backtestSchema.js src/backtest/BacktestRepo.js tests/test_backtest_repo_group.js
git commit -m "feat(backtest): persist run_group for matrix grouping (schema + repo)"
```

---

## Task 3: Extract `runOne` + `printSummary` from `run-backtest.js`

**Files:**
- Modify: `backtest/run-backtest.js`
- Test: `tests/test_run_one.js`

**Context:** Single-run `main()` currently inlines: build funding (if leverage>1) → `simulate` → `computeMetrics` → persist → print. The matrix runner needs the same execution body per cell. Extract it into `runOne(btRepo, params)` returning `{ runId, metrics }`, and a `printSummary(...)`. `main()` keeps loading data + building guardrails/costs, then delegates. Single-run console output and persisted shape must stay identical (group defaults to `null`).

- [ ] **Step 1: Write the failing test**

```js
// tests/test_run_one.js
import assert from 'node:assert';
import { runOne } from '../backtest/run-backtest.js';
import { openBacktestDb } from '../src/backtest/backtestSchema.js';
import { BacktestRepo } from '../src/backtest/BacktestRepo.js';

// Synthetic zig-zag candles so a forced decider produces trades deterministically.
function candles(n) {
  const out = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    const base = 100 + (i % 2 === 0 ? 0 : 5);
    out.push({ time: t, open: base, high: base + 2, low: base - 2, close: base + (i % 2 === 0 ? 1 : -1), volume: 10 });
    t += 3600000;
  }
  return out;
}

// Forced decider matching the real simulate() contract: decide(ctx, account) where
// ctx = { candles: window, config, symbol, timeframe }, returning { decision }.
// The simulator only calls decide when flat, then fills order at the NEXT bar's open
// (entryPrice is ignored). Always-PERMIT a spot BUY → deterministic trades.
function makeDecider() {
  return (ctx) => {
    const w = ctx.candles;
    const last = w[w.length - 1];
    return { decision: { decision: 'PERMIT', order: { side: 'BUY', sizeUSD: 100, slPrice: last.close * 0.98, tpPrice: last.close * 1.04 } } };
  };
}

const guardrails = {
  portfolioValue: 10000, riskPerTrade: 0.1, maxTradeSizeUSD: Infinity,
  stopLossPct: 0.02, takeProfitPct: 0.04, minRiskRewardRatio: 1.5,
  maxOpenPositions: 1, maxPortfolioHeatPct: 100, dailyLossLimitPct: 1,
  dailyProfitTargetPct: null, maxTradesPerDay: 999999, leverage: 1, mmr: null,
};
const costs = { takerFee: 0.0006, makerFee: 0.0002, slippageBps: 5, liqFeeRate: 0.0006 };

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

const db = await openBacktestDb(':memory:');
const repo = new BacktestRepo(db);
const cs = candles(60);
const lookback = 20;

// 1. runOne returns runId + metrics and persists a run + trades
{
  const { runId, metrics } = await runOne(repo, {
    label: 'unit', logicType: 'SMC', symbol: 'BTCUSDT', tf: '1H',
    lookback, leverage: 1, candles: cs, spec: null, realRows: [],
    guardrails, costs, fundingMode: 'real-mean', fundingRate: 0,
    group: 'm_unit', decide: makeDecider(),
  });
  assert.ok(runId > 0, 'runId assigned');
  assert.ok(metrics && metrics.trades, 'metrics returned');
  const row = await repo.getRun(runId);
  assert.strictEqual(row.run_group, 'm_unit', 'group tagged');
  assert.strictEqual(row.leverage, 1);
  ok('runOne persists run with group + returns metrics');
}

// 2. spot run records zero funding (parity: futures dormant at leverage 1)
{
  const { metrics } = await runOne(repo, {
    label: 'unit2', logicType: 'SMC', symbol: 'BTCUSDT', tf: '1H',
    lookback, leverage: 1, candles: cs, spec: null, realRows: [],
    guardrails, costs, fundingMode: 'real-mean', fundingRate: 0,
    group: null, decide: makeDecider(),
  });
  assert.strictEqual(metrics.costs.totalFunding, 0, 'spot funding is zero');
  ok('spot run has zero funding');
}

await db.close();
console.log(`\n${passed} checks passed`);
```

> Contract (verified against `src/backtest/simulator.js:124-134`): `decide(ctx, account)` is called only when flat, with `ctx = { candles: window, config, symbol, timeframe }` and `account = { guardrails, portfolio }`; it must return `{ decision }` where `decision = { decision: 'PERMIT', order: { side, slPrice, tpPrice, sizeUSD } }`. The order fills at the NEXT bar's open (no `entryPrice` needed). The test must exercise the real `simulate`, not a stub.

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_run_one.js`
Expected: FAIL — `runOne` is not exported.

- [ ] **Step 3: Extract `runOne` and `printSummary`; rewrite `main()`**

In `backtest/run-backtest.js`, ADD the two exported functions (place them after `fmtPct`, before `main`):

```js
/**
 * Execute one backtest cell: build funding (futures only), simulate, compute metrics,
 * and persist the run + trades + equity curve. Returns { runId, metrics }.
 * Shared by the single-run CLI (main) and the matrix runner.
 *
 * @param {BacktestRepo} btRepo open backtest repository
 * @param {object} p { label, logicType, symbol, tf, lookback, leverage, candles, spec,
 *   realRows, guardrails, costs, fundingMode, fundingRate, group?, decide? }
 */
export async function runOne(btRepo, p) {
  let funding = null;
  if (p.leverage > 1) {
    if (p.guardrails.mmr == null) throw new Error(`No MMR for ${p.symbol} (need contract spec or --mmr) for futures.`);
    const fundIntervalH = (p.spec && p.spec.fund_interval_h) || 8;
    const rateAt = buildFundingSeries({ realRows: p.realRows || [], mode: p.fundingMode, constantRate: p.fundingRate });
    funding = { rateAt, intervalMs: fundIntervalH * 3600000 };
    console.log(`[backtest] funding mode=${p.fundingMode}, real rows=${(p.realRows || []).length}, interval=${fundIntervalH}h`);
  }

  console.log(`[backtest] ${p.label}: ${p.candles.length} candles, lookback ${p.lookback}, leverage ${p.leverage}${p.leverage > 1 ? ' (futures)' : ' (spot)'}`);
  const config = { logicType: p.logicType, logic: {} };
  const sim = p.decide
    ? simulate({ candles: p.candles, config, guardrails: p.guardrails, costs: p.costs, symbol: p.symbol, timeframe: p.tf, lookback: p.lookback, startEquity: p.guardrails.portfolioValue, funding }, p.decide)
    : simulate({ candles: p.candles, config, guardrails: p.guardrails, costs: p.costs, symbol: p.symbol, timeframe: p.tf, lookback: p.lookback, startEquity: p.guardrails.portfolioValue, funding });
  const metrics = computeMetrics({ trades: sim.trades, equityCurve: sim.equityCurve, startEquity: p.guardrails.portfolioValue, slippageCost: sim.slippageCost, timeframe: p.tf, totalFunding: sim.totalFunding, liquidationCount: sim.liquidationCount });

  const runId = await btRepo.saveRun({
    strategyLabel: p.label, logicType: p.logicType, symbol: p.symbol, timeframe: p.tf,
    periodFrom: p.candles[0].time, periodTo: p.candles[p.candles.length - 1].time,
    leverage: p.leverage, params: { lookback: p.lookback, guardrails: p.guardrails }, costs: p.costs, metrics,
    group: p.group ?? null,
  });
  await btRepo.saveTrades(runId, sim.trades);
  await btRepo.saveEquityCurve(runId, sim.equityCurve);
  return { runId, metrics };
}

/** Print the single-run result block. */
export function printSummary({ runId, label, logicType, leverage, metrics }) {
  const m = metrics;
  console.log('\n══════════ BACKTEST RESULT ══════════');
  console.log(`Run id        : ${runId}`);
  console.log(`Strategy      : ${label} (${logicType})`);
  console.log(`Trades        : ${m.trades.count}  (W ${m.trades.wins} / L ${m.trades.losses})`);
  console.log(`Win rate      : ${fmtPct(m.trades.winRate)}`);
  console.log(`Profit factor : ${m.trades.profitFactor === Infinity ? '∞' : m.trades.profitFactor.toFixed(2)}`);
  console.log(`Net PnL       : ${m.return.netPnl.toFixed(2)} USD (${fmtPct(m.return.netPnlPct)})`);
  console.log(`Final equity  : ${m.return.finalEquity.toFixed(2)} USD`);
  console.log(`Max drawdown  : ${fmtPct(m.risk.maxDrawdownPct)}`);
  console.log(`Sharpe/Sortino: ${m.risk.sharpe.toFixed(2)} / ${m.risk.sortino.toFixed(2)}`);
  console.log(`Costs         : fees ${m.costs.totalFees.toFixed(2)}, slippage ${m.costs.slippageCost.toFixed(2)}, funding ${m.costs.totalFunding.toFixed(2)}`);
  if (leverage > 1) console.log(`Liquidations  : ${m.costs.liquidationCount}  (leverage ${leverage}x)`);
  console.log(`Long / Short  : ${m.breakdown.long.count} / ${m.breakdown.short.count}`);
  console.log('═════════════════════════════════════');
}
```

Then REPLACE the body of `main()` from the `let funding = null;` block through the end of the result printing with a delegation to the new helpers. The new `main()` body, replacing lines from `const guardrails = ...` onward:

```js
  const guardrails = buildGuardrails(args, spec);
  const costs = buildCosts(args, spec);

  const btDb = await openBacktestDb(path.join(process.cwd(), 'backtest.db'));
  const btRepo = new BacktestRepo(btDb);
  const { runId, metrics } = await runOne(btRepo, {
    label, logicType, symbol, tf, lookback, leverage,
    candles, spec, realRows, guardrails, costs,
    fundingMode, fundingRate: fundingRateArg, group: args.group ?? null,
  });
  await btDb.close();

  printSummary({ runId, label, logicType, leverage, metrics });
}
```

Delete the now-duplicated `config`, `funding`, `simulate`, `computeMetrics`, `saveRun/saveTrades/saveEquityCurve`, and the inline result-printing block from `main()` (they now live in `runOne`/`printSummary`). Keep `const config = { logicType, logic: {} };` ONLY inside `runOne` — remove it from `main`.

- [ ] **Step 4: Run the unit test**

Run: `node tests/test_run_one.js`
Expected: PASS — `2 checks passed`.

- [ ] **Step 5: Regression — single-run CLI still works end-to-end**

Run: `node backtest/run-backtest.js --symbol BTCUSDT --tf 1H --logic SMC --lookback 250`
Expected: prints the `BACKTEST RESULT` block with a run id and the existing SMC trade count (same as before the refactor). Funding line absent (spot).

Run (futures smoke): `node backtest/run-backtest.js --symbol BTCUSDT --tf 1H --logic SMC --lookback 250 --leverage 10`
Expected: prints `funding mode=real-mean ...`, a `Liquidations :` line, and a `funding` cost ≠ 0.

- [ ] **Step 6: Regression — existing run-backtest unit test green**

Run: `node tests/test_run_backtest.js`
Expected: PASS (buildGuardrails/buildCosts/parseDate untouched).

- [ ] **Step 7: Commit**

```bash
git add backtest/run-backtest.js tests/test_run_one.js
git commit -m "refactor(backtest): extract runOne + printSummary for matrix reuse"
```

---

## Task 4: Pure `buildReport` comparison formatter

**Files:**
- Create: `backtest/buildReport.js`
- Test: `tests/test_build_report.js`

**Context:** The matrix runner collects one summary per cell and needs a deterministic, dashboard-friendly comparison. `buildReport` is PURE (no I/O): it takes an array of `{ riskId, logicType, symbol, tf, leverage, metrics }`, sorts by net PnL % descending, and returns `{ rows, table }` where `rows` is the normalized array (ready for JSON/dashboard) and `table` is a fixed-width console string. Server-side logic; the dashboard later renders `rows`.

- [ ] **Step 1: Write the failing test**

```js
// tests/test_build_report.js
import assert from 'node:assert';
import { buildReport } from '../backtest/buildReport.js';

const mk = (over) => ({
  riskId: 'aggressive', logicType: 'SMC', symbol: 'BTCUSDT', tf: '1H', leverage: 1,
  metrics: {
    trades: { count: 10, winRate: 0.6, profitFactor: 1.8 },
    return: { netPnlPct: 0.12, finalEquity: 11200 },
    risk: { maxDrawdownPct: 0.08, sharpe: 1.3 },
    costs: { totalFunding: 0, liquidationCount: 0 },
  },
  ...over,
});

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

// 1. rows sorted by netPnlPct descending
{
  const r = buildReport([
    mk({ symbol: 'A', metrics: { ...mk().metrics, return: { netPnlPct: 0.05, finalEquity: 1 } } }),
    mk({ symbol: 'B', metrics: { ...mk().metrics, return: { netPnlPct: 0.20, finalEquity: 1 } } }),
    mk({ symbol: 'C', metrics: { ...mk().metrics, return: { netPnlPct: 0.10, finalEquity: 1 } } }),
  ]);
  assert.deepStrictEqual(r.rows.map(x => x.symbol), ['B', 'C', 'A']);
  ok('rows sorted by netPnlPct desc');
}

// 2. table is a string with a header and one line per row
{
  const r = buildReport([mk({ symbol: 'A' }), mk({ symbol: 'B' })]);
  assert.strictEqual(typeof r.table, 'string');
  assert.ok(r.table.includes('WinRate'), 'header present');
  assert.ok(r.table.includes('A') && r.table.includes('B'), 'rows present');
  ok('table renders header + rows');
}

// 3. profitFactor Infinity renders without throwing
{
  const r = buildReport([mk({ metrics: { ...mk().metrics, trades: { count: 3, winRate: 1, profitFactor: Infinity } } })]);
  assert.ok(r.table.includes('∞') || r.table.toLowerCase().includes('inf'), 'infinity rendered');
  ok('infinite profit factor renders');
}

// 4. empty input yields empty rows + a header-only/empty-note table
{
  const r = buildReport([]);
  assert.deepStrictEqual(r.rows, []);
  assert.strictEqual(typeof r.table, 'string');
  ok('empty input handled');
}

console.log(`\n${passed} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_build_report.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
// backtest/buildReport.js

const pct = (x) => (x == null || !Number.isFinite(x) ? '   n/a' : (x * 100).toFixed(2).padStart(6) + '%').padStart(7);
const num = (x, d = 2) => (x == null || !Number.isFinite(x) ? 'n/a' : x.toFixed(d));
const pf = (x) => (x === Infinity ? '∞' : Number.isFinite(x) ? x.toFixed(2) : 'n/a');
const pad = (s, w) => String(s).padEnd(w).slice(0, w);

/**
 * Build a deterministic comparison report over matrix cell summaries.
 * PURE — no I/O. Sorted by net PnL % descending.
 *
 * @param {Array<{riskId:string, logicType:string, symbol:string, tf:string, leverage:number, metrics:object}>} cells
 * @returns {{rows: Array<object>, table: string}} rows = normalized (JSON/dashboard ready); table = console string.
 */
export function buildReport(cells = []) {
  const rows = cells.map(c => ({
    riskId: c.riskId,
    logicType: c.logicType,
    symbol: c.symbol,
    tf: c.tf,
    leverage: c.leverage,
    trades: c.metrics.trades.count,
    winRate: c.metrics.trades.winRate,
    profitFactor: c.metrics.trades.profitFactor,
    netPnlPct: c.metrics.return.netPnlPct,
    finalEquity: c.metrics.return.finalEquity,
    maxDrawdownPct: c.metrics.risk.maxDrawdownPct,
    sharpe: c.metrics.risk.sharpe,
    totalFunding: c.metrics.costs.totalFunding,
    liquidations: c.metrics.costs.liquidationCount,
  })).sort((a, b) => (b.netPnlPct ?? -Infinity) - (a.netPnlPct ?? -Infinity));

  const header = [
    pad('Logic', 10), pad('Risk', 12), pad('Symbol', 9), pad('TF', 4), pad('Lev', 4),
    pad('Trades', 7), pad('WinRate', 8), pad('PF', 6), pad('NetPnl%', 9),
    pad('MaxDD%', 8), pad('Sharpe', 7), pad('Funding', 9), pad('Liq', 4),
  ].join(' ');
  const sep = '─'.repeat(header.length);

  const lines = rows.map(r => [
    pad(r.logicType, 10), pad(r.riskId, 12), pad(r.symbol, 9), pad(r.tf, 4), pad(r.leverage + 'x', 4),
    pad(r.trades, 7), pad(pct(r.winRate).trim(), 8), pad(pf(r.profitFactor), 6), pad(pct(r.netPnlPct).trim(), 9),
    pad(pct(r.maxDrawdownPct).trim(), 8), pad(num(r.sharpe), 7), pad(num(r.totalFunding), 9), pad(r.liquidations ?? 0, 4),
  ].join(' '));

  const body = rows.length ? lines.join('\n') : '(no runs)';
  const table = `\n══════════ MATRIX COMPARISON ══════════\n${header}\n${sep}\n${body}\n${sep}`;
  return { rows, table };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_build_report.js`
Expected: PASS — `4 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add backtest/buildReport.js tests/test_build_report.js
git commit -m "feat(backtest): pure buildReport matrix comparison formatter"
```

---

## Task 5: `backtest/run-matrix.js` CLI

**Files:**
- Create: `backtest/run-matrix.js`
- Test: `tests/test_matrix.js`

**Context:** The matrix CLI expands `{risks} × {logics} × {symbols} × {tfs}` (comma-separated args), loads each risk template from `templates/risk/*.json` through the canonical `riskProfileToGuardrails` bridge, opens `market_data.db` ONCE and `backtest.db` ONCE, runs each cell via `runOne` tagged with a shared `group`, collects summaries, prints `buildReport`, and writes the report rows to `backtest/reports/<group>.json`. To keep the orchestration unit-testable without DB/market dependencies, factor the pure pieces into exported helpers: `expandMatrix(dims)` (cross product) and `loadRiskProfile(riskId)` (file → camelCase settings). `main()` wires I/O around them.

- [ ] **Step 1: Write the failing test (pure helpers only)**

```js
// tests/test_matrix.js
import assert from 'node:assert';
import { expandMatrix, loadRiskProfile } from '../backtest/run-matrix.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

// 1. expandMatrix produces the full cross product in stable order
{
  const cells = expandMatrix({ risks: ['aggressive', 'conservative'], logics: ['SMC'], symbols: ['BTCUSDT', 'ETHUSDT'], tfs: ['1H'] });
  assert.strictEqual(cells.length, 4); // 2 risks × 1 logic × 2 symbols × 1 tf
  assert.deepStrictEqual(cells[0], { riskId: 'aggressive', logicType: 'SMC', symbol: 'BTCUSDT', tf: '1H' });
  assert.deepStrictEqual(cells[3], { riskId: 'conservative', logicType: 'SMC', symbol: 'ETHUSDT', tf: '1H' });
  ok('expandMatrix cross product + order');
}

// 2. loadRiskProfile reads a real template into camelCase *Percent settings
{
  const s = loadRiskProfile('aggressive');
  assert.strictEqual(s.riskPerTradePercent, 0.05);
  assert.strictEqual(s.stopLossPercent, 0.05);
  assert.strictEqual(s.takeProfitPercent, 0.15);
  assert.strictEqual(s.maxTradeSizeUSD, 500);
  assert.strictEqual(s.portfolioValue, 1000);
  ok('loadRiskProfile reads aggressive template');
}

// 3. loadRiskProfile throws a clear error for an unknown id
{
  assert.throws(() => loadRiskProfile('does_not_exist'), /risk template/i);
  ok('loadRiskProfile rejects unknown id');
}

console.log(`\n${passed} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_matrix.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `backtest/run-matrix.js`**

```js
// backtest/run-matrix.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { openMarketDb } from '../src/data/marketDataSchema.js';
import { MarketDataRepo } from '../src/data/MarketDataRepo.js';
import { openBacktestDb } from '../src/backtest/backtestSchema.js';
import { BacktestRepo } from '../src/backtest/BacktestRepo.js';
import { toCamel } from '../src/utils/casing.js';
import { riskProfileToGuardrails } from '../src/agents/riskProfileToGuardrails.js';
import { runOne, buildCosts, parseDate } from './run-backtest.js';
import { buildReport } from './buildReport.js';
import { parseArgs } from './download-data.js';

/** Cross product of matrix dimensions, in stable risk→logic→symbol→tf order. */
export function expandMatrix({ risks, logics, symbols, tfs }) {
  const cells = [];
  for (const riskId of risks)
    for (const logicType of logics)
      for (const symbol of symbols)
        for (const tf of tfs)
          cells.push({ riskId, logicType, symbol, tf });
  return cells;
}

/** Load a file risk template (templates/risk/<id>.json) into camelCase *Percent settings. */
export function loadRiskProfile(riskId) {
  const p = path.join(process.cwd(), 'templates', 'risk', `${riskId}.json`);
  if (!fs.existsSync(p)) throw new Error(`Risk template not found: ${riskId} (expected ${p})`);
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  return toCamel(raw.content?.settings || raw.settings || raw);
}

const csv = (v, d) => String(v ?? d).split(',').map(s => s.trim()).filter(Boolean);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // CLI flags (camelCase, comma-separated lists):
  //   --risks aggressive,conservative  --logics SMC,breakout
  //   --symbols BTCUSDT,ETHUSDT         --tfs 1H,4H
  //   shared: --leverage --mmr --fundingMode --fundingRate --lookback --from --to --group
  const dims = {
    risks: csv(args.risks, 'aggressive'),
    logics: csv(args.logics, 'SMC'),
    symbols: csv(args.symbols, 'BTCUSDT'),
    tfs: csv(args.tfs, '1H'),
  };
  const leverage = args.leverage != null ? Number(args.leverage) : 1;
  const fundingMode = String(args.fundingMode || 'real-mean');
  const fundingRate = args.fundingRate != null ? Number(args.fundingRate) : 0;
  const lookback = args.lookback != null ? Number(args.lookback) : 250;
  const from = parseDate(args.from, 0);
  const to = parseDate(args.to, Number.MAX_SAFE_INTEGER);
  const group = String(args.group || `m_${Date.now()}`);

  const cells = expandMatrix(dims);
  console.log(`[matrix] group=${group}: ${cells.length} cells (${dims.risks.length}r × ${dims.logics.length}l × ${dims.symbols.length}s × ${dims.tfs.length}tf), leverage ${leverage}`);

  const marketDb = await openMarketDb(path.join(process.cwd(), 'market_data.db'));
  const marketRepo = new MarketDataRepo(marketDb);
  const btDb = await openBacktestDb(path.join(process.cwd(), 'backtest.db'));
  const btRepo = new BacktestRepo(btDb);

  const summaries = [];
  try {
    for (const cell of cells) {
      const candles = await marketRepo.getCandles(cell.symbol, cell.tf, from, to);
      if (candles.length < lookback + 2) {
        console.warn(`[matrix] SKIP ${cell.symbol} ${cell.tf}: ${candles.length} candles (< ${lookback + 2}). Download more first.`);
        continue;
      }
      const spec = await marketRepo.getContractSpec(cell.symbol);
      const settings = loadRiskProfile(cell.riskId);
      const mmr = args.mmr != null ? Number(args.mmr) : (spec && spec.mmr != null ? spec.mmr : null);
      const guardrails = riskProfileToGuardrails(settings, { leverage, mmr });
      const costs = buildCosts(args, spec);

      let realRows = [];
      if (leverage > 1) {
        realRows = await marketRepo.getFunding(cell.symbol, candles[0].time, candles[candles.length - 1].time);
      }

      const label = `${cell.logicType}/${cell.riskId} ${cell.symbol} ${cell.tf}`;
      const { metrics } = await runOne(btRepo, {
        label, logicType: cell.logicType, symbol: cell.symbol, tf: cell.tf,
        lookback, leverage, candles, spec, realRows, guardrails, costs,
        fundingMode, fundingRate, group,
      });
      summaries.push({ ...cell, leverage, metrics });
    }
  } finally {
    await marketDb.close();
    await btDb.close();
  }

  const report = buildReport(summaries);
  console.log(report.table);

  const outDir = path.join(process.cwd(), 'backtest', 'reports');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${group}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ group, generatedAt: Date.now(), dims, leverage, rows: report.rows }, null, 2));
  console.log(`\n[matrix] ${summaries.length}/${cells.length} cells completed. Report: ${outFile}`);
}

// Run only when invoked directly (Windows-safe).
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch(e => { console.error('[run-matrix] FAILED:', e.message); process.exit(1); });
}
```

> Confirm `buildCosts` and `parseDate` are exported from `run-backtest.js` (they are, per current source). If not, export them.

- [ ] **Step 4: Add a `.gitignore` entry for generated reports**

Append to `.gitignore` (if `backtest/reports/` not already ignored):

```
backtest/reports/
```

- [ ] **Step 5: Run the unit test**

Run: `node tests/test_matrix.js`
Expected: PASS — `3 checks passed`.

- [ ] **Step 6: Commit**

```bash
git add backtest/run-matrix.js tests/test_matrix.js .gitignore
git commit -m "feat(backtest): matrix runner CLI (risks × logics × symbols × tfs)"
```

---

## Task 6: Matrix integration test on real data

**Files:**
- Create: `tests/test_matrix_integration.js`

**Context:** Prove the full matrix pipeline against the real `market_data.db` (17576 BTCUSDT 1H candles available): one matrix of ≥2 cells → N persisted runs sharing one group → report with N rows. This is the determinism + integration layer (spec §10). The test drives the exported helpers + `runOne` against the real market repo and an in-memory backtest db, so it neither pollutes `backtest.db` nor depends on CLI argv.

- [ ] **Step 1: Write the integration test**

```js
// tests/test_matrix_integration.js
import assert from 'node:assert';
import path from 'path';
import { openMarketDb } from '../src/data/marketDataSchema.js';
import { MarketDataRepo } from '../src/data/MarketDataRepo.js';
import { openBacktestDb } from '../src/backtest/backtestSchema.js';
import { BacktestRepo } from '../src/backtest/BacktestRepo.js';
import { riskProfileToGuardrails } from '../src/agents/riskProfileToGuardrails.js';
import { runOne, buildCosts } from '../backtest/run-backtest.js';
import { expandMatrix, loadRiskProfile } from '../backtest/run-matrix.js';
import { buildReport } from '../backtest/buildReport.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

const marketDb = await openMarketDb(path.join(process.cwd(), 'market_data.db'));
const marketRepo = new MarketDataRepo(marketDb);
const btDb = await openBacktestDb(':memory:');
const btRepo = new BacktestRepo(btDb);

const lookback = 250;
const group = 'm_integ_test';
// 2 risk profiles × 1 logic × 1 symbol × 1 tf = 2 cells (spot, leverage 1).
const cells = expandMatrix({ risks: ['aggressive', 'conservative'], logics: ['SMC'], symbols: ['BTCUSDT'], tfs: ['1H'] });
assert.strictEqual(cells.length, 2);

const summaries = [];
for (const cell of cells) {
  const candles = await marketRepo.getCandles(cell.symbol, cell.tf, 0, Number.MAX_SAFE_INTEGER);
  assert.ok(candles.length > lookback + 2, `enough candles for ${cell.symbol} ${cell.tf}`);
  const spec = await marketRepo.getContractSpec(cell.symbol);
  const guardrails = riskProfileToGuardrails(loadRiskProfile(cell.riskId), { leverage: 1, mmr: null });
  const costs = buildCosts({}, spec);
  const { runId, metrics } = await runOne(btRepo, {
    label: `${cell.logicType}/${cell.riskId} ${cell.symbol} ${cell.tf}`,
    logicType: cell.logicType, symbol: cell.symbol, tf: cell.tf,
    lookback, leverage: 1, candles, spec, realRows: [], guardrails, costs,
    fundingMode: 'real-mean', fundingRate: 0, group,
  });
  assert.ok(runId > 0);
  assert.strictEqual(metrics.costs.totalFunding, 0, 'spot funding zero');
  summaries.push({ ...cell, leverage: 1, metrics });
}

// 1. all cells persisted under one group
{
  const rows = await btRepo.listRunsByGroup(group);
  assert.strictEqual(rows.length, 2, 'two runs persisted under group');
  assert.ok(rows.every(r => r.run_group === group));
  ok('matrix cells persisted under shared group');
}

// 2. report has one row per cell, sorted by netPnlPct desc
{
  const report = buildReport(summaries);
  assert.strictEqual(report.rows.length, 2);
  assert.ok(report.rows[0].netPnlPct >= report.rows[1].netPnlPct, 'sorted desc');
  assert.ok(report.table.includes('aggressive') && report.table.includes('conservative'));
  ok('report lists both cells, sorted');
}

await marketDb.close();
await btDb.close();
console.log(`\n${passed} checks passed`);
```

- [ ] **Step 2: Run the integration test**

Run: `node tests/test_matrix_integration.js`
Expected: PASS — `2 checks passed`. (If it reports "not enough candles", first run `node backtest/download-data.js --symbol BTCUSDT --tf 1H` to populate `market_data.db`.)

- [ ] **Step 3: Full-suite regression**

Run each, expect all PASS:
```bash
node tests/test_risk_profile_to_guardrails.js
node tests/test_backtest_repo_group.js
node tests/test_run_one.js
node tests/test_build_report.js
node tests/test_matrix.js
node tests/test_matrix_integration.js
node tests/test_backtest_integration.js
node tests/test_futures_integration.js
node tests/test_run_backtest.js
```

- [ ] **Step 4: Real matrix smoke (manual, optional)**

Run: `node backtest/run-matrix.js --risks aggressive,conservative --logics SMC --symbols BTCUSDT --tfs 1H --lookback 250`
Expected: prints `MATRIX COMPARISON` table with 2 rows and writes `backtest/reports/m_<timestamp>.json`.

- [ ] **Step 5: Commit**

```bash
git add tests/test_matrix_integration.js
git commit -m "test(backtest): matrix integration on real data (group + report)"
```

---

## Self-Review (completed during planning)

**Spec coverage (§9 Matrix runs + §10 Phase 5):**
- "sweeps `{logic templates} × {symbols} × {timeframes}`" → Task 5 `expandMatrix` (extended with a risk dimension, which directly serves the user's risk-source correctness goal).
- "N runs → comparison matrix" → Tasks 4 (formatter) + 5 (orchestration) + 6 (integration).
- "equity curve persisted for dashboard charting" → already persisted by `runOne` via `saveEquityCurve` (Task 3); report writes `rows` JSON for the dashboard (Phase 5b consumes it).
- "Touches live? no" → Task 1 adds a NEW pure bridge and does NOT modify `paramResolver.js`; equivalence test locks parity for the deferred Phase 6 unification.
- Costs group (funding, liquidations) surfaced in the report → Task 4 columns.

**Placeholder scan:** none — every code step is complete.

**Type consistency:** `runOne(btRepo, params)` signature and `params` keys (`label, logicType, symbol, tf, lookback, leverage, candles, spec, realRows, guardrails, costs, fundingMode, fundingRate, group, decide`) are identical across Tasks 3, 5, 6. Guardrails key set from Task 1 (`riskPerTrade, stopLossPct, takeProfitPct, maxTradeSizeUSD, maxOpenPositions, maxPortfolioHeatPct, dailyLossLimitPct, dailyProfitTargetPct, maxTradesPerDay, minRiskRewardRatio, portfolioValue, leverage, mmr`) matches what `buildGuardrails` already emits and what `simulate` consumes. `run_group` column name consistent across schema, repo, and tests. `buildReport` input shape `{riskId, logicType, symbol, tf, leverage, metrics}` consistent in Tasks 4/5/6.

**Decider contract:** verified against `src/backtest/simulator.js:124-134` and baked into Task 3 — `decide(ctx, account)` with `ctx = { candles, config, symbol, timeframe }`, returning `{ decision: { decision, order } }`, order filled at next-bar open. No open verification items remain.
