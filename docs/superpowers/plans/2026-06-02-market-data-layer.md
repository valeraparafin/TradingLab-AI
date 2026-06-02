# Market Data Layer (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an isolated market-data layer — a dedicated `market_data.db` (SQLite) with candles / funding / contract specs, a `MarketDataRepo` behind which the storage backend is swappable, pure response parsers, and an incremental idempotent `download-data` CLI with a `--verify` integrity check.

**Architecture:** Everything lives in a new `src/data/` module + a `backtest/` CLI, fully additive — it does NOT touch `db.js` or any live trading path. **Mixed data sources (per spec §8 amendment): OHLC candles come from Binance spot klines; funding rates and contract specs come from BitGet public endpoints.** Pure parsers and pagination/gap logic are unit-tested offline; network fetching is isolated behind a thin, injectable `fetchImpl` so the download loop is testable without the network. A separate manual smoke task confirms the real endpoints.

**Tech Stack:** Node 18+ ESM, global `fetch` (no new deps), `sqlite`/`sqlite3` (already project deps), plain `node:assert` tests run via `node tests/<file>.js`. Binance v3 public klines + BitGet v2 public market-data endpoints (no auth).

---

## Grounded API facts

### Binance — candles (verified by the working spike + existing `ToolRegistry.get_candles`)
- `GET https://api.binance.com/api/v3/klines?symbol=<S>&interval=<I>&limit=<N>&startTime=<ms>` (also `endTime`). `limit` max **1000**.
- `interval` strings: `1m,5m,15m,30m,1h,4h,1d,1w` (**all lowercase** — note `1h`/`1d`, unlike BitGet).
- Response is a **bare JSON array** of arrays (NOT wrapped in `{code,data}`). Each: `[openTime, open, high, low, close, volume, closeTime, quoteAssetVolume, trades, ...]` — open/high/low/close/volume are **strings**, `openTime` a number (ms). Returned **ascending** by openTime.
- Error response is an object `{code:<negative>, msg:"..."}` instead of an array.

### BitGet — funding + contract specs (verified empirically against the live public API)
- **Funding:** `GET https://api.bitget.com/api/v2/mix/market/history-fund-rate?symbol=<S>&productType=USDT-FUTURES&pageSize=<N>&pageNo=<P>`. Wrapped `{code:"00000", data:[{symbol, fundingRate, fundingTime}]}` (strings; `fundingTime` ms).
- **Contracts:** `GET https://api.bitget.com/api/v2/mix/market/contracts?productType=USDT-FUTURES&symbol=<S>`. `data[0]` includes (strings): `takerFeeRate` ("0.0006"), `makerFeeRate` ("0.0002"), `maxLever` ("150"), `minLever`, `fundInterval` ("8" hours), `pricePlace`, `volumePlace`, `sizeMultiplier`, `minTradeNum`, `minTradeUSDT`, `priceEndStep`. **No maintenance-margin-rate field** → `mmr` is a configurable default (the spec's single-tier MMR approximation), not from the API.
- BitGet wraps as `{code:"00000", msg, data}`; `code !== "00000"` is an error.

### Internal timeframe convention
We store the timeframe in the project's existing form (`1m,5m,15m,30m,1H,4H,1D,1W` — uppercase H/D/W, matching `ai_strategies.timeframe` and `ToolRegistry`'s `intervalMap`). The Binance URL builder maps it to Binance's lowercase `interval`.

Timeframe→milliseconds (pagination + gap detection):
`{ '1m':60000, '5m':300000, '15m':900000, '30m':1800000, '1H':3600000, '4H':14400000, '1D':86400000, '1W':604800000 }`

---

## File Structure

- `src/data/marketDataSchema.js` — **Create.** `openMarketDb(filename)` → opens SQLite, creates `candles`/`funding_rates`/`contract_specs` + indexes. (Source-agnostic.)
- `src/data/marketParse.js` — **Create.** Pure: `TF_MS`, `BINANCE_INTERVAL`, `parseCandle` (Binance), `candlesUrl` (Binance), `parseFunding`/`parseContract`/`fundingUrl`/`contractsUrl` (BitGet). No I/O.
- `src/data/MarketDataRepo.js` — **Create.** Class over a db handle: candles upsert/get/lastTime/gaps + funding upsert/get + contract-spec upsert/get. (Source-agnostic.)
- `src/data/marketDataFetch.js` — **Create.** Thin network wrappers with injectable `fetchImpl`: `fetchCandlesPage` (Binance), `fetchFundingPage`/`fetchContract` (BitGet), and `downloadCandles` (incremental Binance loop).
- `backtest/download-data.js` — **Create.** CLI: parse args, open db, download candles (Binance) + funding/specs (BitGet), `--verify`.
- Tests: `tests/test_market_schema.js`, `tests/test_market_parse.js`, `tests/test_market_repo.js`, `tests/test_download_loop.js`, `tests/test_verify.js`.

**Isolation rule:** Do NOT modify `db.js`, `src/agents/**`, `src/core/**`, `bot_engine.js`, or any indicator. This layer is purely additive.

---

## Task 1: market_data.db schema + opener

**Files:**
- Create: `src/data/marketDataSchema.js`
- Test: `tests/test_market_schema.js`

- [ ] **Step 1: Write the failing test**

Create `tests/test_market_schema.js`:

```js
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { openMarketDb } from '../src/data/marketDataSchema.js';

console.log('Running market schema tests...');

const tmp = path.join(os.tmpdir(), `mdtest_${Date.now()}.db`);

const run = async () => {
  const db = await openMarketDb(tmp);
  const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  const names = tables.map(t => t.name);
  assert.ok(names.includes('candles'), 'candles table exists');
  assert.ok(names.includes('funding_rates'), 'funding_rates table exists');
  assert.ok(names.includes('contract_specs'), 'contract_specs table exists');

  const db2 = await openMarketDb(tmp); // idempotent: second open must not throw
  assert.ok(db2, 'second open succeeds');

  await db.close();
  await db2.close();
  fs.unlinkSync(tmp);
  console.log('✅ market schema tests passed');
};

run().catch(e => { console.error('❌', e); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_market_schema.js`
Expected: FAIL — cannot find `src/data/marketDataSchema.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/data/marketDataSchema.js`:

```js
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

/**
 * Opens (and creates if needed) the dedicated market-data SQLite database.
 * Separate from trading_lab.db / ai_trading.db so bulk append-only market data
 * never bloats the operational databases.
 * @param {string} filename Absolute path to the .db file.
 * @returns {Promise<import('sqlite').Database>}
 */
export async function openMarketDb(filename) {
  const db = await open({ filename, driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS candles (
      symbol     TEXT    NOT NULL,
      timeframe  TEXT    NOT NULL,
      time       INTEGER NOT NULL,
      open       REAL    NOT NULL,
      high       REAL    NOT NULL,
      low        REAL    NOT NULL,
      close      REAL    NOT NULL,
      volume     REAL    NOT NULL,
      PRIMARY KEY (symbol, timeframe, time)
    );

    CREATE TABLE IF NOT EXISTS funding_rates (
      symbol TEXT    NOT NULL,
      time   INTEGER NOT NULL,
      rate   REAL    NOT NULL,
      PRIMARY KEY (symbol, time)
    );

    CREATE TABLE IF NOT EXISTS contract_specs (
      symbol           TEXT PRIMARY KEY,
      mmr              REAL,
      max_leverage     INTEGER,
      min_leverage     INTEGER,
      taker_fee        REAL,
      maker_fee        REAL,
      fund_interval_h  INTEGER,
      tick_size        REAL,
      qty_step         REAL,
      price_precision  INTEGER,
      qty_precision    INTEGER,
      min_trade_num    REAL,
      min_trade_usdt   REAL,
      updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_candles_symbol_tf_time ON candles (symbol, timeframe, time);
  `);
  return db;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_market_schema.js`
Expected: PASS — `✅ market schema tests passed`.

- [ ] **Step 5: Commit**

```bash
git add src/data/marketDataSchema.js tests/test_market_schema.js
git commit -m "feat(data): market_data.db schema + opener"
```

---

## Task 2: Pure parsers + URL builders (Binance candles + BitGet funding/specs)

**Files:**
- Create: `src/data/marketParse.js`
- Test: `tests/test_market_parse.js`

- [ ] **Step 1: Write the failing test**

Create `tests/test_market_parse.js` (candle fixture = real Binance kline shape; funding/contract fixtures = real BitGet shapes):

```js
import assert from 'assert';
import { TF_MS, BINANCE_INTERVAL, parseCandle, candlesUrl, parseFunding, parseContract, fundingUrl, contractsUrl } from '../src/data/marketParse.js';

const tests = [];
const add = (n, fn) => tests.push({ n, fn });

add('TF_MS maps known timeframes', () => {
  assert.strictEqual(TF_MS['1H'], 3600000);
  assert.strictEqual(TF_MS['1m'], 60000);
  assert.strictEqual(TF_MS['1D'], 86400000);
});

add('BINANCE_INTERVAL maps internal tf → binance interval (lowercase)', () => {
  assert.strictEqual(BINANCE_INTERVAL['1H'], '1h');
  assert.strictEqual(BINANCE_INTERVAL['4H'], '4h');
  assert.strictEqual(BINANCE_INTERVAL['1D'], '1d');
  assert.strictEqual(BINANCE_INTERVAL['5m'], '5m');
});

add('parseCandle: Binance kline array → numeric Candle (volume = idx5)', () => {
  const k = ['1499040000000', '0.01634790', '0.80000000', '0.01575800', '0.01577100', '148976.11427815', '1499644799999', '2434.19', 308];
  const c = parseCandle(k);
  assert.deepStrictEqual(c, { time: 1499040000000, open: 0.0163479, high: 0.8, low: 0.015758, close: 0.015771, volume: 148976.11427815 });
});

add('candlesUrl builds Binance klines query (interval mapped to lowercase)', () => {
  const u = candlesUrl({ symbol: 'BTCUSDT', timeframe: '1H', limit: 1000, startTime: 123 });
  assert.ok(u.startsWith('https://api.binance.com/api/v3/klines?'), u);
  assert.ok(u.includes('symbol=BTCUSDT'));
  assert.ok(u.includes('interval=1h'));
  assert.ok(u.includes('limit=1000'));
  assert.ok(u.includes('startTime=123'));
});

add('parseFunding: BitGet object → {time, rate}', () => {
  const f = parseFunding({ symbol: 'BTCUSDT', fundingRate: '0.0001', fundingTime: '1780387200000' });
  assert.deepStrictEqual(f, { time: 1780387200000, rate: 0.0001 });
});

add('parseContract: BitGet object + mmr default → spec row', () => {
  const raw = { symbol: 'BTCUSDT', takerFeeRate: '0.0006', makerFeeRate: '0.0002', maxLever: '150', minLever: '1', fundInterval: '8', pricePlace: '1', volumePlace: '4', sizeMultiplier: '0.0001', minTradeNum: '0.0001', minTradeUSDT: '5', priceEndStep: '1' };
  const s = parseContract(raw, 0.005);
  assert.strictEqual(s.symbol, 'BTCUSDT');
  assert.strictEqual(s.mmr, 0.005);
  assert.strictEqual(s.max_leverage, 150);
  assert.strictEqual(s.taker_fee, 0.0006);
  assert.strictEqual(s.maker_fee, 0.0002);
  assert.strictEqual(s.fund_interval_h, 8);
  assert.strictEqual(s.price_precision, 1);
  assert.strictEqual(s.qty_precision, 4);
  assert.strictEqual(s.min_trade_num, 0.0001);
  assert.strictEqual(s.min_trade_usdt, 5);
  assert.ok(Math.abs(s.tick_size - 0.1) < 1e-12, `tick ${s.tick_size}`); // priceEndStep * 10^-pricePlace = 1 * 10^-1
  assert.strictEqual(s.qty_step, 0.0001);
});

add('fundingUrl + contractsUrl build expected BitGet paths', () => {
  assert.ok(fundingUrl({ symbol: 'BTCUSDT', pageSize: 100, pageNo: 1 }).includes('/api/v2/mix/market/history-fund-rate?'));
  assert.ok(contractsUrl({ symbol: 'BTCUSDT' }).includes('/api/v2/mix/market/contracts?'));
});

let failed = 0;
for (const t of tests) { try { t.fn(); console.log(`✅ ${t.n}`); } catch (e) { failed++; console.error(`❌ ${t.n}\n   ${e.message}`); } }
if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log('\nAll marketParse tests passed!');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_market_parse.js`
Expected: FAIL — cannot find `src/data/marketParse.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/data/marketParse.js`:

```js
const BINANCE_BASE = 'https://api.binance.com';
const BITGET_BASE = 'https://api.bitget.com';
const PRODUCT = 'USDT-FUTURES';

/** Internal timeframe → milliseconds. */
export const TF_MS = Object.freeze({
  '1m': 60000, '5m': 300000, '15m': 900000, '30m': 1800000,
  '1H': 3600000, '4H': 14400000, '1D': 86400000, '1W': 604800000,
});

/** Internal timeframe → Binance `interval` string (Binance is lowercase). */
export const BINANCE_INTERVAL = Object.freeze({
  '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m',
  '1H': '1h', '4H': '4h', '1D': '1d', '1W': '1w',
});

// ---- Binance candles ----

/** Binance kline array [openTime,o,h,l,c,volume,closeTime,...] → numeric Candle. */
export function parseCandle(arr) {
  return {
    time: Number(arr[0]),
    open: Number(arr[1]),
    high: Number(arr[2]),
    low: Number(arr[3]),
    close: Number(arr[4]),
    volume: Number(arr[5]),
  };
}

export function candlesUrl({ symbol, timeframe, limit = 1000, startTime, endTime }) {
  const interval = BINANCE_INTERVAL[timeframe];
  if (!interval) throw new Error(`Unknown timeframe: ${timeframe}`);
  const p = new URLSearchParams({ symbol, interval, limit: String(limit) });
  if (startTime != null) p.set('startTime', String(startTime));
  if (endTime != null) p.set('endTime', String(endTime));
  return `${BINANCE_BASE}/api/v3/klines?${p.toString()}`;
}

// ---- BitGet funding + contracts ----

/** BitGet funding row {fundingTime, fundingRate} → {time, rate}. */
export function parseFunding(obj) {
  return { time: Number(obj.fundingTime), rate: Number(obj.fundingRate) };
}

/**
 * BitGet contract object → contract_specs row. `mmr` is injected (not in the API).
 * tick_size = priceEndStep * 10^-pricePlace.
 */
export function parseContract(obj, mmr) {
  const pricePlace = Number(obj.pricePlace);
  return {
    symbol: obj.symbol,
    mmr,
    max_leverage: Number(obj.maxLever),
    min_leverage: Number(obj.minLever),
    taker_fee: Number(obj.takerFeeRate),
    maker_fee: Number(obj.makerFeeRate),
    fund_interval_h: Number(obj.fundInterval),
    tick_size: Number(obj.priceEndStep) * Math.pow(10, -pricePlace),
    qty_step: Number(obj.sizeMultiplier),
    price_precision: pricePlace,
    qty_precision: Number(obj.volumePlace),
    min_trade_num: Number(obj.minTradeNum),
    min_trade_usdt: Number(obj.minTradeUSDT),
  };
}

export function fundingUrl({ symbol, pageSize = 100, pageNo = 1 }) {
  const p = new URLSearchParams({ symbol, productType: PRODUCT, pageSize: String(pageSize), pageNo: String(pageNo) });
  return `${BITGET_BASE}/api/v2/mix/market/history-fund-rate?${p.toString()}`;
}

export function contractsUrl({ symbol }) {
  const p = new URLSearchParams({ symbol, productType: PRODUCT });
  return `${BITGET_BASE}/api/v2/mix/market/contracts?${p.toString()}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_market_parse.js`
Expected: PASS — `All marketParse tests passed!`.

- [ ] **Step 5: Commit**

```bash
git add src/data/marketParse.js tests/test_market_parse.js
git commit -m "feat(data): pure parsers + URL builders (Binance candles, BitGet funding/specs)"
```

---

## Task 3: MarketDataRepo — candles (upsert / get / lastTime / gaps)

**Files:**
- Create: `src/data/MarketDataRepo.js`
- Test: `tests/test_market_repo.js`

- [ ] **Step 1: Write the failing test**

Create `tests/test_market_repo.js`:

```js
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { openMarketDb } from '../src/data/marketDataSchema.js';
import { MarketDataRepo } from '../src/data/MarketDataRepo.js';

const tmp = path.join(os.tmpdir(), `mdrepo_${Date.now()}.db`);

const run = async () => {
  const db = await openMarketDb(tmp);
  const repo = new MarketDataRepo(db);
  const c = (time, close) => ({ time, open: close, high: close, low: close, close, volume: 1 });

  const n1 = await repo.upsertCandles('BTCUSDT', '1H', [c(1000, 10), c(2000, 11), c(3000, 12)]);
  assert.strictEqual(n1, 3, 'inserted 3');
  const n2 = await repo.upsertCandles('BTCUSDT', '1H', [c(2000, 11), c(3000, 12)]);
  assert.strictEqual(n2, 0, 're-inserting duplicates inserts 0');

  const got = await repo.getCandles('BTCUSDT', '1H', 1000, 3000);
  assert.strictEqual(got.length, 3);
  assert.strictEqual(got[0].time, 1000);
  assert.strictEqual(got[2].close, 12);

  assert.strictEqual(await repo.lastCandleTime('BTCUSDT', '1H'), 3000);
  assert.strictEqual(await repo.lastCandleTime('ETHUSDT', '1H'), null);

  // gap: missing 5000 between 4000 and 6000 (step 1000); 3000->4000 contiguous
  await repo.upsertCandles('BTCUSDT', '1H', [c(4000, 13), c(6000, 15)]);
  const gaps = await repo.findGaps('BTCUSDT', '1H', 1000);
  assert.deepStrictEqual(gaps, [5000], `gaps ${JSON.stringify(gaps)}`);

  await db.close();
  fs.unlinkSync(tmp);
  console.log('✅ market repo (candles) tests passed');
};

run().catch(e => { console.error('❌', e); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_market_repo.js`
Expected: FAIL — cannot find `src/data/MarketDataRepo.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/data/MarketDataRepo.js`:

```js
/**
 * Repository over the market-data SQLite db. The ONLY place that knows SQL for
 * candles / funding / contract specs — the storage backend is swappable behind it.
 */
export class MarketDataRepo {
  constructor(db) {
    this.db = db;
  }

  /**
   * Idempotently insert candles (INSERT OR IGNORE on PK). Returns rows actually inserted.
   * @returns {Promise<number>}
   */
  async upsertCandles(symbol, timeframe, candles) {
    if (!candles.length) return 0;
    let inserted = 0;
    await this.db.run('BEGIN');
    try {
      const stmt = await this.db.prepare(
        `INSERT OR IGNORE INTO candles (symbol, timeframe, time, open, high, low, close, volume)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const k of candles) {
        const r = await stmt.run(symbol, timeframe, k.time, k.open, k.high, k.low, k.close, k.volume);
        inserted += r.changes || 0;
      }
      await stmt.finalize();
      await this.db.run('COMMIT');
    } catch (e) {
      await this.db.run('ROLLBACK');
      throw e;
    }
    return inserted;
  }

  /** Candles in [from, to] inclusive, ascending by time. */
  async getCandles(symbol, timeframe, from, to) {
    return this.db.all(
      `SELECT time, open, high, low, close, volume FROM candles
       WHERE symbol = ? AND timeframe = ? AND time >= ? AND time <= ?
       ORDER BY time ASC`,
      [symbol, timeframe, from, to]
    );
  }

  /** Latest stored candle time, or null. */
  async lastCandleTime(symbol, timeframe) {
    const row = await this.db.get(
      'SELECT MAX(time) AS t FROM candles WHERE symbol = ? AND timeframe = ?',
      [symbol, timeframe]
    );
    return row && row.t != null ? row.t : null;
  }

  /** Missing candle timestamps between the first and last stored candle (step = tfMs). */
  async findGaps(symbol, timeframe, tfMs) {
    const rows = await this.db.all(
      'SELECT time FROM candles WHERE symbol = ? AND timeframe = ? ORDER BY time ASC',
      [symbol, timeframe]
    );
    if (rows.length < 2) return [];
    const present = new Set(rows.map(r => r.time));
    const gaps = [];
    for (let t = rows[0].time + tfMs; t < rows[rows.length - 1].time; t += tfMs) {
      if (!present.has(t)) gaps.push(t);
    }
    return gaps;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_market_repo.js`
Expected: PASS — `✅ market repo (candles) tests passed`.

- [ ] **Step 5: Commit**

```bash
git add src/data/MarketDataRepo.js tests/test_market_repo.js
git commit -m "feat(data): MarketDataRepo candle storage + gap detection"
```

---

## Task 4: MarketDataRepo — funding + contract specs

**Files:**
- Modify: `src/data/MarketDataRepo.js`
- Modify: `tests/test_market_repo.js`

- [ ] **Step 1: Write the failing test**

In `tests/test_market_repo.js`, insert these assertions immediately BEFORE the line `await db.close();`:

```js
  // ---- funding ----
  const fn1 = await repo.upsertFunding('BTCUSDT', [{ time: 8000, rate: 0.0001 }, { time: 16000, rate: -0.0002 }]);
  assert.strictEqual(fn1, 2, 'inserted 2 funding rows');
  const fn2 = await repo.upsertFunding('BTCUSDT', [{ time: 16000, rate: -0.0002 }]);
  assert.strictEqual(fn2, 0, 'duplicate funding inserts 0');
  const fund = await repo.getFunding('BTCUSDT', 0, 20000);
  assert.strictEqual(fund.length, 2);
  assert.strictEqual(fund[0].time, 8000);
  assert.ok(Math.abs(fund[1].rate - -0.0002) < 1e-12);

  // ---- contract specs ----
  await repo.upsertContractSpec({ symbol: 'BTCUSDT', mmr: 0.005, max_leverage: 150, min_leverage: 1, taker_fee: 0.0006, maker_fee: 0.0002, fund_interval_h: 8, tick_size: 0.1, qty_step: 0.0001, price_precision: 1, qty_precision: 4, min_trade_num: 0.0001, min_trade_usdt: 5 });
  const spec = await repo.getContractSpec('BTCUSDT');
  assert.strictEqual(spec.max_leverage, 150);
  assert.strictEqual(spec.taker_fee, 0.0006);
  assert.strictEqual(spec.mmr, 0.005);
  await repo.upsertContractSpec({ symbol: 'BTCUSDT', mmr: 0.01, max_leverage: 125, min_leverage: 1, taker_fee: 0.0006, maker_fee: 0.0002, fund_interval_h: 8, tick_size: 0.1, qty_step: 0.0001, price_precision: 1, qty_precision: 4, min_trade_num: 0.0001, min_trade_usdt: 5 });
  const spec2 = await repo.getContractSpec('BTCUSDT');
  assert.strictEqual(spec2.max_leverage, 125, 'spec overwritten (INSERT OR REPLACE)');
  assert.strictEqual(await repo.getContractSpec('NOPEUSDT'), undefined);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_market_repo.js`
Expected: FAIL — `repo.upsertFunding is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/data/MarketDataRepo.js`, add these methods inside the class (after `findGaps`):

```js
  /** Idempotently insert funding rows [{time, rate}]. Returns rows inserted. */
  async upsertFunding(symbol, rows) {
    if (!rows.length) return 0;
    let inserted = 0;
    await this.db.run('BEGIN');
    try {
      const stmt = await this.db.prepare(
        'INSERT OR IGNORE INTO funding_rates (symbol, time, rate) VALUES (?, ?, ?)'
      );
      for (const r of rows) {
        const res = await stmt.run(symbol, r.time, r.rate);
        inserted += res.changes || 0;
      }
      await stmt.finalize();
      await this.db.run('COMMIT');
    } catch (e) {
      await this.db.run('ROLLBACK');
      throw e;
    }
    return inserted;
  }

  /** Funding rows in [from, to] inclusive, ascending by time. */
  async getFunding(symbol, from, to) {
    return this.db.all(
      'SELECT time, rate FROM funding_rates WHERE symbol = ? AND time >= ? AND time <= ? ORDER BY time ASC',
      [symbol, from, to]
    );
  }

  /** Insert/replace a contract spec row (object shaped like parseContract output). */
  async upsertContractSpec(s) {
    await this.db.run(
      `INSERT OR REPLACE INTO contract_specs
         (symbol, mmr, max_leverage, min_leverage, taker_fee, maker_fee, fund_interval_h,
          tick_size, qty_step, price_precision, qty_precision, min_trade_num, min_trade_usdt, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [s.symbol, s.mmr, s.max_leverage, s.min_leverage, s.taker_fee, s.maker_fee, s.fund_interval_h,
       s.tick_size, s.qty_step, s.price_precision, s.qty_precision, s.min_trade_num, s.min_trade_usdt]
    );
  }

  /** Contract spec row for a symbol, or undefined. */
  async getContractSpec(symbol) {
    return this.db.get('SELECT * FROM contract_specs WHERE symbol = ?', [symbol]);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_market_repo.js`
Expected: PASS — `✅ market repo (candles) tests passed` (now also covering funding + specs).

- [ ] **Step 5: Commit**

```bash
git add src/data/MarketDataRepo.js tests/test_market_repo.js
git commit -m "feat(data): MarketDataRepo funding + contract spec storage"
```

---

## Task 5: Fetch wrappers + incremental Binance candle download loop

The candle download loop is **idempotent**: it forward-paginates Binance (ascending) from the last stored candle, upserts (duplicates ignored), advances by the max timestamp seen, and stops on no forward progress or past `to`. `fetchImpl` is injectable so the loop is unit-tested with fixture pages (no network).

**Files:**
- Create: `src/data/marketDataFetch.js`
- Test: `tests/test_download_loop.js`

- [ ] **Step 1: Write the failing test**

Create `tests/test_download_loop.js`:

```js
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { openMarketDb } from '../src/data/marketDataSchema.js';
import { MarketDataRepo } from '../src/data/MarketDataRepo.js';
import { downloadCandles } from '../src/data/marketDataFetch.js';

const tmp = path.join(os.tmpdir(), `mddl_${Date.now()}.db`);

// Fake Binance: bare array of klines from startTime, 2 per page, up to a ceiling.
function makeFakeFetch(maxTime) {
  const TF = 3600000;
  return async (url) => {
    const u = new URL(url);
    const start = Number(u.searchParams.get('startTime'));
    const out = [];
    for (let t = start; t < start + TF * 2 && t <= maxTime; t += TF) {
      out.push([t, '10', '11', '9', '10.5', '100', t + TF - 1, '1000', 5]); // Binance kline shape
    }
    return { ok: true, json: async () => out }; // Binance returns a bare array
  };
}

const run = async () => {
  const db = await openMarketDb(tmp);
  const repo = new MarketDataRepo(db);
  const TF = 3600000;
  const from = 1000000 * TF;
  const maxTime = from + TF * 5; // 6 candles available

  const inserted = await downloadCandles(repo, { symbol: 'BTCUSDT', timeframe: '1H', from, to: maxTime, pageLimit: 2 }, makeFakeFetch(maxTime));
  assert.strictEqual(inserted, 6, `inserted ${inserted}`);

  const again = await downloadCandles(repo, { symbol: 'BTCUSDT', timeframe: '1H', from, to: maxTime, pageLimit: 2 }, makeFakeFetch(maxTime));
  assert.strictEqual(again, 0, 'idempotent re-run inserts 0');

  const stored = await repo.getCandles('BTCUSDT', '1H', from, maxTime);
  assert.strictEqual(stored.length, 6);
  assert.strictEqual(stored[0].time, from);
  assert.strictEqual(stored[5].time, from + TF * 5);

  await db.close();
  fs.unlinkSync(tmp);
  console.log('✅ download loop tests passed');
};

run().catch(e => { console.error('❌', e); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_download_loop.js`
Expected: FAIL — cannot find `src/data/marketDataFetch.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/data/marketDataFetch.js`:

```js
import { TF_MS, parseCandle, candlesUrl, parseFunding, parseContract, fundingUrl, contractsUrl } from './marketParse.js';

/** Internal: GET a BitGet public endpoint and return parsed `data` (throws on API error). */
async function getBitget(url, fetchImpl) {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`BitGet HTTP ${res.status}`);
  const json = await res.json();
  if (json.code !== '00000') throw new Error(`BitGet API ${json.code}: ${json.msg}`);
  return json.data || [];
}

/** Fetch one page of Binance candles from `startTime`. Returns parsed Candle[] (ascending). */
export async function fetchCandlesPage({ symbol, timeframe, startTime, limit = 1000 }, fetchImpl = fetch) {
  const res = await fetchImpl(candlesUrl({ symbol, timeframe, startTime, limit }));
  if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json)) throw new Error(`Binance error: ${json.msg || JSON.stringify(json)}`);
  return json.map(parseCandle).sort((a, b) => a.time - b.time);
}

/** Fetch one page of BitGet funding rows. Returns parsed [{time, rate}] (ascending). */
export async function fetchFundingPage({ symbol, pageSize = 100, pageNo = 1 }, fetchImpl = fetch) {
  const data = await getBitget(fundingUrl({ symbol, pageSize, pageNo }), fetchImpl);
  return data.map(parseFunding).sort((a, b) => a.time - b.time);
}

/** Fetch a single BitGet contract spec (mmr injected — not provided by the API). */
export async function fetchContract({ symbol, mmr }, fetchImpl = fetch) {
  const data = await getBitget(contractsUrl({ symbol }), fetchImpl);
  if (!data.length) throw new Error(`No contract for ${symbol}`);
  return parseContract(data[0], mmr);
}

/**
 * Incrementally download Binance candles into the repo. Idempotent: resumes from the
 * last stored candle, forward-paginates (Binance returns ascending), advances by the
 * max timestamp seen, and stops on no forward progress or past `to`.
 * @returns {Promise<number>} total NEW rows inserted.
 */
export async function downloadCandles(repo, { symbol, timeframe, from, to = Date.now(), pageLimit = 1000 }, fetchImpl = fetch) {
  const tfMs = TF_MS[timeframe];
  if (!tfMs) throw new Error(`Unknown timeframe: ${timeframe}`);

  const last = await repo.lastCandleTime(symbol, timeframe);
  let cursor = last != null ? Math.max(from, last + tfMs) : from;
  let total = 0;

  while (cursor <= to) {
    const page = await fetchCandlesPage({ symbol, timeframe, startTime: cursor, limit: pageLimit }, fetchImpl);
    if (!page.length) break;
    const inRange = page.filter(c => c.time >= from && c.time <= to);
    total += await repo.upsertCandles(symbol, timeframe, inRange);
    const maxTs = page[page.length - 1].time;
    const next = maxTs + tfMs;
    if (next <= cursor) break; // no forward progress → stop
    cursor = next;
  }
  return total;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_download_loop.js`
Expected: PASS — `✅ download loop tests passed`.

- [ ] **Step 5: Commit**

```bash
git add src/data/marketDataFetch.js tests/test_download_loop.js
git commit -m "feat(data): fetch wrappers + idempotent Binance candle download loop"
```

---

## Task 6: Downloader CLI + `--verify`

**Files:**
- Create: `backtest/download-data.js`
- Test: `tests/test_verify.js`

- [ ] **Step 1: Write the failing test**

Create `tests/test_verify.js`:

```js
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { openMarketDb } from '../src/data/marketDataSchema.js';
import { MarketDataRepo } from '../src/data/MarketDataRepo.js';
import { verifyCandles, parseArgs } from '../backtest/download-data.js';

const tmp = path.join(os.tmpdir(), `mdverify_${Date.now()}.db`);

const run = async () => {
  // parseArgs is pure — test it directly.
  const a = parseArgs(['--symbol', 'BTCUSDT,ETHUSDT', '--tf', '1H', '--verify']);
  assert.strictEqual(a.symbol, 'BTCUSDT,ETHUSDT');
  assert.strictEqual(a.tf, '1H');
  assert.strictEqual(a.verify, true);

  const db = await openMarketDb(tmp);
  const repo = new MarketDataRepo(db);
  const TF = 3600000;
  const c = (t, close) => ({ time: t, open: close, high: close, low: close, close, volume: 1 });

  await repo.upsertCandles('BTCUSDT', '1H', [c(TF, 10), c(2 * TF, 11), c(3 * TF, 12)]);
  let report = await verifyCandles(repo, 'BTCUSDT', '1H');
  assert.strictEqual(report.gaps.length, 0, 'no gaps');
  assert.strictEqual(report.bad.length, 0, 'no bad candles');
  assert.strictEqual(report.count, 3);

  // add a gap (missing 5*TF) and a bad candle (zero price)
  await repo.upsertCandles('BTCUSDT', '1H', [c(4 * TF, 13), c(6 * TF, 0)]);
  report = await verifyCandles(repo, 'BTCUSDT', '1H');
  assert.deepStrictEqual(report.gaps, [5 * TF], `gaps ${JSON.stringify(report.gaps)}`);
  assert.deepStrictEqual(report.bad, [6 * TF], `bad ${JSON.stringify(report.bad)}`);

  await db.close();
  fs.unlinkSync(tmp);
  console.log('✅ verify tests passed');
};

run().catch(e => { console.error('❌', e); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_verify.js`
Expected: FAIL — cannot find `backtest/download-data.js`.

- [ ] **Step 3: Write minimal implementation**

Create `backtest/download-data.js`:

```js
import path from 'path';
import { fileURLToPath } from 'url';
import { TF_MS } from '../src/data/marketParse.js';
import { openMarketDb } from '../src/data/marketDataSchema.js';
import { MarketDataRepo } from '../src/data/MarketDataRepo.js';
import { downloadCandles, fetchFundingPage, fetchContract } from '../src/data/marketDataFetch.js';

const DEFAULT_MMR = 0.005; // single-tier MMR approximation (BitGet public API has no MMR field)

/**
 * Integrity check: detect candle gaps and obviously bad candles (non-positive prices,
 * or high < low).
 * @returns {Promise<{count:number, gaps:number[], bad:number[]}>}
 */
export async function verifyCandles(repo, symbol, timeframe) {
  const tfMs = TF_MS[timeframe];
  const rows = await repo.getCandles(symbol, timeframe, 0, Number.MAX_SAFE_INTEGER);
  const gaps = await repo.findGaps(symbol, timeframe, tfMs);
  const bad = rows
    .filter(r => !(r.open > 0 && r.high > 0 && r.low > 0 && r.close > 0) || r.high < r.low)
    .map(r => r.time);
  return { count: rows.length, gaps, bad };
}

/** Parse `--key value` / `--flag` argv into an object. */
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) { out[key] = true; }
    else { out[key] = next; i++; }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const symbols = String(args.symbol || 'BTCUSDT').split(',').map(s => s.trim()).filter(Boolean);
  const tf = String(args.tf || '1H');
  const from = args.from ? Date.parse(args.from) : Date.now() - 30 * 86400000;
  const mmr = args.mmr ? Number(args.mmr) : DEFAULT_MMR;
  const dbPath = path.join(process.cwd(), 'market_data.db');

  const db = await openMarketDb(dbPath);
  const repo = new MarketDataRepo(db);

  for (const symbol of symbols) {
    if (args.verify) {
      const r = await verifyCandles(repo, symbol, tf);
      console.log(`[verify] ${symbol} ${tf}: ${r.count} candles, ${r.gaps.length} gaps, ${r.bad.length} bad`);
      continue;
    }
    console.log(`[download] ${symbol} ${tf} candles (Binance) from ${new Date(from).toISOString()}...`);
    const n = await downloadCandles(repo, { symbol, timeframe: tf, from });
    console.log(`[download] ${symbol} ${tf}: +${n} candles`);

    const funding = await fetchFundingPage({ symbol }); // BitGet
    const fn = await repo.upsertFunding(symbol, funding);
    console.log(`[download] ${symbol} funding (BitGet): +${fn} rows`);

    const spec = await fetchContract({ symbol, mmr }); // BitGet
    await repo.upsertContractSpec(spec);
    console.log(`[download] ${symbol} spec (BitGet): leverage≤${spec.max_leverage}, takerFee ${spec.taker_fee}, mmr ${spec.mmr}`);
  }

  await db.close();
}

// Run only when invoked directly (not when imported by tests).
// fileURLToPath is Windows-safe (avoids the leading-slash "/C:/..." pathname pitfall).
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch(e => { console.error('[download-data] FAILED:', e.message); process.exit(1); });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_verify.js`
Expected: PASS — `✅ verify tests passed`.

- [ ] **Step 5: Run the full data-layer test suite**

Run: `node tests/test_market_schema.js && node tests/test_market_parse.js && node tests/test_market_repo.js && node tests/test_download_loop.js && node tests/test_verify.js`
Expected: all five print their pass lines, exit 0.

- [ ] **Step 6: Commit**

```bash
git add backtest/download-data.js tests/test_verify.js
git commit -m "feat(data): download-data CLI + candle integrity verify"
```

---

## Task 7: Live smoke test (manual integration — real Binance + BitGet)

Manual verification against the live public APIs. NOT a committed unit test.

**Files:** none created.

- [ ] **Step 1: Download a small real slice**

Run: `node backtest/download-data.js --symbol BTCUSDT --tf 1H --from 2026-05-01`
Expected: `+N candles` (N > 0, from Binance), `+M funding rows` (from BitGet), and a spec line `leverage≤150` (or current) / `takerFee 0.0006`. A `market_data.db` appears in the project root.

- [ ] **Step 2: Verify integrity**

Run: `node backtest/download-data.js --symbol BTCUSDT --tf 1H --verify`
Expected: `[verify] BTCUSDT 1H: N candles, 0 gaps, 0 bad`.

- [ ] **Step 3: Confirm idempotent re-download**

Re-run Step 1. Expected: `+0 candles`.

- [ ] **Step 4: Ignore generated DB**

`market_data.db` is generated data — confirm it is git-ignored. If not, add it in a separate commit:

```bash
echo "market_data.db" >> .gitignore && git add .gitignore && git commit -m "chore: ignore generated market_data.db"
```

---

## Done criteria

- `src/data/{marketDataSchema,marketParse,MarketDataRepo,marketDataFetch}.js` + `backtest/download-data.js` exist.
- Candles (Binance) / funding (BitGet) / contract specs (BitGet) persist in a dedicated `market_data.db` behind `MarketDataRepo`.
- Download is incremental + idempotent; `--verify` reports gaps and bad candles.
- All five offline test files pass; the manual smoke test confirms the real endpoints.
- No live trading code, `db.js`, `src/core/**`, or indicators were modified.

## Next plan (not in this one)

- **Phase 3 — Backtest shell (spot):** walk-forward engine consuming `evaluateBar` (Phase 1) + candles from `MarketDataRepo`, simulating fills/fees/slippage at `leverage=1`, with metrics + run persistence. Reproduces the spike's SMC result through the real pipeline.
