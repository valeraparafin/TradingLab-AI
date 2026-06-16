# TrendPullback Strategy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a backtest-first intraday trend-continuation logic (`TrendPullback`) with an explicit ADX regime gate and an optional higher-timeframe bias, whose edge is then measured on a train/test split.

**Architecture:** New `logicType` following the existing pluggable pattern — three pure `Technicals` helpers (`rsi`, `adx`, `slope`), a `trendPullback.execute()` indicator that computes four agreement layers (bias, regime, trigger, invalidation) with an `htfRatio` toggle for single- vs dual-TF, and a `fromTrendPullback` SignalAdapter mapper. Indicator params are threaded from CLI into `config.logic.indicators` via a new `buildLogicConfig`. Live path (`bot_engine.js`) is never touched.

**Tech Stack:** Node.js ESM, plain functions, standalone `node tests/*.mjs` test files (assert + manual `ok()` counter, mirroring `tests/test_atr.mjs`).

---

## Context the implementer needs

- **Indicator → signal flow:** `src/core/pipeline.js` `evaluateBar` calls `new IndicatorManager(ctx.config.logic || {}).calculate(ctx.config.logicType, ctx.candles)`, then `deriveSignal(logicType, raw, {price, candles})`. So an indicator reads its params from `config.indicators` (where `config` IS `ctx.config.logic`), and a SignalAdapter mapper turns its raw output into the `Signal` contract.
- **Signal contract** (`src/core/contracts.js`): `{ side: 'BUY'|'SELL'|'HOLD', conviction: 0..1, reason: string, invalidation: number|null }`. `SIDE = { BUY, SELL, HOLD }`. `invalidation` feeds RiskPolicy's structural stop.
- **Param-lookup idiom** (from `src/indicators/smc.js`): accept camelCase first, then snake_case, then default — `[ind.adxMin, ind.adx_min].find(v => v != null) ?? 22`.
- **Series-length conventions already in `Technicals`:** `ema(values, period)` → length `n - period + 1` (SMA seed then EMA). `atr(candles, period)` → length `n - period`, `[]` if `n < period + 1`. `calcStdDev(values, period)` → single number over the last `period`, `null` if short.
- **`aggregateHTF(candles, ratio)`** (`src/core/aggregateHTF.js`): closed-only HTF resample, ascending. `ratio=1` is valid and returns the working candles minus the final open bucket — this is exactly how the single-TF toggle falls out. No look-ahead.
- **Windowing:** `src/backtest/simulator.js:132` passes only the last `lookback` candles to the indicator each bar. EMA200-on-HTF therefore needs `lookback ≥ emaBias × htfRatio + 2 × adxPeriod × htfRatio + buffer`. The default `lookback=250` is too small for the defaults — the **measurement phase must pass `--lookback 1200`** (covers emaBias 200 × htfRatio 4 + ADX + slack). With a too-small window the strategy silently never triggers (bias=0 forever); this is the #1 footgun.
- **No logic-name allow-list exists in the runners.** Both `run-backtest.js` and `run-matrix.js` pass the `logicType` string straight through; the only throw is the `default:` case in `IndicatorManager.calculate` and `deriveSignal`. Registering `TRENDPULLBACK` in those two switches is all that's needed to make the name valid. (The spec's "lift the 4-name validation" was inaccurate — there is nothing to lift. The real runner change is threading indicator params, Task 6.)
- **HTF gate vs TrendPullback's own HTF:** TrendPullback has its bias TF built in via `htfRatio`. Do **not** combine `--htf` (the external gate) with this logic — it would be redundant double-HTF. Document this; do not wire any guard.
- **Live-safety invariant:** every new code path is reached only through `simulate`/backtest. `bot_engine.js` never calls `simulate`. Adding switch cases for a new logic type does not change behavior for the existing live logic types (their cases are untouched). Existing suites must stay green.

---

## Task 1: `Technicals.rsi` (Wilder)

**Files:**
- Modify: `src/indicators/technical.js` (add `rsi` to the `Technicals` object literal)
- Test: `tests/test_rsi.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/test_rsi.mjs
import assert from 'node:assert';
import { Technicals } from '../src/indicators/technical.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

// --- strictly rising series → RSI = 100 (no losses) ---
{
  const values = Array.from({ length: 30 }, (_, i) => 100 + i); // 100,101,...129
  const rsi = Technicals.rsi(values, 14);
  assert.strictEqual(rsi.length, 30 - 14, 'series length = n - period');
  for (const v of rsi) assert.ok(Math.abs(v - 100) < 1e-9, 'all gains → RSI 100');
  ok('strictly rising → RSI 100');
}

// --- strictly falling series → RSI = 0 (no gains) ---
{
  const values = Array.from({ length: 30 }, (_, i) => 130 - i);
  const rsi = Technicals.rsi(values, 14);
  for (const v of rsi) assert.ok(Math.abs(v - 0) < 1e-9, 'all losses → RSI 0');
  ok('strictly falling → RSI 0');
}

// --- alternating equal up/down → RSI ≈ 50 ---
{
  const values = [];
  for (let i = 0; i < 40; i++) values.push(100 + (i % 2)); // 100,101,100,101,...
  const rsi = Technicals.rsi(values, 14);
  const last = rsi[rsi.length - 1];
  assert.ok(Math.abs(last - 50) < 1e-6, `balanced moves → RSI ~50 (got ${last})`);
  ok('alternating → RSI ~50');
}

// --- insufficient data → [] ---
{
  assert.deepStrictEqual(Technicals.rsi([1, 2, 3], 14), [], 'n <= period → []');
  assert.deepStrictEqual(Technicals.rsi([], 14), [], 'empty → []');
  ok('insufficient data → []');
}

console.log(`\n${passed} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_rsi.mjs`
Expected: FAIL — `Technicals.rsi is not a function`.

- [ ] **Step 3: Implement `rsi`**

Add this property to the `Technicals` object in `src/indicators/technical.js` (after `atr`, before the closing `}`; add a comma after the previous member):

```js
  /**
   * Wilder's RSI over a value array (e.g. closes). Seed = SMA of the first `period`
   * gains/losses, then Wilder smoothing. Returns an ascending series of length
   * (values.length - period), or [] if there are not more than `period` values.
   */
  rsi(values, period) {
    if (!Array.isArray(values) || values.length < period + 1) return [];
    const gains = [], losses = [];
    for (let i = 1; i < values.length; i++) {
      const d = values[i] - values[i - 1];
      gains.push(d > 0 ? d : 0);
      losses.push(d < 0 ? -d : 0);
    }
    let avgGain = 0, avgLoss = 0;
    for (let i = 0; i < period; i++) { avgGain += gains[i]; avgLoss += losses[i]; }
    avgGain /= period; avgLoss /= period;
    const rsiAt = (g, l) => (l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l));
    const out = [rsiAt(avgGain, avgLoss)];
    for (let i = period; i < gains.length; i++) {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
      out.push(rsiAt(avgGain, avgLoss));
    }
    return out;
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_rsi.mjs`
Expected: PASS — `4 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/indicators/technical.js tests/test_rsi.mjs
git commit -m "feat(indicators): Wilder RSI on Technicals

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `Technicals.adx` (Wilder DMI/ADX)

**Files:**
- Modify: `src/indicators/technical.js` (add `adx` to the `Technicals` object literal)
- Test: `tests/test_adx.mjs`

ADX is non-directional (regime magnitude only). Exact reference values are awkward, so the test asserts *behavior*: a strong clean trend yields high ADX; a flat/alternating series yields low ADX; insufficient data yields `[]`.

- [ ] **Step 1: Write the failing test**

```js
// tests/test_adx.mjs
import assert from 'node:assert';
import { Technicals } from '../src/indicators/technical.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };
const c = (h, l, cl) => ({ high: h, low: l, close: cl });

// --- strong steady uptrend → high ADX (> 40) ---
{
  const candles = Array.from({ length: 60 }, (_, i) => c(102 + i, 100 + i, 101 + i));
  const adx = Technicals.adx(candles, 14);
  assert.ok(adx.length > 0, 'produces a series');
  const last = adx[adx.length - 1];
  assert.ok(last > 40, `clean trend → high ADX (got ${last})`);
  for (const v of adx) assert.ok(v >= 0 && v <= 100, 'ADX within [0,100]');
  ok('strong trend → high ADX');
}

// --- flat/alternating chop → low ADX (< 25) ---
{
  const candles = Array.from({ length: 60 }, (_, i) =>
    (i % 2 === 0 ? c(101, 99, 100) : c(101.5, 99.5, 100.5)));
  const adx = Technicals.adx(candles, 14);
  const last = adx[adx.length - 1];
  assert.ok(last < 25, `chop → low ADX (got ${last})`);
  ok('chop → low ADX');
}

// --- insufficient data → [] ---
{
  const few = Array.from({ length: 20 }, () => c(101, 99, 100)); // < 2*period+1
  assert.deepStrictEqual(Technicals.adx(few, 14), [], 'too few candles → []');
  assert.deepStrictEqual(Technicals.adx([], 14), [], 'empty → []');
  ok('insufficient data → []');
}

console.log(`\n${passed} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_adx.mjs`
Expected: FAIL — `Technicals.adx is not a function`.

- [ ] **Step 3: Implement `adx`**

Add this property to the `Technicals` object in `src/indicators/technical.js` (after `rsi`, with a trailing comma on the previous member):

```js
  /**
   * Wilder's ADX (Average Directional Index) — non-directional trend-strength in [0,100].
   * Computes +DM/-DM/TR, Wilder-smooths each over `period`, forms +DI/-DI and DX, then
   * Wilder-averages DX over `period`. Returns an ascending ADX series of length
   * (candles.length - 2*period + 1), or [] if candles.length < 2*period + 1.
   */
  adx(candles, period) {
    if (!Array.isArray(candles) || candles.length < 2 * period + 1) return [];
    const plusDM = [], minusDM = [], tr = [];
    for (let i = 1; i < candles.length; i++) {
      const up = candles[i].high - candles[i - 1].high;
      const down = candles[i - 1].low - candles[i].low;
      plusDM.push(up > down && up > 0 ? up : 0);
      minusDM.push(down > up && down > 0 ? down : 0);
      const h = candles[i].high, l = candles[i].low, pc = candles[i - 1].close;
      tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
    // Wilder smoothing of an array, seeded by the sum of the first `period` values.
    const smooth = (arr) => {
      let s = 0;
      for (let i = 0; i < period; i++) s += arr[i];
      const out = [s];
      for (let i = period; i < arr.length; i++) { s = s - s / period + arr[i]; out.push(s); }
      return out;
    };
    const sPlus = smooth(plusDM), sMinus = smooth(minusDM), sTr = smooth(tr);
    const dx = [];
    for (let i = 0; i < sTr.length; i++) {
      const pDI = sTr[i] === 0 ? 0 : 100 * (sPlus[i] / sTr[i]);
      const mDI = sTr[i] === 0 ? 0 : 100 * (sMinus[i] / sTr[i]);
      const denom = pDI + mDI;
      dx.push(denom === 0 ? 0 : 100 * (Math.abs(pDI - mDI) / denom));
    }
    if (dx.length < period) return [];
    let adxVal = 0;
    for (let i = 0; i < period; i++) adxVal += dx[i];
    adxVal /= period;
    const out = [adxVal];
    for (let i = period; i < dx.length; i++) { adxVal = (adxVal * (period - 1) + dx[i]) / period; out.push(adxVal); }
    return out;
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_adx.mjs`
Expected: PASS — `3 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/indicators/technical.js tests/test_adx.mjs
git commit -m "feat(indicators): Wilder ADX on Technicals

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `Technicals.slope` (normalized regression slope)

**Files:**
- Modify: `src/indicators/technical.js` (add `slope` to the `Technicals` object literal)
- Test: `tests/test_slope.mjs`

Returns a single number (slope over the last `period` values, normalized by their mean → unit-free fractional change per bar), mirroring `calcStdDev`'s single-value style.

- [ ] **Step 1: Write the failing test**

```js
// tests/test_slope.mjs
import assert from 'node:assert';
import { Technicals } from '../src/indicators/technical.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

// --- rising line → positive slope ---
{
  const s = Technicals.slope([100, 101, 102, 103, 104], 5);
  assert.ok(s > 0, `rising → positive (got ${s})`);
  ok('rising → positive slope');
}

// --- falling line → negative slope ---
{
  const s = Technicals.slope([104, 103, 102, 101, 100], 5);
  assert.ok(s < 0, `falling → negative (got ${s})`);
  ok('falling → negative slope');
}

// --- flat line → ~0 slope ---
{
  const s = Technicals.slope([100, 100, 100, 100, 100], 5);
  assert.ok(Math.abs(s) < 1e-12, `flat → ~0 (got ${s})`);
  ok('flat → zero slope');
}

// --- uses only the last `period` values ---
{
  const s = Technicals.slope([0, 0, 0, 100, 101, 102], 3); // last 3 rising
  assert.ok(s > 0, 'windowed to last period');
  ok('windowed to last period');
}

// --- insufficient data → null ---
{
  assert.strictEqual(Technicals.slope([1, 2], 5), null, 'short → null');
  assert.strictEqual(Technicals.slope([], 5), null, 'empty → null');
  ok('insufficient data → null');
}

console.log(`\n${passed} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_slope.mjs`
Expected: FAIL — `Technicals.slope is not a function`.

- [ ] **Step 3: Implement `slope`**

Add this property to the `Technicals` object in `src/indicators/technical.js` (after `adx`, trailing comma on the previous member):

```js
  /**
   * Least-squares slope over the last `period` values, normalized by their mean
   * (fractional change per bar — unit-free, comparable across symbols). Returns a
   * single number, or null if there are fewer than `period` values.
   */
  slope(values, period) {
    if (!Array.isArray(values) || values.length < period) return null;
    const slice = values.slice(-period);
    const n = period;
    const sumX = (n * (n - 1)) / 2;
    const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
    let sumY = 0, sumXY = 0;
    for (let i = 0; i < n; i++) { sumY += slice[i]; sumXY += i * slice[i]; }
    const denom = n * sumX2 - sumX * sumX;
    if (denom === 0) return null;
    const m = (n * sumXY - sumX * sumY) / denom; // slope per bar
    const mean = sumY / n;
    return mean !== 0 ? m / mean : 0;
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_slope.mjs`
Expected: PASS — `5 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/indicators/technical.js tests/test_slope.mjs
git commit -m "feat(indicators): normalized regression slope on Technicals

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `trendPullback.execute` (four-layer logic + htfRatio toggle)

**Files:**
- Create: `src/indicators/trendPullback.js`
- Test: `tests/test_trend_pullback.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/test_trend_pullback.mjs
import assert from 'node:assert';
import TrendPullback from '../src/indicators/trendPullback.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

// Candle helper with an explicit time step (aggregateHTF infers the step from times).
const STEP = 3600_000; // 1h
const mk = (o, h, l, cl, i) => ({ time: i * STEP, open: o, high: h, low: l, close: cl, volume: 1 });

// Build a long uptrend, then a brief pullback that tags the fast EMA, then a reclaim bar.
// Single-TF (htfRatio=1) keeps bias/regime on the working series so the test is deterministic.
function uptrendThenPullback() {
  const candles = [];
  let price = 100, i = 0;
  for (; i < 320; i++) { price += 0.5; candles.push(mk(price - 0.5, price + 0.3, price - 0.3, price, i)); } // strong trend
  // pullback: four down bars driving RSI below 45 and tagging the fast EMA
  for (let k = 0; k < 4; k++, i++) { price -= 1.5; candles.push(mk(price + 1.5, price + 1.6, price - 0.2, price, i)); }
  // reclaim bar: a strong up close pushes RSI back up through 45 (the trigger)
  price += 4.5; candles.push(mk(price - 4.5, price + 0.2, price - 4.6, price, i)); i++;
  return candles;
}

// --- aligned uptrend pullback → BUY ---
{
  const candles = uptrendThenPullback();
  const raw = TrendPullback.execute(candles, { indicators: { htfRatio: 1, emaBias: 50, adxMin: 15 } });
  assert.strictEqual(raw.side, 'BUY', `aligned long setup → BUY (got ${raw.side}; bias=${raw.bias} regime=${raw.regimeOK} trig=${raw.trigger})`);
  assert.ok(raw.invalidation != null && raw.invalidation < raw.price, 'BUY invalidation is a swing low below price');
  ok('aligned uptrend pullback → BUY');
}

// --- chop (low ADX) → HOLD even if other layers flicker ---
{
  const candles = [];
  for (let i = 0; i < 200; i++) candles.push(mk(100, 100.5, 99.5, i % 2 ? 100.2 : 99.8, i));
  const raw = TrendPullback.execute(candles, { indicators: { htfRatio: 1, emaBias: 50, adxMin: 25 } });
  assert.strictEqual(raw.side, 'HOLD', `chop → HOLD (regimeOK=${raw.regimeOK})`);
  assert.strictEqual(raw.regimeOK, false, 'regime gate closed in chop');
  ok('chop → HOLD');
}

// --- mirrored downtrend pullback → SELL ---
{
  const candles = [];
  let price = 300, i = 0;
  for (; i < 320; i++) { price -= 0.5; candles.push(mk(price + 0.5, price + 0.3, price - 0.3, price, i)); }
  for (let k = 0; k < 4; k++, i++) { price += 1.5; candles.push(mk(price - 1.5, price + 0.2, price - 1.6, price, i)); }
  price -= 4.5; candles.push(mk(price + 4.5, price + 4.6, price - 0.2, price, i)); i++;
  const raw = TrendPullback.execute(candles, { indicators: { htfRatio: 1, emaBias: 50, adxMin: 15 } });
  assert.strictEqual(raw.side, 'SELL', `aligned short setup → SELL (got ${raw.side}; bias=${raw.bias} regime=${raw.regimeOK} trig=${raw.trigger})`);
  assert.ok(raw.invalidation != null && raw.invalidation > raw.price, 'SELL invalidation is a swing high above price');
  ok('aligned downtrend pullback → SELL');
}

// --- htfRatio toggle changes the aggregation (2-TF path runs without throwing and yields a defined side) ---
{
  const candles = uptrendThenPullback();
  const raw = TrendPullback.execute(candles, { indicators: { htfRatio: 4, emaBias: 20, adxMin: 15 } });
  assert.ok(['BUY', 'SELL', 'HOLD'].includes(raw.side), 'dual-TF path returns a valid side');
  ok('htfRatio=4 dual-TF path runs');
}

// --- insufficient data → HOLD, no throw ---
{
  const candles = Array.from({ length: 10 }, (_, i) => mk(100, 101, 99, 100, i));
  const raw = TrendPullback.execute(candles, { indicators: {} });
  assert.strictEqual(raw.side, 'HOLD', 'short input → HOLD');
  ok('insufficient data → HOLD');
}

console.log(`\n${passed} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_trend_pullback.mjs`
Expected: FAIL — cannot find module `trendPullback.js`.

- [ ] **Step 3: Implement `trendPullback.execute`**

Create `src/indicators/trendPullback.js`:

```js
import { Technicals } from './technical.js';
import { aggregateHTF } from '../core/aggregateHTF.js';

/**
 * Trend-continuation logic with an explicit regime gate. Four layers must agree:
 *   1. Bias    (HTF): close vs EMA(emaBias) AND slope(EMA) sign
 *   2. Regime  (HTF): ADX(adxPeriod) > adxMin  (else chop → HOLD)
 *   3. Trigger (working TF): pullback tags EMA(emaFast) AND RSI crosses rsiPullback
 *   4. Invalidation: recent swing low (BUY) / swing high (SELL) for the structural stop
 *
 * `htfRatio` toggles single- vs dual-TF: 1 → bias/regime on the working series (minus the
 * open bucket via aggregateHTF); 4 → bias/regime on the aggregated 4× series. Trigger is
 * always on the working candles. Closed-only aggregation → no look-ahead. Pure/deterministic.
 */
const TrendPullback = {
  execute(candles, config = {}) {
    const ind = config.indicators || {};
    const pick = (cam, sn, def) => {
      const v = [ind[cam], ind[sn]].find((x) => x !== undefined && x !== null);
      return v ?? def;
    };
    const emaBias = pick('emaBias', 'ema_bias', 200);
    const slopeLen = pick('slopeLen', 'slope_len', 20);
    const adxPeriod = pick('adxPeriod', 'adx_period', 14);
    const adxMin = pick('adxMin', 'adx_min', 22);
    const emaFast = pick('emaFast', 'ema_fast', 20);
    const rsiPeriod = pick('rsiPeriod', 'rsi_period', 14);
    const rsiPullback = pick('rsiPullback', 'rsi_pullback', 45);
    const htfRatio = pick('htfRatio', 'htf_ratio', 4);

    const HOLD = (extra = {}) => ({
      side: 'HOLD', bias: 0, regimeOK: false, adx: null, biasSlope: null,
      trigger: 0, rsi: null, emaFast: null, price: candles.length ? candles[candles.length - 1].close : null,
      invalidation: null, ...extra,
    });
    if (!Array.isArray(candles) || candles.length < 3) return HOLD();

    // --- HTF layers: bias + regime ---
    const htf = aggregateHTF(candles, htfRatio); // ratio=1 → working candles minus open bucket
    const htfClose = htf.map((c) => c.close);
    const emaBiasSeries = Technicals.ema(htfClose, emaBias);
    const biasSlope = Technicals.slope(emaBiasSeries, slopeLen);
    const adxSeries = Technicals.adx(htf, adxPeriod);
    const adx = adxSeries.length ? adxSeries[adxSeries.length - 1] : null;
    const lastHtfClose = htfClose.length ? htfClose[htfClose.length - 1] : null;
    const lastEmaBias = emaBiasSeries.length ? emaBiasSeries[emaBiasSeries.length - 1] : null;

    let bias = 0;
    if (lastHtfClose != null && lastEmaBias != null && biasSlope != null) {
      if (lastHtfClose > lastEmaBias && biasSlope > 0) bias = 1;
      else if (lastHtfClose < lastEmaBias && biasSlope < 0) bias = -1;
    }
    const regimeOK = adx != null && adx > adxMin;

    // --- working-TF trigger: pullback to fast EMA + RSI turn ---
    const close = candles.map((c) => c.close);
    const emaFastSeries = Technicals.ema(close, emaFast);
    const rsiSeries = Technicals.rsi(close, rsiPeriod);
    const lastClose = close[close.length - 1];
    const prevClose = close.length > 1 ? close[close.length - 2] : null;
    const lastEmaFast = emaFastSeries.length ? emaFastSeries[emaFastSeries.length - 1] : null;
    const rsiNow = rsiSeries.length ? rsiSeries[rsiSeries.length - 1] : null;
    const rsiPrev = rsiSeries.length > 1 ? rsiSeries[rsiSeries.length - 2] : null;

    let trigger = 0;
    if (lastEmaFast != null && rsiNow != null && rsiPrev != null && prevClose != null) {
      const touchedDown = Math.min(prevClose, lastClose) <= lastEmaFast;
      const rsiTurnUp = rsiPrev <= rsiPullback && rsiNow > rsiPullback;
      const touchedUp = Math.max(prevClose, lastClose) >= lastEmaFast;
      const rsiTurnDown = rsiPrev >= 100 - rsiPullback && rsiNow < 100 - rsiPullback;
      if (touchedDown && rsiTurnUp) trigger = 1;
      else if (touchedUp && rsiTurnDown) trigger = -1;
    }

    // --- resolve: all layers agree ---
    let side = 'HOLD';
    if (regimeOK && bias === 1 && trigger === 1) side = 'BUY';
    else if (regimeOK && bias === -1 && trigger === -1) side = 'SELL';

    // --- invalidation: recent swing extreme on working TF ---
    const swingLen = Math.max(emaFast, 10);
    const recent = candles.slice(-swingLen);
    const swingLow = Math.min(...recent.map((c) => c.low));
    const swingHigh = Math.max(...recent.map((c) => c.high));

    return {
      side, bias, regimeOK, adx, biasSlope, trigger,
      rsi: rsiNow, emaFast: lastEmaFast, price: lastClose,
      invalidation: side === 'BUY' ? swingLow : side === 'SELL' ? swingHigh : null,
    };
  },
};

export default TrendPullback;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_trend_pullback.mjs`
Expected: PASS — `5 checks passed`.

If the BUY/SELL cases do not fire, inspect the printed `bias/regime/trig` in the assertion message and adjust the **synthetic candle shape in the test** (e.g. deepen the pullback so it tags the fast EMA, or steepen the trend so ADX clears the gate) — do **not** weaken the production logic to fit the test.

- [ ] **Step 5: Commit**

```bash
git add src/indicators/trendPullback.js tests/test_trend_pullback.mjs
git commit -m "feat(indicators): TrendPullback 4-layer logic with htfRatio toggle

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `fromTrendPullback` mapper + register in both switches

**Files:**
- Modify: `src/core/SignalAdapter.js` (add mapper + `deriveSignal` case)
- Modify: `src/indicators/index.js` (add `IndicatorManager` case)
- Test: `tests/test_trend_pullback_signal.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/test_trend_pullback_signal.mjs
import assert from 'node:assert';
import { deriveSignal } from '../src/core/SignalAdapter.js';
import { IndicatorManager } from '../src/indicators/index.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

// --- mapper: HOLD raw → HOLD signal ---
{
  const sig = deriveSignal('TrendPullback', { side: 'HOLD', invalidation: null }, { price: 100, candles: [] });
  assert.strictEqual(sig.side, 'HOLD', 'HOLD passes through');
  assert.strictEqual(sig.conviction, 0, 'HOLD conviction 0');
  ok('HOLD raw → HOLD signal');
}

// --- mapper: BUY raw → BUY signal, invalidation preserved, conviction in (0,1] ---
{
  const sig = deriveSignal('TrendPullback', { side: 'BUY', adx: 35, invalidation: 95 }, { price: 100, candles: [] });
  assert.strictEqual(sig.side, 'BUY', 'BUY side');
  assert.strictEqual(sig.invalidation, 95, 'invalidation preserved');
  assert.ok(sig.conviction > 0 && sig.conviction <= 1, 'conviction in (0,1]');
  ok('BUY raw → BUY signal');
}

// --- strong ADX lifts conviction above weak ADX ---
{
  const strong = deriveSignal('TrendPullback', { side: 'BUY', adx: 40, invalidation: 95 }, { price: 100, candles: [] });
  const weak = deriveSignal('TrendPullback', { side: 'BUY', adx: 20, invalidation: 95 }, { price: 100, candles: [] });
  assert.ok(strong.conviction > weak.conviction, 'higher ADX → higher conviction');
  ok('ADX raises conviction');
}

// --- IndicatorManager dispatches TRENDPULLBACK without throwing ---
{
  const STEP = 3600_000;
  const candles = Array.from({ length: 60 }, (_, i) => ({ time: i * STEP, open: 100, high: 101, low: 99, close: 100, volume: 1 }));
  const raw = new IndicatorManager({}).calculate('TrendPullback', candles);
  assert.ok(raw && typeof raw.side === 'string', 'IndicatorManager returns raw with a side');
  ok('IndicatorManager dispatches TRENDPULLBACK');
}

console.log(`\n${passed} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_trend_pullback_signal.mjs`
Expected: FAIL — `deriveSignal` throws `Unsupported logicType: TrendPullback`.

- [ ] **Step 3: Register in `IndicatorManager`**

In `src/indicators/index.js`, add the import and the switch case:

```js
import TrendPullback from './trendPullback.js';
```

In `calculate`'s switch, before `default:`:

```js
      case 'TRENDPULLBACK':
        return TrendPullback.execute(candles, this.config);
```

- [ ] **Step 4: Add the mapper to `SignalAdapter`**

In `src/core/SignalAdapter.js`, add the mapper function (after `fromReversal`):

```js
/** TrendPullback: execute() already resolved the side; conviction from ADX strength. */
function fromTrendPullback(raw) {
  const side = raw?.side ?? SIDE.HOLD;
  if (side === SIDE.HOLD) return hold('TrendPullback: layers not aligned');
  let conviction = 0.5;
  if ((raw.adx ?? 0) > 30) conviction += 0.2;
  conviction += 0.15; // trigger already required a clean RSI turn upstream
  return { side, conviction: clamp(conviction), reason: `TrendPullback ${side}`, invalidation: raw.invalidation ?? null };
}
```

And register it in `deriveSignal`'s switch, before `default:`:

```js
    case 'TRENDPULLBACK': return fromTrendPullback(raw);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node tests/test_trend_pullback_signal.mjs`
Expected: PASS — `4 checks passed`.

- [ ] **Step 6: Run the existing suites to confirm no regression**

Run: `node tests/test_trend_pullback.mjs; node tests/test_adx.mjs; node tests/test_rsi.mjs; node tests/test_slope.mjs`
Expected: all PASS (existing logic types untouched; new cases additive).

- [ ] **Step 7: Commit**

```bash
git add src/core/SignalAdapter.js src/indicators/index.js tests/test_trend_pullback_signal.mjs
git commit -m "feat(signal): wire TrendPullback through SignalAdapter and IndicatorManager

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Thread indicator params from CLI (`buildLogicConfig`)

Today `runOne` hardcodes `logic: {}`, so TrendPullback's params can't be set from the CLI. Add a `buildLogicConfig` that maps known indicator flags into `config.logic.indicators`, and thread it through both runners.

**Files:**
- Modify: `backtest/run-backtest.js` (add `buildLogicConfig`, use it in `runOne` and `main`)
- Modify: `backtest/run-matrix.js` (use `buildLogicConfig` per cell)
- Test: `tests/test_build_logic_config.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/test_build_logic_config.mjs
import assert from 'node:assert';
import { buildLogicConfig } from '../backtest/run-backtest.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

// --- no indicator flags → empty object (other logics keep their defaults) ---
{
  assert.deepStrictEqual(buildLogicConfig({ symbol: 'BTCUSDT' }), {}, 'no flags → {}');
  ok('no flags → {}');
}

// --- known flags land under .indicators as numbers ---
{
  const cfg = buildLogicConfig({ adxMin: '25', htfRatio: '4', rsiPullback: '40' });
  assert.deepStrictEqual(cfg, { indicators: { adxMin: 25, htfRatio: 4, rsiPullback: 40 } }, 'flags → numeric indicators');
  ok('known flags → numeric indicators');
}

// --- unknown flags are ignored ---
{
  const cfg = buildLogicConfig({ adxMin: '20', leverage: '10', tf: '1H' });
  assert.deepStrictEqual(cfg, { indicators: { adxMin: 20 } }, 'only indicator keys kept');
  ok('unknown flags ignored');
}

console.log(`\n${passed} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_build_logic_config.mjs`
Expected: FAIL — `buildLogicConfig` is not exported.

- [ ] **Step 3: Add `buildLogicConfig` to `run-backtest.js`**

In `backtest/run-backtest.js`, after `buildCosts` (before `parseDate`), add:

```js
/**
 * Map known indicator CLI flags into a `config.logic` object ({ indicators: {...} }).
 * Only TrendPullback currently reads these; other logics use their own defaults, so an
 * empty object is returned when no indicator flag is present. All values coerced to Number.
 */
export function buildLogicConfig(args) {
  const KEYS = ['emaBias', 'slopeLen', 'adxPeriod', 'adxMin', 'emaFast', 'rsiPeriod', 'rsiPullback', 'htfRatio'];
  const indicators = {};
  for (const k of KEYS) if (args[k] != null) indicators[k] = Number(args[k]);
  return Object.keys(indicators).length ? { indicators } : {};
}
```

- [ ] **Step 4: Use `logicConfig` in `runOne`**

In `runOne`, change the config line:

```js
  const config = { logicType: p.logicType, logic: p.logicConfig || {} };
```

In `main()`, build it and pass it through. After the `const exitPolicy = ...` line, add:

```js
  const logicConfig = buildLogicConfig(args);
```

and add `logicConfig,` to the `runOne(btRepo, { ... })` argument object.

- [ ] **Step 5: Use it per cell in `run-matrix.js`**

In `backtest/run-matrix.js`, extend the import from `./run-backtest.js`:

```js
import { runOne, buildCosts, parseDate, buildLogicConfig } from './run-backtest.js';
```

Inside the cell loop, after `const costs = buildCosts(args, spec);`, add:

```js
        const logicConfig = buildLogicConfig(args);
```

and add `logicConfig,` to the `runOne(btRepo, { ... })` argument object.

- [ ] **Step 6: Run the unit test**

Run: `node tests/test_build_logic_config.mjs`
Expected: PASS — `3 checks passed`.

- [ ] **Step 7: CLI smoke — params actually reach the indicator**

Run (single short window, single-TF so a small lookback suffices):

```powershell
node backtest/run-backtest.js --symbol BTCUSDT --tf 1H --logic TrendPullback `
  --equity 200 --riskPerTrade 0.1 --sizing compound --stopMode structural --minRR 0 `
  --htfRatio 1 --emaBias 50 --adxMin 15 --lookback 400 --group tp_smoke
```

Expected: completes without error and prints a `BACKTEST RESULT` block with a non-zero `Trades` count (proves the logic name is accepted, params thread through, and entries fire). If `Trades : 0`, increase `--lookback` and/or lower `--adxMin`; a zero count with default `--lookback 250` and dual-TF is the windowing footgun described in Context.

- [ ] **Step 8: Run the full existing suite (regression gate)**

Run: `node tests/test_matrix.js; node tests/test_matrix_integration.js`
Expected: PASS — runners still work for the existing logics (logicConfig defaults to `{}`).

- [ ] **Step 9: Commit**

```bash
git add backtest/run-backtest.js backtest/run-matrix.js tests/test_build_logic_config.mjs
git commit -m "feat(backtest): thread indicator params into config.logic via buildLogicConfig

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Measurement phase (controller-run experiment, not a subagent)

This task produces no production code — it is the validation discipline from the spec. The controller runs it; record everything in a gitignored research note.

**Files:**
- Create: `docs/research/2026-06-12-trend-pullback.md` (gitignored; the verdict + every run)

- [ ] **Step 1: Sanity single run (full window, dual-TF default)**

```powershell
node backtest/run-backtest.js --symbol SOLUSDT --tf 1H --logic TrendPullback `
  --equity 200 --riskPerTrade 0.5 --sizing compound --stopMode structural --minRR 0 `
  --htfRatio 4 --lookback 1200 --group tp_sanity
```
Confirm a sensible trade count and that it runs clean. `--lookback 1200` is mandatory for emaBias 200 × htfRatio 4 (see Context windowing note).

- [ ] **Step 2: Train-year A/B — single-TF vs dual-TF, across all symbols**

Create two risk templates if not reusing `pnl_rpt050.json` (rpt 0.5, compound). Run the matrix on the **train year only** for `htfRatio=1` then `htfRatio=4`:

```powershell
node backtest/run-matrix.js --risks pnl_rpt050 --logics TrendPullback `
  --symbols BTCUSDT,ETHUSDT,SOLUSDT,LTCUSDT,XLMUSDT,XRPUSDT --tfs 1H `
  --sizing compound --htfRatio 1 --lookback 1200 --from 2024-06-01 --to 2025-06-01 --group tp_train_1tf

node backtest/run-matrix.js --risks pnl_rpt050 --logics TrendPullback `
  --symbols BTCUSDT,ETHUSDT,SOLUSDT,LTCUSDT,XLMUSDT,XRPUSDT --tfs 1H `
  --sizing compound --htfRatio 4 --lookback 1200 --from 2024-06-01 --to 2025-06-01 --group tp_train_4tf
```
Record both comparison tables. Decide single- vs dual-TF by **breadth** (works on ≥4/6 symbols), not the single best cell.

- [ ] **Step 3: Threshold grid on the train year (plateau, not pick)**

Sweep `--adxMin` ∈ {18,22,26,30} and `--rsiPullback` ∈ {40,45,50} via repeated single-cell or matrix runs on the train window, holding the htfRatio chosen in Step 2. Accept a value only if its neighbors are also good (plateau). Record every grid cell.

- [ ] **Step 4: Freeze ≤2 candidates**

Write the two frozen configs (full parameter sets) into the research note **before** touching the test window. No changes after this point.

- [ ] **Step 5: Blind test on year 2**

Run each frozen candidate on `--from 2025-06-01 --to 2026-06-01` across all six symbols, and on the full `2024-06 → 2026-06` window. Record test-year PnL, PF, MaxDD, MAR per symbol.

- [ ] **Step 6: Verdict against the pro bar**

In the research note, state PASS/FAIL on each criterion (test-year PnL > 0; PF > 1.2 out of sample; MAR > 0.5; holds on ≥4/6 symbols). Report it straight — if it fails, say so and why, exactly as the prior PnL campaign note did. Do **not** re-optimize parameters after seeing the test results.

- [ ] **Step 7: Update the graph**

```bash
graphify update .
```

---

## Final review

After all tasks: dispatch a final code-reviewer over the whole diff (`git diff main...HEAD`), confirm every existing test suite is green, then use **superpowers:finishing-a-development-branch**.
