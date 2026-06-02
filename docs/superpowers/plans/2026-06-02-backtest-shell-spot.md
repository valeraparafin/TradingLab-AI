# Backtest Shell (Phase 3, spot) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic spot (leverage = 1) walk-forward backtest shell that drives the existing pure `evaluateBar` pipeline over stored candles, simulates realistic fills/fees/slippage, computes a full metrics set, and persists runs/trades/equity to a dedicated `backtest.db`.

**Architecture:** Pure core / imperative shell. The simulation (`simulate`), execution math (`slip`/`checkExit`), and metrics (`computeMetrics`) are **pure** and unit-tested offline with synthetic candles + an injectable decision function. Storage sits behind a `BacktestRepo` over a separate `backtest.db` (results never mix with the `market_data.db` cache). A thin CLI (`backtest/run-backtest.js`) reads candles via the Phase 2 `MarketDataRepo`, runs the pure engine, and writes results via `BacktestRepo`. Per spec §6, entry is decided on `close[i]` and filled at `open[i+1]` with slippage (no look-ahead); exits are SL→TP, gap-aware. Funding/liquidation are **not** modeled (spot only — they arrive in Phase 4).

**Tech Stack:** Node 18+ ESM, `sqlite`/`sqlite3` (already deps), plain `node:assert` tests run via `node tests/<file>.js`. Reuses `src/core/pipeline.js` (`evaluateBar`), `src/agents/RiskPolicy.js`, `src/data/MarketDataRepo.js`, `src/data/marketParse.js` (`TF_MS`). No new dependencies.

---

## Grounded facts (from the codebase, verified)

- `evaluateBar(ctx, account)` (`src/core/pipeline.js`) is pure: `ctx = {candles, config:{logicType, logic?}, symbol, timeframe}`, `account = {guardrails, portfolio}`. Returns `{signal, decision}`. Internally builds `new IndicatorManager(ctx.config.logic||{}).calculate(ctx.config.logicType, ctx.candles)`, derives a `Signal`, and calls `new RiskPolicy(account.guardrails||{}).evaluate(signal, {...account.portfolio, entryPrice: lastClose})`.
- `RiskPolicy.evaluate(proposal, ctx)` returns `{decision:'PERMIT'|'DENY', reason?, order?}`. On PERMIT, `order = {side, sizeUSD, entryPrice, slPrice, tpPrice}`. HOLD/empty → DENY. `sizeUSD = min(guardrails.portfolioValue * guardrails.riskPerTrade, guardrails.maxTradeSizeUSD ?? Infinity)`. `slPrice`/`tpPrice` are absolute levels off `entryPrice` (= the reference close), mirrored by side.
- `MarketDataRepo.getCandles(symbol, timeframe, from, to)` returns `[{time,open,high,low,close,volume}]` ascending. `getContractSpec(symbol)` returns a row with `taker_fee`/`maker_fee` (or `undefined`).
- `TF_MS` (`src/data/marketParse.js`) maps internal timeframes (`'1m'..'1W'`, uppercase `H/D/W`) → milliseconds.
- The throwaway spike (`spike/backtest.js` on branch `spike/backtest-feasibility`) entered at `close[i]`, no slippage, flat 0.05% fee, SL→TP. Phase 3 uses the **honest** model instead (next-bar-open fill + slippage). "Reproduce the spike's SMC result" is therefore a **qualitative** integration check (same edge direction, same order of magnitude of trades/profit-factor through the real pipeline), not a byte-for-byte match.

## Design decisions (locked)

1. **Honest fill model** (spec §6): decide on `close[i]`, fill at `open[i+1]` with slippage; SL = market (slippage), TP = limit (no slippage); gap-on-open checked on non-entry bars.
2. **Separate `backtest.db`** via a new `BacktestRepo` (mirrors `MarketDataRepo`). `market_data.db` stays a clean append-only market-data cache.
3. **Spot only**: `leverage = 1`, no funding, no liquidation (their costs report as `0` so the metrics shape is already futures-ready for Phase 4). CLI rejects `leverage != 1`.
4. **Fixed-notional sizing** (parity with current `RiskPolicy`): `guardrails.portfolioValue` is constant across the run (compounding sizing is a later refinement).
5. **Exits v1 = SL/TP only.** Close-on-opposite-signal (spec §6 flag) is **deferred** — its absence also matches the spike, keeping the repro clean.
6. **Equity curve = per-bar mark-to-market** at each bar close (open position valued at `close`), giving a proper returns series for Sharpe/Sortino and a chartable curve.

---

## File Structure

- `src/backtest/backtestSchema.js` — **Create.** `openBacktestDb(filename)` → opens SQLite, creates `backtest_runs`/`backtest_trades`/`equity_curve` (+ index).
- `src/backtest/execution.js` — **Create.** Pure: `slip(price, side, bps)`, `checkExit(pos, bar, costs, isEntryBar)`. No I/O.
- `src/backtest/simulator.js` — **Create.** Pure: `simulate(params, decide = evaluateBar)` → `{trades, equityCurve, finalEquity, slippageCost}`. Walk-forward, injectable decision fn.
- `src/backtest/metrics.js` — **Create.** Pure: `computeMetrics({trades, equityCurve, startEquity, slippageCost, timeframe})` → metrics object.
- `src/backtest/BacktestRepo.js` — **Create.** Class over a db handle: save/get runs, trades, equity curve.
- `backtest/run-backtest.js` — **Create.** CLI: `parseArgs` (reused), pure `buildGuardrails`/`buildCosts`, guarded `main()` wiring real `evaluateBar` + `MarketDataRepo` + `BacktestRepo`.
- Tests: `tests/test_backtest_schema.js`, `tests/test_execution.js`, `tests/test_simulator.js`, `tests/test_metrics.js`, `tests/test_backtest_repo.js`, `tests/test_run_backtest.js`.

**Isolation rule:** Do NOT modify `db.js`, `src/agents/**`, `src/core/**`, `src/data/**`, `bot_engine.js`, or any indicator. This layer is purely additive and only *reads* from the existing pure core + Phase 2 repo.

---

## Task 1: backtest.db schema + opener

**Files:**
- Create: `src/backtest/backtestSchema.js`
- Test: `tests/test_backtest_schema.js`

- [ ] **Step 1: Write the failing test**

Create `tests/test_backtest_schema.js`:

```js
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { openBacktestDb } from '../src/backtest/backtestSchema.js';

console.log('Running backtest schema tests...');
const tmp = path.join(os.tmpdir(), `btschema_${Date.now()}.db`);

const run = async () => {
  const db = await openBacktestDb(tmp);
  const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  const names = tables.map(t => t.name);
  assert.ok(names.includes('backtest_runs'), 'backtest_runs table exists');
  assert.ok(names.includes('backtest_trades'), 'backtest_trades table exists');
  assert.ok(names.includes('equity_curve'), 'equity_curve table exists');

  const db2 = await openBacktestDb(tmp); // idempotent
  assert.ok(db2, 'second open succeeds');

  await db.close();
  await db2.close();
  fs.unlinkSync(tmp);
  console.log('✅ backtest schema tests passed');
};

run().catch(e => { console.error('❌', e); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_backtest_schema.js`
Expected: FAIL — cannot find `src/backtest/backtestSchema.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/backtest/backtestSchema.js`:

```js
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

/**
 * Opens (and creates if needed) the dedicated backtest-results SQLite database.
 * Separate from market_data.db so results never mix with the market-data cache.
 * @param {string} filename Path to the .db file.
 * @returns {Promise<import('sqlite').Database>}
 */
export async function openBacktestDb(filename) {
  const db = await open({ filename, driver: sqlite3.Database });
  await db.exec(`
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
      metrics_json   TEXT
    );

    CREATE TABLE IF NOT EXISTS backtest_trades (
      run_id      INTEGER NOT NULL,
      idx         INTEGER NOT NULL,
      side        TEXT    NOT NULL,
      entry_time  INTEGER NOT NULL,
      entry_price REAL    NOT NULL,
      exit_time   INTEGER NOT NULL,
      exit_price  REAL    NOT NULL,
      size_usd    REAL    NOT NULL,
      pnl         REAL    NOT NULL,
      fees        REAL    NOT NULL,
      reason      TEXT    NOT NULL,
      PRIMARY KEY (run_id, idx)
    );

    CREATE TABLE IF NOT EXISTS equity_curve (
      run_id INTEGER NOT NULL,
      time   INTEGER NOT NULL,
      equity REAL    NOT NULL,
      PRIMARY KEY (run_id, time)
    );

    CREATE INDEX IF NOT EXISTS idx_runs_symbol_tf ON backtest_runs (symbol, timeframe);
  `);
  return db;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_backtest_schema.js`
Expected: PASS — `✅ backtest schema tests passed`.

- [ ] **Step 5: Commit**

```bash
git add src/backtest/backtestSchema.js tests/test_backtest_schema.js
git commit -m "feat(backtest): backtest.db schema + opener" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Pure execution math — slippage + exit detection

**Files:**
- Create: `src/backtest/execution.js`
- Test: `tests/test_execution.js`

- [ ] **Step 1: Write the failing test**

Create `tests/test_execution.js`:

```js
import assert from 'assert';
import { slip, checkExit } from '../src/backtest/execution.js';

const tests = [];
const add = (n, fn) => tests.push({ n, fn });
const near = (a, b, t = 1e-9) => Math.abs(a - b) < t;

add('slip worsens fill: BUY pays more, SELL receives less', () => {
  assert.ok(near(slip(100, 'BUY', 5), 100.05));   // +0.05%
  assert.ok(near(slip(100, 'SELL', 5), 99.95));    // -0.05%
  assert.strictEqual(slip(100, 'BUY', 0), 100);    // no slippage
});

add('checkExit BUY intrabar SL (market, slippage) takes priority over TP', () => {
  const pos = { side: 'BUY', slPrice: 90, tpPrice: 110 };
  const bar = { open: 100, high: 111, low: 89 }; // both SL and TP touched -> SL wins
  const ex = checkExit(pos, bar, { slippageBps: 10 }, false);
  assert.strictEqual(ex.reason, 'SL');
  assert.ok(near(ex.idealPrice, 90));
  assert.ok(near(ex.exitPrice, slip(90, 'SELL', 10))); // 89.91
  assert.strictEqual(ex.market, true);
});

add('checkExit BUY intrabar TP (limit, no slippage)', () => {
  const pos = { side: 'BUY', slPrice: 90, tpPrice: 110 };
  const bar = { open: 100, high: 111, low: 95 };
  const ex = checkExit(pos, bar, { slippageBps: 10 }, false);
  assert.strictEqual(ex.reason, 'TP');
  assert.strictEqual(ex.exitPrice, 110);
  assert.strictEqual(ex.market, false);
});

add('checkExit BUY gap-on-open below SL exits at slipped open', () => {
  const pos = { side: 'BUY', slPrice: 90, tpPrice: 110 };
  const bar = { open: 85, high: 88, low: 80 };
  const ex = checkExit(pos, bar, { slippageBps: 10 }, false);
  assert.strictEqual(ex.reason, 'SL_GAP');
  assert.ok(near(ex.idealPrice, 85));
  assert.ok(near(ex.exitPrice, slip(85, 'SELL', 10)));
});

add('checkExit skips gap-on-open on the entry bar', () => {
  const pos = { side: 'BUY', slPrice: 90, tpPrice: 110 };
  const bar = { open: 85, high: 88, low: 86 }; // open below SL, but it is the entry bar
  const ex = checkExit(pos, bar, { slippageBps: 10 }, true);
  // entry bar: no gap check; intrabar low 86 <= 90 -> SL at slPrice 90 (market)
  assert.strictEqual(ex.reason, 'SL');
  assert.ok(near(ex.idealPrice, 90));
});

add('checkExit SELL intrabar SL and TP mirror correctly', () => {
  const pos = { side: 'SELL', slPrice: 110, tpPrice: 90 };
  const slBar = { open: 100, high: 111, low: 99 };
  const slEx = checkExit(pos, slBar, { slippageBps: 10 }, false);
  assert.strictEqual(slEx.reason, 'SL');
  assert.ok(near(slEx.exitPrice, slip(110, 'BUY', 10))); // buy-back slips up
  const tpBar = { open: 100, high: 101, low: 89 };
  const tpEx = checkExit(pos, tpBar, { slippageBps: 10 }, false);
  assert.strictEqual(tpEx.reason, 'TP');
  assert.strictEqual(tpEx.exitPrice, 90);
});

add('checkExit returns null when no level is touched', () => {
  const pos = { side: 'BUY', slPrice: 90, tpPrice: 110 };
  const bar = { open: 100, high: 105, low: 95 };
  assert.strictEqual(checkExit(pos, bar, { slippageBps: 5 }, false), null);
});

let failed = 0;
for (const t of tests) { try { t.fn(); console.log(`✅ ${t.n}`); } catch (e) { failed++; console.error(`❌ ${t.n}\n   ${e.message}`); } }
if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log('\nAll execution tests passed!');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_execution.js`
Expected: FAIL — cannot find `src/backtest/execution.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/backtest/execution.js`:

```js
/**
 * Apply slippage to a MARKET fill. Slippage always worsens the fill for the side
 * that is transacting: a BUY pays more, a SELL receives less.
 * @param {number} price reference price
 * @param {'BUY'|'SELL'} side the side of THIS transaction (for an exit, the opposite of the position)
 * @param {number} bps slippage in basis points (5 = 0.05%)
 * @returns {number}
 */
export function slip(price, side, bps) {
  const f = (bps || 0) / 10000;
  return side === 'BUY' ? price * (1 + f) : price * (1 - f);
}

/**
 * Detect an exit for an open position on a single bar.
 * Priority: gap-on-open (non-entry bars only) → intrabar SL → intrabar TP.
 * SL is a MARKET fill (slippage applied); TP is a LIMIT fill (no slippage, fills at tpPrice).
 * On the entry bar the gap-on-open check is skipped (we already filled at this bar's open).
 *
 * @param {{side:'BUY'|'SELL', slPrice:number|null, tpPrice:number|null}} pos
 * @param {{open:number, high:number, low:number}} bar
 * @param {{slippageBps:number}} costs
 * @param {boolean} isEntryBar
 * @returns {{exitPrice:number, idealPrice:number, reason:'SL'|'TP'|'SL_GAP'|'TP_GAP', market:boolean}|null}
 */
export function checkExit(pos, bar, costs, isEntryBar) {
  const { side, slPrice, tpPrice } = pos;
  const exitSide = side === 'BUY' ? 'SELL' : 'BUY';
  const bps = (costs && costs.slippageBps) || 0;
  const mkt = (ideal, reason) => ({ idealPrice: ideal, exitPrice: slip(ideal, exitSide, bps), reason, market: true });
  const lim = (price, reason) => ({ idealPrice: price, exitPrice: price, reason, market: false });

  // Gap on open (skipped on the entry bar).
  if (!isEntryBar) {
    if (side === 'BUY') {
      if (slPrice != null && bar.open <= slPrice) return mkt(bar.open, 'SL_GAP');
      if (tpPrice != null && bar.open >= tpPrice) return lim(tpPrice, 'TP_GAP');
    } else {
      if (slPrice != null && bar.open >= slPrice) return mkt(bar.open, 'SL_GAP');
      if (tpPrice != null && bar.open <= tpPrice) return lim(tpPrice, 'TP_GAP');
    }
  }

  // Intrabar — SL first (pessimistic), then TP.
  if (side === 'BUY') {
    if (slPrice != null && bar.low <= slPrice) return mkt(slPrice, 'SL');
    if (tpPrice != null && bar.high >= tpPrice) return lim(tpPrice, 'TP');
  } else {
    if (slPrice != null && bar.high >= slPrice) return mkt(slPrice, 'SL');
    if (tpPrice != null && bar.low <= tpPrice) return lim(tpPrice, 'TP');
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_execution.js`
Expected: PASS — `All execution tests passed!`.

- [ ] **Step 5: Commit**

```bash
git add src/backtest/execution.js tests/test_execution.js
git commit -m "feat(backtest): pure slippage + SL/TP exit detection" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Pure walk-forward simulator

**Files:**
- Create: `src/backtest/simulator.js`
- Test: `tests/test_simulator.js`

The simulator is pure and deterministic. The decision function is injectable (`decide`, defaults to the real `evaluateBar`) so the fill/exit/equity logic is tested with a scripted decision sequence on synthetic candles — no real indicators needed.

- [ ] **Step 1: Write the failing test**

Create `tests/test_simulator.js`:

```js
import assert from 'assert';
import { simulate } from '../src/backtest/simulator.js';

const near = (a, b, t = 1e-6) => Math.abs(a - b) < t;
const TF = 3600000;
const c = (i, o, h, l, cl) => ({ time: i * TF, open: o, high: h, low: l, close: cl, volume: 1 });

// A scripted decision fn: PERMIT a BUY on the first flat decision, HOLD afterwards.
function makeDecide(order) {
  let calls = 0;
  return () => {
    calls++;
    if (calls === 1) return { signal: { side: 'BUY', conviction: 1, reason: 't' }, decision: { decision: 'PERMIT', order } };
    return { signal: { side: 'HOLD', conviction: 0, reason: 'h' }, decision: { decision: 'DENY', reason: 'HOLD' } };
  };
}

const tests = [];
const add = (n, fn) => tests.push({ n, fn });

add('BUY filled at next-bar open, exits at TP; pnl & equity correct (no costs)', () => {
  // i:0 warmup; i:1 decide PERMIT (pending); i:2 fill at open; i:3 hits TP.
  const candles = [
    c(0, 100, 100, 100, 100),
    c(1, 100, 101, 99, 100),     // decision bar (flat)
    c(2, 100, 105, 99, 102),     // entry bar: fill at open=100; no SL/TP touched intrabar
    c(3, 102, 112, 101, 108),    // TP 110 hit (high 112)
    c(4, 108, 109, 107, 108),    // flat afterwards
  ];
  const order = { side: 'BUY', sizeUSD: 1000, entryPrice: 100, slPrice: 90, tpPrice: 110 };
  const res = simulate(
    { candles, config: { logicType: 'X' }, guardrails: { portfolioValue: 10000 }, costs: { takerFee: 0, makerFee: 0, slippageBps: 0 }, symbol: 'BTCUSDT', timeframe: '1H', lookback: 1, startEquity: 10000 },
    makeDecide(order)
  );
  assert.strictEqual(res.trades.length, 1, 'one trade');
  const t = res.trades[0];
  assert.strictEqual(t.side, 'BUY');
  assert.strictEqual(t.reason, 'TP');
  assert.ok(near(t.entryPrice, 100), `entry ${t.entryPrice}`);
  assert.ok(near(t.exitPrice, 110), `exit ${t.exitPrice}`);
  assert.ok(near(t.pnl, 100), `pnl ${t.pnl}`);          // 1000 * (110-100)/100 = 100, no fees
  assert.ok(near(res.finalEquity, 10100), `equity ${res.finalEquity}`);
  assert.strictEqual(res.equityCurve.length, 4, 'curve has one point per iterated bar (i=1..4)');
});

add('fees + slippage are applied (BUY -> TP)', () => {
  const candles = [
    c(0, 100, 100, 100, 100),
    c(1, 100, 101, 99, 100),
    c(2, 100, 105, 99, 102),
    c(3, 102, 112, 101, 108),
    c(4, 108, 109, 107, 108),
  ];
  const order = { side: 'BUY', sizeUSD: 1000, entryPrice: 100, slPrice: 90, tpPrice: 110 };
  const res = simulate(
    { candles, config: { logicType: 'X' }, guardrails: { portfolioValue: 10000 }, costs: { takerFee: 0.0006, makerFee: 0.0002, slippageBps: 5 }, symbol: 'BTCUSDT', timeframe: '1H', lookback: 1, startEquity: 10000 },
    makeDecide(order)
  );
  const t = res.trades[0];
  // entry fill = 100 * (1 + 0.0005) = 100.05 ; TP exit = 110 (limit, no slip)
  assert.ok(near(t.entryPrice, 100.05), `entry ${t.entryPrice}`);
  assert.strictEqual(t.exitPrice, 110);
  const ret = (110 - 100.05) / 100.05;
  const fees = 1000 * 0.0006 + 1000 * 0.0002; // entry taker + exit maker
  assert.ok(near(t.fees, fees), `fees ${t.fees}`);
  assert.ok(near(t.pnl, 1000 * ret - fees), `pnl ${t.pnl}`);
  assert.ok(res.slippageCost > 0, 'slippage cost accrued on the market entry');
});

add('SL exit (market) on a BUY', () => {
  const candles = [
    c(0, 100, 100, 100, 100),
    c(1, 100, 101, 99, 100),
    c(2, 100, 102, 99, 101),     // entry at open 100; intrabar low 99 > SL 90 -> no exit
    c(3, 101, 102, 85, 88),      // low 85 <= SL 90 -> SL
    c(4, 88, 89, 87, 88),
  ];
  const order = { side: 'BUY', sizeUSD: 1000, entryPrice: 100, slPrice: 90, tpPrice: 200 };
  const res = simulate(
    { candles, config: { logicType: 'X' }, guardrails: { portfolioValue: 10000 }, costs: { takerFee: 0, makerFee: 0, slippageBps: 0 }, symbol: 'BTCUSDT', timeframe: '1H', lookback: 1, startEquity: 10000 },
    makeDecide(order)
  );
  assert.strictEqual(res.trades[0].reason, 'SL');
  assert.ok(near(res.trades[0].exitPrice, 90));
  assert.ok(near(res.trades[0].pnl, 1000 * (90 - 100) / 100), `pnl ${res.trades[0].pnl}`); // -100
});

add('determinism: same input -> identical output', () => {
  const candles = [c(0,100,100,100,100), c(1,100,101,99,100), c(2,100,105,99,102), c(3,102,112,101,108), c(4,108,109,107,108)];
  const order = { side: 'BUY', sizeUSD: 1000, entryPrice: 100, slPrice: 90, tpPrice: 110 };
  const params = { candles, config: { logicType: 'X' }, guardrails: { portfolioValue: 10000 }, costs: { takerFee: 0.0006, makerFee: 0.0002, slippageBps: 5 }, symbol: 'BTCUSDT', timeframe: '1H', lookback: 1, startEquity: 10000 };
  const a = simulate(params, makeDecide(order));
  const b = simulate(params, makeDecide(order));
  assert.deepStrictEqual(a, b, 'two runs identical');
});

let failed = 0;
for (const t of tests) { try { t.fn(); console.log(`✅ ${t.n}`); } catch (e) { failed++; console.error(`❌ ${t.n}\n   ${e.message}`); } }
if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log('\nAll simulator tests passed!');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_simulator.js`
Expected: FAIL — cannot find `src/backtest/simulator.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/backtest/simulator.js`:

```js
import { evaluateBar } from '../core/pipeline.js';
import { slip, checkExit } from './execution.js';

/**
 * Pure walk-forward backtest over spot (leverage = 1). Deterministic: no I/O, no
 * Date.now(), no randomness. Signal decided on close[i]; entry filled at open[i+1]
 * with slippage; exits per bar via checkExit (SL→TP, gap-aware). No funding/liquidation.
 *
 * @param {object} p
 * @param {import('../core/contracts.js').Candle[]} p.candles ascending by time
 * @param {{logicType:string, logic?:object}} p.config
 * @param {object} p.guardrails RiskPolicy guardrails (portfolioValue drives sizing)
 * @param {{takerFee:number, makerFee:number, slippageBps:number}} p.costs
 * @param {string} p.symbol
 * @param {string} p.timeframe
 * @param {number} [p.lookback=250] rolling window fed to the indicator each bar
 * @param {number} [p.startEquity] defaults to guardrails.portfolioValue
 * @param {(ctx:object, account:object)=>{signal:object, decision:object}} [decide=evaluateBar]
 * @returns {{trades:object[], equityCurve:{time:number,equity:number}[], finalEquity:number, slippageCost:number}}
 */
export function simulate(p, decide = evaluateBar) {
  const { candles, config, guardrails, costs, symbol, timeframe } = p;
  const lookback = p.lookback || 250;
  const startEquity = p.startEquity != null ? p.startEquity : (guardrails.portfolioValue || 0);
  const takerFee = (costs && costs.takerFee) || 0;
  const makerFee = (costs && costs.makerFee) || 0;
  const slippageBps = (costs && costs.slippageBps) || 0;

  let equity = startEquity;
  let position = null;
  let pending = null;
  const trades = [];
  const equityCurve = [];
  let slippageCost = 0;

  const n = candles.length;
  const start = Math.min(lookback, n);

  const unreal = (pos, price) => {
    const r = pos.side === 'BUY' ? (price - pos.entryPrice) / pos.entryPrice
                                 : (pos.entryPrice - price) / pos.entryPrice;
    return pos.sizeUSD * r;
  };

  for (let i = start; i < n; i++) {
    const bar = candles[i];

    // 1) Fill a pending entry at THIS bar's open (next-bar-open execution).
    if (pending && !position) {
      const entryFill = slip(bar.open, pending.side, slippageBps);
      slippageCost += pending.sizeUSD * Math.abs(entryFill - bar.open) / bar.open;
      position = {
        side: pending.side, entryIndex: i, entryTime: bar.time,
        entryPrice: entryFill, slPrice: pending.slPrice, tpPrice: pending.tpPrice,
        sizeUSD: pending.sizeUSD, entryFee: pending.sizeUSD * takerFee,
      };
      pending = null;
    }

    // 2) Manage exit for an open position (entry bar may exit intrabar).
    if (position) {
      const ex = checkExit(position, bar, { slippageBps }, position.entryIndex === i);
      if (ex) {
        const exitFee = position.sizeUSD * (ex.market ? takerFee : makerFee);
        if (ex.market) slippageCost += position.sizeUSD * Math.abs(ex.exitPrice - ex.idealPrice) / ex.idealPrice;
        const ret = position.side === 'BUY'
          ? (ex.exitPrice - position.entryPrice) / position.entryPrice
          : (position.entryPrice - ex.exitPrice) / position.entryPrice;
        const fees = position.entryFee + exitFee;
        const pnl = position.sizeUSD * ret - fees;
        equity += pnl;
        trades.push({
          side: position.side, entryTime: position.entryTime, entryPrice: position.entryPrice,
          exitTime: bar.time, exitPrice: ex.exitPrice, sizeUSD: position.sizeUSD,
          pnl, fees, reason: ex.reason,
        });
        position = null;
      }
    }

    // 3) If flat, decide for a next-bar entry (uses only data up to close[i]).
    if (!position && !pending && i + 1 < n) {
      const window = candles.slice(Math.max(0, i - lookback + 1), i + 1);
      const ctx = { candles: window, config, symbol, timeframe };
      const account = { guardrails, portfolio: { openPositions: 0, portfolioHeatPct: 0, dailyPnlPct: 0, tradesToday: 0 } };
      const { decision } = decide(ctx, account);
      if (decision && decision.decision === 'PERMIT' && decision.order) {
        const o = decision.order;
        pending = { side: o.side, slPrice: o.slPrice, tpPrice: o.tpPrice, sizeUSD: o.sizeUSD };
      }
    }

    // 4) Mark-to-market equity at bar close.
    equityCurve.push({ time: bar.time, equity: equity + (position ? unreal(position, bar.close) : 0) });
  }

  return { trades, equityCurve, finalEquity: equity, slippageCost };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_simulator.js`
Expected: PASS — `All simulator tests passed!`.

- [ ] **Step 5: Commit**

```bash
git add src/backtest/simulator.js tests/test_simulator.js
git commit -m "feat(backtest): pure walk-forward simulator (next-bar-open fills)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Pure metrics

**Files:**
- Create: `src/backtest/metrics.js`
- Test: `tests/test_metrics.js`

- [ ] **Step 1: Write the failing test**

Create `tests/test_metrics.js`:

```js
import assert from 'assert';
import { computeMetrics } from '../src/backtest/metrics.js';

const near = (a, b, t = 1e-6) => Math.abs(a - b) < t;
const TF = 3600000;

const tests = [];
const add = (n, fn) => tests.push({ n, fn });

add('trade stats: win rate, profit factor, expectancy, breakdown', () => {
  const trades = [
    { side: 'BUY',  pnl: 100, fees: 1, entryTime: 0,      exitTime: 2 * TF, reason: 'TP' },
    { side: 'BUY',  pnl: -50, fees: 1, entryTime: 3 * TF, exitTime: 4 * TF, reason: 'SL' },
    { side: 'SELL', pnl: 30,  fees: 1, entryTime: 5 * TF, exitTime: 6 * TF, reason: 'TP' },
  ];
  const equityCurve = [
    { time: 0,      equity: 10000 },
    { time: 1 * TF, equity: 10100 },
    { time: 2 * TF, equity: 9900 },
    { time: 3 * TF, equity: 10200 },
  ];
  const m = computeMetrics({ trades, equityCurve, startEquity: 10000, slippageCost: 4, timeframe: '1H' });

  assert.strictEqual(m.trades.count, 3);
  assert.ok(near(m.trades.winRate, 2 / 3), `winRate ${m.trades.winRate}`);
  assert.ok(near(m.trades.profitFactor, 130 / 50), `pf ${m.trades.profitFactor}`); // (100+30)/50 = 2.6
  assert.ok(near(m.trades.expectancy, (100 - 50 + 30) / 3), `exp ${m.trades.expectancy}`);
  assert.ok(near(m.trades.avgWin, 130 / 2), `avgWin ${m.trades.avgWin}`);
  assert.ok(near(m.trades.avgLoss, -50), `avgLoss ${m.trades.avgLoss}`);
  assert.strictEqual(m.breakdown.long.count, 2);
  assert.strictEqual(m.breakdown.short.count, 1);
  assert.ok(near(m.breakdown.short.netPnl, 30));
});

add('return + drawdown from equity curve', () => {
  const equityCurve = [
    { time: 0,      equity: 10000 },
    { time: 1 * TF, equity: 10100 },
    { time: 2 * TF, equity: 9900 },  // drawdown from peak 10100
    { time: 3 * TF, equity: 10200 },
  ];
  const m = computeMetrics({ trades: [], equityCurve, startEquity: 10000, slippageCost: 0, timeframe: '1H' });
  assert.ok(near(m.return.netPnl, 200), `netPnl ${m.return.netPnl}`);
  assert.ok(near(m.return.netPnlPct, 0.02), `netPnlPct ${m.return.netPnlPct}`);
  assert.ok(near(m.return.finalEquity, 10200));
  // max drawdown = (10100 - 9900)/10100
  assert.ok(near(m.risk.maxDrawdownPct, (10100 - 9900) / 10100), `maxDD ${m.risk.maxDrawdownPct}`);
  assert.ok(m.risk.maxDrawdownDurationMs >= TF, `ddDur ${m.risk.maxDrawdownDurationMs}`);
});

add('costs group present (funding/liquidation zero for spot)', () => {
  const m = computeMetrics({ trades: [{ side: 'BUY', pnl: 10, fees: 2, entryTime: 0, exitTime: TF, reason: 'TP' }], equityCurve: [{ time: 0, equity: 10000 }, { time: TF, equity: 10010 }], startEquity: 10000, slippageCost: 1.5, timeframe: '1H' });
  assert.ok(near(m.costs.totalFees, 2));
  assert.strictEqual(m.costs.totalFunding, 0);
  assert.strictEqual(m.costs.liquidationCount, 0);
  assert.ok(near(m.costs.slippageCost, 1.5));
});

add('empty run does not throw and yields zeros', () => {
  const m = computeMetrics({ trades: [], equityCurve: [], startEquity: 10000, slippageCost: 0, timeframe: '1H' });
  assert.strictEqual(m.trades.count, 0);
  assert.strictEqual(m.trades.profitFactor, 0);
  assert.strictEqual(m.return.netPnl, 0);
  assert.strictEqual(m.risk.maxDrawdownPct, 0);
});

let failed = 0;
for (const t of tests) { try { t.fn(); console.log(`✅ ${t.n}`); } catch (e) { failed++; console.error(`❌ ${t.n}\n   ${e.message}`); } }
if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log('\nAll metrics tests passed!');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_metrics.js`
Expected: FAIL — cannot find `src/backtest/metrics.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/backtest/metrics.js`:

```js
import { TF_MS } from '../data/marketParse.js';

const YEAR_MS = 365.25 * 86400000;

/** Per-side trade aggregates. */
function sideStats(trades) {
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const netPnl = trades.reduce((s, t) => s + t.pnl, 0);
  return {
    count: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0),
    netPnl,
    avgWin: wins.length ? grossProfit / wins.length : 0,
    avgLoss: losses.length ? -grossLoss / losses.length : 0,
    expectancy: trades.length ? netPnl / trades.length : 0,
  };
}

/**
 * Compute the full per-run metrics set from trades + per-bar equity curve. Pure.
 * Funding/liquidation report as 0 (spot); the shape is already futures-ready.
 *
 * @param {object} p
 * @param {object[]} p.trades
 * @param {{time:number,equity:number}[]} p.equityCurve
 * @param {number} p.startEquity
 * @param {number} [p.slippageCost=0]
 * @param {string} p.timeframe
 * @returns {object}
 */
export function computeMetrics({ trades, equityCurve, startEquity, slippageCost = 0, timeframe }) {
  const finalEquity = equityCurve.length ? equityCurve[equityCurve.length - 1].equity : startEquity;
  const netPnl = finalEquity - startEquity;
  const netPnlPct = startEquity ? netPnl / startEquity : 0;

  const spanMs = equityCurve.length >= 2 ? equityCurve[equityCurve.length - 1].time - equityCurve[0].time : 0;
  const years = spanMs / YEAR_MS;
  const cagr = years > 0 && startEquity > 0 ? Math.pow(finalEquity / startEquity, 1 / years) - 1 : 0;

  // Drawdown + longest underwater stretch.
  let peak = -Infinity, peakTime = null, maxDrawdownPct = 0, maxDrawdownDurationMs = 0;
  for (const pt of equityCurve) {
    if (pt.equity >= peak) { peak = pt.equity; peakTime = pt.time; }
    else {
      const dd = peak > 0 ? (peak - pt.equity) / peak : 0;
      if (dd > maxDrawdownPct) maxDrawdownPct = dd;
      const dur = pt.time - peakTime;
      if (dur > maxDrawdownDurationMs) maxDrawdownDurationMs = dur;
    }
  }

  // Bar returns → Sharpe / Sortino (annualized by timeframe).
  const rets = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].equity, cur = equityCurve[i].equity;
    rets.push(prev !== 0 ? (cur - prev) / prev : 0);
  }
  const mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
  const variance = rets.length ? rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length : 0;
  const std = Math.sqrt(variance);
  const downside = rets.filter(r => r < 0);
  const dStd = Math.sqrt(downside.length ? downside.reduce((a, b) => a + b * b, 0) / downside.length : 0);
  const ppy = TF_MS[timeframe] ? YEAR_MS / TF_MS[timeframe] : 0;
  const ann = Math.sqrt(ppy);
  const sharpe = std > 0 ? (mean / std) * ann : 0;
  const sortino = dStd > 0 ? (mean / dStd) * ann : 0;
  const calmar = maxDrawdownPct > 0 ? cagr / maxDrawdownPct : 0;

  const all = sideStats(trades);
  const totalFees = trades.reduce((s, t) => s + (t.fees || 0), 0);
  const inPosMs = trades.reduce((s, t) => s + (t.exitTime - t.entryTime), 0);
  const avgHoldMs = trades.length ? inPosMs / trades.length : 0;
  const exposurePct = spanMs > 0 ? inPosMs / spanMs : 0;

  return {
    return: { netPnl, netPnlPct, finalEquity, cagr },
    risk: { maxDrawdownPct, maxDrawdownDurationMs, sharpe, sortino, calmar },
    trades: {
      count: all.count, wins: all.wins, losses: all.losses,
      winRate: all.winRate, profitFactor: all.profitFactor, expectancy: all.expectancy,
      avgWin: all.avgWin, avgLoss: all.avgLoss, avgHoldMs, exposurePct,
    },
    costs: { totalFees, totalFunding: 0, liquidationCount: 0, slippageCost },
    breakdown: {
      long: sideStats(trades.filter(t => t.side === 'BUY')),
      short: sideStats(trades.filter(t => t.side === 'SELL')),
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_metrics.js`
Expected: PASS — `All metrics tests passed!`.

- [ ] **Step 5: Commit**

```bash
git add src/backtest/metrics.js tests/test_metrics.js
git commit -m "feat(backtest): pure per-run metrics (return/risk/trades/costs/breakdown)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: BacktestRepo — persist runs / trades / equity

**Files:**
- Create: `src/backtest/BacktestRepo.js`
- Test: `tests/test_backtest_repo.js`

- [ ] **Step 1: Write the failing test**

Create `tests/test_backtest_repo.js`:

```js
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { openBacktestDb } from '../src/backtest/backtestSchema.js';
import { BacktestRepo } from '../src/backtest/BacktestRepo.js';

const tmp = path.join(os.tmpdir(), `btrepo_${Date.now()}.db`);

const run = async () => {
  const db = await openBacktestDb(tmp);
  const repo = new BacktestRepo(db);

  const runId = await repo.saveRun({
    strategyLabel: 'SMC scalp', logicType: 'SMC', symbol: 'BTCUSDT', timeframe: '1H',
    periodFrom: 1000, periodTo: 5000, leverage: 1,
    params: { lookback: 250 }, costs: { takerFee: 0.0006 }, metrics: { return: { netPnl: 123 } },
  });
  assert.ok(Number.isInteger(runId) && runId > 0, `runId ${runId}`);

  const nt = await repo.saveTrades(runId, [
    { side: 'BUY', entryTime: 1000, entryPrice: 100, exitTime: 2000, exitPrice: 110, sizeUSD: 1000, pnl: 100, fees: 1, reason: 'TP' },
    { side: 'SELL', entryTime: 3000, entryPrice: 120, exitTime: 4000, exitPrice: 115, sizeUSD: 1000, pnl: 41, fees: 1, reason: 'TP' },
  ]);
  assert.strictEqual(nt, 2, 'saved 2 trades');

  const ne = await repo.saveEquityCurve(runId, [{ time: 1000, equity: 10000 }, { time: 2000, equity: 10100 }]);
  assert.strictEqual(ne, 2, 'saved 2 equity points');

  const got = await repo.getRun(runId);
  assert.strictEqual(got.symbol, 'BTCUSDT');
  assert.strictEqual(JSON.parse(got.metrics_json).return.netPnl, 123);

  const trades = await repo.getTrades(runId);
  assert.strictEqual(trades.length, 2);
  assert.strictEqual(trades[0].reason, 'TP');
  assert.strictEqual(trades[0].idx, 0);

  const curve = await repo.getEquityCurve(runId);
  assert.strictEqual(curve.length, 2);
  assert.strictEqual(curve[1].equity, 10100);

  const list = await repo.listRuns();
  assert.ok(list.length >= 1);

  await db.close();
  fs.unlinkSync(tmp);
  console.log('✅ backtest repo tests passed');
};

run().catch(e => { console.error('❌', e); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_backtest_repo.js`
Expected: FAIL — cannot find `src/backtest/BacktestRepo.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/backtest/BacktestRepo.js`:

```js
/**
 * Repository over the backtest-results SQLite db. The only place that knows SQL for
 * backtest runs / trades / equity curves — the storage backend is swappable behind it.
 */
export class BacktestRepo {
  constructor(db) {
    this.db = db;
  }

  /** Insert a run (metadata + JSON params/costs/metrics). Returns the new run id. */
  async saveRun(run) {
    const r = await this.db.run(
      `INSERT INTO backtest_runs
         (strategy_label, logic_type, symbol, timeframe, period_from, period_to, leverage, params_json, costs_json, metrics_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [run.strategyLabel, run.logicType, run.symbol, run.timeframe, run.periodFrom, run.periodTo, run.leverage,
       JSON.stringify(run.params || {}), JSON.stringify(run.costs || {}), JSON.stringify(run.metrics || {})]
    );
    return r.lastID;
  }

  /** Insert trades for a run (indexed by position in the array). Returns rows inserted. */
  async saveTrades(runId, trades) {
    if (!trades.length) return 0;
    let inserted = 0;
    await this.db.run('BEGIN');
    let stmt;
    try {
      stmt = await this.db.prepare(
        `INSERT OR REPLACE INTO backtest_trades
           (run_id, idx, side, entry_time, entry_price, exit_time, exit_price, size_usd, pnl, fees, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (let i = 0; i < trades.length; i++) {
        const t = trades[i];
        const res = await stmt.run(runId, i, t.side, t.entryTime, t.entryPrice, t.exitTime, t.exitPrice, t.sizeUSD, t.pnl, t.fees, t.reason);
        inserted += res.changes || 0;
      }
      await stmt.finalize();
      await this.db.run('COMMIT');
    } catch (e) {
      if (stmt) { try { await stmt.finalize(); } catch (_) {} }
      await this.db.run('ROLLBACK');
      throw e;
    }
    return inserted;
  }

  /** Insert per-bar equity points for a run. Returns rows inserted. */
  async saveEquityCurve(runId, curve) {
    if (!curve.length) return 0;
    let inserted = 0;
    await this.db.run('BEGIN');
    let stmt;
    try {
      stmt = await this.db.prepare('INSERT OR REPLACE INTO equity_curve (run_id, time, equity) VALUES (?, ?, ?)');
      for (const pt of curve) {
        const res = await stmt.run(runId, pt.time, pt.equity);
        inserted += res.changes || 0;
      }
      await stmt.finalize();
      await this.db.run('COMMIT');
    } catch (e) {
      if (stmt) { try { await stmt.finalize(); } catch (_) {} }
      await this.db.run('ROLLBACK');
      throw e;
    }
    return inserted;
  }

  /** A run row by id, or undefined. */
  async getRun(id) {
    return this.db.get('SELECT * FROM backtest_runs WHERE id = ?', [id]);
  }

  /** Trades for a run, ascending by idx. */
  async getTrades(runId) {
    return this.db.all('SELECT * FROM backtest_trades WHERE run_id = ? ORDER BY idx ASC', [runId]);
  }

  /** Equity curve for a run, ascending by time. */
  async getEquityCurve(runId) {
    return this.db.all('SELECT time, equity FROM equity_curve WHERE run_id = ? ORDER BY time ASC', [runId]);
  }

  /** All runs, most recent first. */
  async listRuns() {
    return this.db.all('SELECT * FROM backtest_runs ORDER BY id DESC');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_backtest_repo.js`
Expected: PASS — `✅ backtest repo tests passed`.

- [ ] **Step 5: Commit**

```bash
git add src/backtest/BacktestRepo.js tests/test_backtest_repo.js
git commit -m "feat(backtest): BacktestRepo run/trade/equity persistence" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: CLI runner — `run-backtest.js`

**Files:**
- Create: `backtest/run-backtest.js`
- Test: `tests/test_run_backtest.js`

The CLI's pure, testable seams are `buildGuardrails(args)` and `buildCosts(args, spec)`; `parseArgs` is reused from `backtest/download-data.js`. `main()` does the I/O (read candles via `MarketDataRepo`, run `simulate`, `computeMetrics`, persist via `BacktestRepo`) and runs only on direct invocation.

- [ ] **Step 1: Write the failing test**

Create `tests/test_run_backtest.js`:

```js
import assert from 'assert';
import { buildGuardrails, buildCosts } from '../backtest/run-backtest.js';

const tests = [];
const add = (n, fn) => tests.push({ n, fn });
const near = (a, b, t = 1e-9) => Math.abs(a - b) < t;

add('buildGuardrails: defaults', () => {
  const g = buildGuardrails({});
  assert.strictEqual(g.portfolioValue, 10000);
  assert.ok(near(g.riskPerTrade, 0.1));
  assert.ok(near(g.stopLossPct, 0.02));
  assert.ok(near(g.takeProfitPct, 0.04));
  assert.strictEqual(g.maxOpenPositions, 1);
});

add('buildGuardrails: overrides from args', () => {
  const g = buildGuardrails({ equity: '5000', riskPerTrade: '0.2', sl: '0.01', tp: '0.03', maxOpen: '2' });
  assert.strictEqual(g.portfolioValue, 5000);
  assert.ok(near(g.riskPerTrade, 0.2));
  assert.ok(near(g.stopLossPct, 0.01));
  assert.ok(near(g.takeProfitPct, 0.03));
  assert.strictEqual(g.maxOpenPositions, 2);
});

add('buildCosts: defaults when no spec', () => {
  const c = buildCosts({});
  assert.ok(near(c.takerFee, 0.0006));
  assert.ok(near(c.makerFee, 0.0002));
  assert.strictEqual(c.slippageBps, 5);
});

add('buildCosts: falls back to stored contract spec fees', () => {
  const c = buildCosts({}, { taker_fee: 0.001, maker_fee: 0.0004 });
  assert.ok(near(c.takerFee, 0.001));
  assert.ok(near(c.makerFee, 0.0004));
});

add('buildCosts: explicit args override spec', () => {
  const c = buildCosts({ takerFee: '0.002', slippageBps: '10' }, { taker_fee: 0.001 });
  assert.ok(near(c.takerFee, 0.002));
  assert.strictEqual(c.slippageBps, 10);
});

let failed = 0;
for (const t of tests) { try { t.fn(); console.log(`✅ ${t.n}`); } catch (e) { failed++; console.error(`❌ ${t.n}\n   ${e.message}`); } }
if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log('\nAll run-backtest tests passed!');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_run_backtest.js`
Expected: FAIL — cannot find `backtest/run-backtest.js`.

- [ ] **Step 3: Write minimal implementation**

Create `backtest/run-backtest.js`:

```js
import path from 'path';
import { fileURLToPath } from 'url';
import { openMarketDb } from '../src/data/marketDataSchema.js';
import { MarketDataRepo } from '../src/data/MarketDataRepo.js';
import { openBacktestDb } from '../src/backtest/backtestSchema.js';
import { BacktestRepo } from '../src/backtest/BacktestRepo.js';
import { simulate } from '../src/backtest/simulator.js';
import { computeMetrics } from '../src/backtest/metrics.js';
import { parseArgs } from './download-data.js';

/** Build RiskPolicy guardrails from CLI args (fixed-notional sizing; spot defaults). */
export function buildGuardrails(args) {
  const num = (v, d) => (v != null ? Number(v) : d);
  return {
    portfolioValue: num(args.equity, 10000),
    riskPerTrade: num(args.riskPerTrade, 0.1),
    maxTradeSizeUSD: args.maxTradeSizeUSD != null ? Number(args.maxTradeSizeUSD) : Infinity,
    stopLossPct: num(args.sl, 0.02),
    takeProfitPct: num(args.tp, 0.04),
    minRiskRewardRatio: num(args.minRR, 1.5),
    maxOpenPositions: num(args.maxOpen, 1),
    maxPortfolioHeatPct: num(args.maxHeat, 100),
    dailyLossLimitPct: num(args.dailyLoss, 1),
    dailyProfitTargetPct: null,
    maxTradesPerDay: num(args.maxTrades, 999999),
  };
}

/** Build cost config from CLI args, falling back to the stored contract spec, then constants. */
export function buildCosts(args, spec = null) {
  return {
    takerFee: args.takerFee != null ? Number(args.takerFee) : (spec && spec.taker_fee != null ? spec.taker_fee : 0.0006),
    makerFee: args.makerFee != null ? Number(args.makerFee) : (spec && spec.maker_fee != null ? spec.maker_fee : 0.0002),
    slippageBps: args.slippageBps != null ? Number(args.slippageBps) : 5,
  };
}

function fmtPct(x) { return (x * 100).toFixed(2) + '%'; }

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const symbol = String(args.symbol || 'BTCUSDT');
  const tf = String(args.tf || '1H');
  const logicType = String(args.logic || 'SMC');
  const leverage = args.leverage != null ? Number(args.leverage) : 1;
  if (leverage !== 1) throw new Error('Phase 3 supports spot only (leverage = 1). Futures arrive in Phase 4.');
  const lookback = args.lookback != null ? Number(args.lookback) : 250;
  const from = args.from ? Date.parse(args.from) : 0;
  const to = args.to ? Date.parse(args.to) : Number.MAX_SAFE_INTEGER;
  const label = String(args.label || `${logicType} ${symbol} ${tf}`);

  const marketDb = await openMarketDb(path.join(process.cwd(), 'market_data.db'));
  const marketRepo = new MarketDataRepo(marketDb);
  const candles = await marketRepo.getCandles(symbol, tf, from, to);
  const spec = await marketRepo.getContractSpec(symbol);
  await marketDb.close();

  if (candles.length < lookback + 2) {
    throw new Error(`Not enough candles for ${symbol} ${tf}: ${candles.length} (need > ${lookback + 1}). Download more via backtest/download-data.js.`);
  }

  const guardrails = buildGuardrails(args);
  const costs = buildCosts(args, spec);
  const config = { logicType, logic: {} };

  console.log(`[backtest] ${label}: ${candles.length} candles, lookback ${lookback}, leverage 1 (spot)`);
  const sim = simulate({ candles, config, guardrails, costs, symbol, timeframe: tf, lookback, startEquity: guardrails.portfolioValue });
  const metrics = computeMetrics({ trades: sim.trades, equityCurve: sim.equityCurve, startEquity: guardrails.portfolioValue, slippageCost: sim.slippageCost, timeframe: tf });

  const btDb = await openBacktestDb(path.join(process.cwd(), 'backtest.db'));
  const btRepo = new BacktestRepo(btDb);
  const runId = await btRepo.saveRun({
    strategyLabel: label, logicType, symbol, timeframe: tf,
    periodFrom: candles[0].time, periodTo: candles[candles.length - 1].time,
    leverage, params: { lookback, guardrails }, costs, metrics,
  });
  await btRepo.saveTrades(runId, sim.trades);
  await btRepo.saveEquityCurve(runId, sim.equityCurve);
  await btDb.close();

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
  console.log(`Costs         : fees ${m.costs.totalFees.toFixed(2)}, slippage ${m.costs.slippageCost.toFixed(2)}`);
  console.log(`Long / Short  : ${m.breakdown.long.count} / ${m.breakdown.short.count}`);
  console.log('═════════════════════════════════════');
}

// Run only when invoked directly (Windows-safe).
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch(e => { console.error('[run-backtest] FAILED:', e.message); process.exit(1); });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_run_backtest.js`
Expected: PASS — `All run-backtest tests passed!`.

- [ ] **Step 5: Run the full Phase 3 offline test suite**

Run: `node tests/test_backtest_schema.js && node tests/test_execution.js && node tests/test_simulator.js && node tests/test_metrics.js && node tests/test_backtest_repo.js && node tests/test_run_backtest.js`
Expected: all six print their pass lines, exit 0.

- [ ] **Step 6: Commit**

```bash
git add backtest/run-backtest.js tests/test_run_backtest.js
git commit -m "feat(backtest): spot backtest CLI runner + pure guardrails/costs builders" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Real-pipeline integration test (offline, no network)

Confirms the simulator wires correctly to the **real** `evaluateBar` (real `IndicatorManager` + `SignalAdapter` + `RiskPolicy`) on a deterministic synthetic candle series — proving the pure core drives the shell — and re-confirms determinism end-to-end.

**Files:**
- Create: `tests/test_backtest_integration.js`

- [ ] **Step 1: Write the test**

Create `tests/test_backtest_integration.js`:

```js
import assert from 'assert';
import { simulate } from '../src/backtest/simulator.js';
import { computeMetrics } from '../src/backtest/metrics.js';

// Deterministic synthetic series: a rising leg then a falling leg, enough bars for SMC's
// pivot window. We assert the pipeline RUNS and is deterministic + that metrics are
// well-formed — NOT a specific trade count (real indicators on synthetic data are not
// a numeric contract; the spike repro in Task 8 is the qualitative numeric check).
const TF = 3600000;
function synth() {
  const out = [];
  let price = 100;
  for (let i = 0; i < 400; i++) {
    // up for 200 bars, down for 200 bars, with small deterministic wiggle
    const drift = i < 200 ? 0.4 : -0.4;
    const wiggle = ((i * 7919) % 13 - 6) / 10; // deterministic pseudo-noise in [-0.6,0.6]
    const open = price;
    const close = price + drift + wiggle;
    const high = Math.max(open, close) + 0.8;
    const low = Math.min(open, close) - 0.8;
    out.push({ time: i * TF, open, high, low, close, volume: 100 });
    price = close;
  }
  return out;
}

const run = () => {
  const candles = synth();
  const params = {
    candles,
    config: { logicType: 'SMC', logic: { indicators: { pivot_length: 20 } } },
    guardrails: { portfolioValue: 10000, riskPerTrade: 0.1, maxTradeSizeUSD: Infinity, stopLossPct: 0.02, takeProfitPct: 0.04, minRiskRewardRatio: 1.5, maxOpenPositions: 1, maxPortfolioHeatPct: 100, dailyLossLimitPct: 1, dailyProfitTargetPct: null, maxTradesPerDay: 999999 },
    costs: { takerFee: 0.0006, makerFee: 0.0002, slippageBps: 5 },
    symbol: 'BTCUSDT', timeframe: '1H', lookback: 100, startEquity: 10000,
  };

  // 1) Runs end-to-end through the REAL evaluateBar (default decide) without throwing.
  const a = simulate(params);
  assert.ok(Array.isArray(a.trades), 'trades is an array');
  assert.strictEqual(a.equityCurve.length, candles.length - 100, 'one equity point per iterated bar');
  assert.ok(Number.isFinite(a.finalEquity), 'finalEquity finite');

  // 2) Deterministic: a second identical run yields identical output.
  const b = simulate(params);
  assert.deepStrictEqual(a, b, 'real-pipeline run is deterministic');

  // 3) Metrics are well-formed.
  const m = computeMetrics({ trades: a.trades, equityCurve: a.equityCurve, startEquity: 10000, slippageCost: a.slippageCost, timeframe: '1H' });
  assert.ok(Number.isFinite(m.return.netPnl), 'netPnl finite');
  assert.ok(m.risk.maxDrawdownPct >= 0, 'maxDD non-negative');
  assert.strictEqual(m.costs.totalFunding, 0, 'spot: no funding');
  assert.strictEqual(m.trades.count, a.trades.length, 'metrics trade count matches');

  console.log(`✅ backtest integration tests passed (real pipeline produced ${a.trades.length} trades, finalEquity ${a.finalEquity.toFixed(2)})`);
};

try { run(); } catch (e) { console.error('❌', e); process.exit(1); }
```

- [ ] **Step 2: Run the test**

Run: `node tests/test_backtest_integration.js`
Expected: PASS — `✅ backtest integration tests passed (...)`.

> If `IndicatorManager.calculate('SMC', window)` throws on the synthetic series (e.g. needs a different `logic` shape), inspect `src/indicators/index.js` for the exact expected `logic` config and adjust ONLY the `config.logic` object in this test to match (do not change production code). Report this as DONE_WITH_CONCERNS noting the adjustment.

- [ ] **Step 3: Commit**

```bash
git add tests/test_backtest_integration.js
git commit -m "test(backtest): real-pipeline integration + determinism (offline synthetic)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Reproduce-the-spike smoke test (manual integration — real data)

Manual qualitative check that the real pipeline produces a sane SMC result on deep history. NOT a committed test.

> **Backfill note:** `downloadCandles` resumes *forward* from the last stored candle, so it will not backfill history earlier than what `market_data.db` already holds. To get deep history, download into a **fresh** db: rename or delete the existing `market_data.db` first (it is gitignored, regenerable cache), then pull from an early date.

- [ ] **Step 1: Get deep history into a fresh market_data.db**

```bash
# back up / clear the existing 30-day cache, then pull ~1.5y of BTCUSDT 1H
node -e "const fs=require('fs'); if(fs.existsSync('market_data.db')) fs.renameSync('market_data.db','market_data.db.bak')"
node backtest/download-data.js --symbol BTCUSDT --tf 1H --from 2024-06-01
```
Expected: `+N candles` with N in the thousands; `+M funding rows`; a spec line.

- [ ] **Step 2: Run the backtest through the real pipeline**

Run: `node backtest/run-backtest.js --symbol BTCUSDT --tf 1H --logic SMC --lookback 250 --label "SMC spike repro"`
Expected: a `BACKTEST RESULT` block with a non-zero trade count and a plausible profit factor / win rate. Compare *qualitatively* to the spike's ballpark (same edge direction; trades in the same order of magnitude). Exact numbers differ by design (next-bar-open fill + slippage + fees vs the spike's same-bar-close, no-slippage model).

- [ ] **Step 3: Confirm persistence**

Run: `node -e "import('./src/backtest/backtestSchema.js').then(async m=>{const db=await m.openBacktestDb('backtest.db');const r=await db.all('SELECT id,strategy_label,symbol,timeframe FROM backtest_runs ORDER BY id DESC LIMIT 3');console.log(r);const c=await db.all('SELECT COUNT(*) n FROM equity_curve');console.log('equity points',c);await db.close();})"`
Expected: the run row(s) present; equity_curve populated.

- [ ] **Step 4: Confirm backtest.db is git-ignored**

`backtest.db` is generated. Confirm `git check-ignore backtest.db` matches `*.db` (Phase 2 already added that pattern). If somehow not ignored, add it:

```bash
echo "backtest.db" >> .gitignore && git add .gitignore && git commit -m "chore: ignore generated backtest.db" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 5: Restore the cache (optional)**

```bash
# if you want the original 30-day cache back:
node -e "const fs=require('fs'); if(fs.existsSync('market_data.db.bak')) { fs.rmSync('market_data.db'); fs.renameSync('market_data.db.bak','market_data.db'); }"
```

---

## Done criteria

- `src/backtest/{backtestSchema,execution,simulator,metrics,BacktestRepo}.js` + `backtest/run-backtest.js` exist.
- The simulator drives the real `evaluateBar` pipeline, fills at next-bar-open with slippage, exits SL→TP (gap-aware), and is deterministic.
- Metrics cover return / risk / trades / costs / long-short breakdown; runs/trades/equity persist in a dedicated `backtest.db` behind `BacktestRepo`.
- All six offline test files pass; the integration test confirms real-pipeline wiring + determinism; the manual smoke test reproduces a sane SMC result on deep history.
- No live trading code, `db.js`, `src/core/**`, `src/data/**`, or indicators were modified.

## Next plan (not in this one)

- **Phase 4 — Futures:** `RiskPolicy` leverage path (margin gate, margin-based heat, SL-inside-liquidation gate) + shell margin/funding (8h, from `funding_rates`)/liquidation (isolated, single-tier MMR from `contract_specs`); scenario tests. The metrics `costs.totalFunding`/`liquidationCount` placeholders become live.
- **Phase 5 — Runner + reporting:** `logic × symbol × tf` matrix → N runs → comparison matrix; equity curves + dashboard-readable results; risk-template integration (`config_resolver`).

## Non-goals (Phase 3)

Funding; liquidation; leverage > 1; close-on-opposite-signal exit; compounding/SL-distance sizing; cross-margin; DCA; risk-template wiring; dashboard UI. All are explicitly later phases per spec §10/§12.
