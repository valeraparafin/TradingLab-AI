# HTF Filter Measurement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure, on existing historical data, how many trades each strategy would lose to an HTF trend filter — broken down by with/against/neutral and by PnL — without changing any decision path.

**Architecture:** Post-processing of `simulate()` output. Two pure helpers (`aggregateHTF`, `classifyHTFTrend` — reused later by the real gate) plus an analyzer script (`scripts/analyze-htf-filter.js`) that runs the existing backtest, builds an HTF series by aggregation, classifies each trade's entry, and tallies. No edits to `pipeline.js`, `RiskPolicy.js`, or `simulator.js`.

**Tech Stack:** Node.js ESM. Standalone `.mjs` tests run via `node tests/<file>` (exit 0 = pass). Reuses `Technicals.ema` from `src/indicators/technical.js`, `simulate` from `src/backtest/simulator.js`, `buildGuardrails`/`buildCosts`/`parseArgs` from `backtest/run-backtest.js` & `backtest/download-data.js`, `MarketDataRepo` from `src/data/MarketDataRepo.js`.

**Casing:** snake_case at rest, camelCase in JS runtime. All identifiers here are camelCase JS. `*Pct` values are fractions (0.005 = 0.5%).

**Commit trailer (EXACT):** `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

**Branch:** `feat/htf-filter` (already created off `feat/structural-risk`).

---

## File Structure

- `src/core/aggregateHTF.js` — pure LTF→HTF resampler (calendar-aligned, closed-only). Reused by future gate.
- `src/core/classifyHTFTrend.js` — pure trend classifier, three definitions (`emaBand`/`emaSlope`/`adxRegime`). Reused by future gate.
- `scripts/analyze-htf-filter.js` — measurement script: `analyzeTrades` (pure, testable) + thin CLI `main()`.
- `tests/test_aggregate_htf.mjs` — unit tests for aggregation.
- `tests/test_classify_htf_trend.mjs` — unit tests for the three definitions.
- `tests/test_analyze_htf_filter.mjs` — smoke test for `analyzeTrades`.

---

## Task 1: `aggregateHTF` — LTF→HTF resampler

**Files:**
- Create: `src/core/aggregateHTF.js`
- Test: `tests/test_aggregate_htf.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/test_aggregate_htf.mjs
import assert from 'node:assert';
import { aggregateHTF } from '../src/core/aggregateHTF.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

// Helper: build hourly candles (time in ms) with given closes; OHLC derived from close.
const HOUR = 3600000;
const mk = (t, o, h, l, c, v = 1) => ({ time: t, open: o, high: h, low: l, close: c, volume: v });

// --- basic 4:1 aggregation, boundary-aligned, last (open) bucket dropped ---
{
  // 9 hourly candles at t=0..8h. Buckets [0,4h) and [4h,8h) are closed by a later
  // candle; the 3rd bucket (just t=8h) is open → dropped. Expect 2 HTF bars.
  const c = [];
  for (let i = 0; i <= 8; i++) c.push(mk(i * HOUR, 10 + i, 20 + i, i, 12 + i));
  const htf = aggregateHTF(c, 4);
  assert.strictEqual(htf.length, 2, 'two closed 4h buckets');
  assert.strictEqual(htf[0].time, 0, 'bucket0 starts at boundary 0');
  assert.strictEqual(htf[0].open, c[0].open, 'bucket0 open = first');
  assert.strictEqual(htf[0].close, c[3].close, 'bucket0 close = last of [0,4h)');
  assert.strictEqual(htf[0].high, Math.max(c[0].high, c[1].high, c[2].high, c[3].high), 'bucket0 high = max');
  assert.strictEqual(htf[0].low, Math.min(c[0].low, c[1].low, c[2].low, c[3].low), 'bucket0 low = min');
  assert.strictEqual(htf[0].volume, 4, 'bucket0 volume = sum');
  assert.strictEqual(htf[1].time, 4 * HOUR, 'bucket1 starts at 4h boundary');
  assert.strictEqual(htf[1].close, c[7].close, 'bucket1 close = last of [4h,8h)');
  ok('4:1 aggregation, closed-only, OHLCV');
}

// --- calendar alignment: candles NOT starting on a boundary ---
{
  // times 2h..10h. floor(t/4h)*4h → bucket0 key=0 holds {2h,3h}; bucket4h holds {4..7h};
  // bucket8h (8..10h) open → dropped. So bucket0 is a PARTIAL leading bucket but is still
  // closed (a later bucket exists). Proves alignment by calendar, not by array index.
  const c = [];
  for (let i = 2; i <= 10; i++) c.push(mk(i * HOUR, 10, 20, 5, 12));
  const htf = aggregateHTF(c, 4);
  assert.strictEqual(htf.length, 2, 'two closed buckets (0 and 4h)');
  assert.strictEqual(htf[0].time, 0, 'leading bucket aligned to boundary 0');
  assert.strictEqual(htf[0].volume, 2, 'leading bucket has only the 2 candles in [0,4h)');
  assert.strictEqual(htf[1].time, 4 * HOUR, 'second bucket aligned to 4h');
  ok('calendar alignment (partial leading bucket)');
}

// --- modal step inference survives a gap ---
{
  // hourly with one missing hour; modal delta is still 1h.
  const times = [0, 1, 2, 3, 5, 6, 7, 8].map(h => h * HOUR);
  const c = times.map(t => mk(t, 10, 20, 5, 12));
  const htf = aggregateHTF(c, 4);
  // buckets: [0,4h) = {0,1,2,3} closed by t=5h; [4h,8h) = {5,6,7} closed by t=8h; [8h,..) open.
  assert.strictEqual(htf.length, 2, 'gap does not break step inference');
  assert.strictEqual(htf[0].time, 0);
  assert.strictEqual(htf[1].time, 4 * HOUR);
  ok('modal step inference with gap');
}

// --- guards: too few candles / bad ratio → [] ---
{
  assert.deepStrictEqual(aggregateHTF([], 4), [], 'empty → []');
  assert.deepStrictEqual(aggregateHTF([mk(0, 1, 1, 1, 1)], 4), [], 'single candle → []');
  assert.deepStrictEqual(aggregateHTF([mk(0, 1, 1, 1, 1), mk(HOUR, 1, 1, 1, 1)], 0), [], 'ratio 0 → []');
  ok('guards → []');
}

console.log(`\n${passed} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_aggregate_htf.mjs`
Expected: FAIL — `Cannot find module '.../src/core/aggregateHTF.js'`.

- [ ] **Step 3: Write the implementation**

```js
// src/core/aggregateHTF.js

/** Modal (most frequent) positive delta between consecutive candle times, in ms. */
function inferStepMs(candles) {
  const counts = new Map();
  for (let i = 1; i < candles.length; i++) {
    const d = candles[i].time - candles[i - 1].time;
    if (d > 0) counts.set(d, (counts.get(d) || 0) + 1);
  }
  let best = 0, bestN = -1;
  for (const [d, n] of counts) if (n > bestN) { bestN = n; best = d; }
  return best;
}

const startBar = (time, c) => ({
  time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume || 0,
});
function extendBar(bar, c) {
  if (c.high > bar.high) bar.high = c.high;
  if (c.low < bar.low) bar.low = c.low;
  bar.close = c.close;
  bar.volume += c.volume || 0;
}

/**
 * Resample ascending LTF candles into higher-timeframe candles.
 * Calendar-aligned (buckets keyed by floor(time/htfMs)*htfMs) and CLOSED-ONLY:
 * the final, still-forming bucket is intentionally excluded (no repaint/look-ahead).
 *
 * @param {import('./contracts.js').Candle[]} candles ascending by time
 * @param {number} ratio LTF→HTF multiple (e.g. 4 for 1H→4H). Rounded to an integer >= 1.
 * @returns {import('./contracts.js').Candle[]} closed HTF candles, ascending
 */
export function aggregateHTF(candles, ratio) {
  if (!Array.isArray(candles) || candles.length < 2) return [];
  const r = Math.round(ratio);
  if (!(r >= 1)) return [];
  const ltfMs = inferStepMs(candles);
  if (!(ltfMs > 0)) return [];
  const htfMs = r * ltfMs;

  const out = [];
  let cur = null, curKey = null;
  for (const c of candles) {
    const key = Math.floor(c.time / htfMs) * htfMs;
    if (curKey === null) { curKey = key; cur = startBar(key, c); continue; }
    if (key === curKey) { extendBar(cur, c); continue; }
    out.push(cur);          // a later bucket started → current bucket is closed
    curKey = key;
    cur = startBar(key, c);
  }
  // `cur` is the final, possibly-open bucket → dropped (closed-only).
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_aggregate_htf.mjs`
Expected: PASS — `4 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/core/aggregateHTF.js tests/test_aggregate_htf.mjs
git commit -m "$(cat <<'EOF'
feat(core): aggregateHTF — calendar-aligned, closed-only LTF→HTF resampler

Pure resampler for the HTF filter measurement (Spec 3). Buckets keyed by
floor(time/htfMs)*htfMs so HTF bars match calendar boundaries; the final
forming bucket is dropped to avoid repaint/look-ahead. Modal-delta step
inference survives gaps. Reused later by the live gate.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `classifyHTFTrend` — three trend definitions

**Files:**
- Create: `src/core/classifyHTFTrend.js`
- Test: `tests/test_classify_htf_trend.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/test_classify_htf_trend.mjs
import assert from 'node:assert';
import { classifyHTFTrend } from '../src/core/classifyHTFTrend.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

const mk = (c) => ({ time: 0, open: c, high: c + 1, low: c - 1, close: c, volume: 1 });

// --- insufficient data → all NEUTRAL ---
{
  const htf = Array.from({ length: 10 }, (_, i) => mk(100 + i));
  const v = classifyHTFTrend(htf, { emaPeriod: 50 });
  assert.strictEqual(v.emaBand, 'NEUTRAL');
  assert.strictEqual(v.emaSlope, 'NEUTRAL');
  assert.strictEqual(v.adxRegime, 'NEUTRAL');
  ok('insufficient data → all NEUTRAL');
}

// --- strong uptrend: close well above EMA, EMA rising, ADX high → UP across defs ---
{
  // 80 bars rising by 2 each → last close far above EMA50; steady positive slope.
  const htf = Array.from({ length: 80 }, (_, i) => mk(100 + i * 2));
  const v = classifyHTFTrend(htf, { emaPeriod: 50, band: 0.005, slopeLookback: 5, slopeThreshold: 0.002, adxPeriod: 14, adxThreshold: 25 });
  assert.strictEqual(v.emaBand, 'UP', 'emaBand UP');
  assert.strictEqual(v.emaSlope, 'UP', 'emaSlope UP');
  assert.strictEqual(v.adxRegime, 'UP', 'adxRegime UP (trend present)');
  ok('strong uptrend → UP across all three');
}

// --- strong downtrend → DOWN across defs ---
{
  const htf = Array.from({ length: 80 }, (_, i) => mk(300 - i * 2));
  const v = classifyHTFTrend(htf, { emaPeriod: 50, band: 0.005, slopeLookback: 5, slopeThreshold: 0.002, adxPeriod: 14, adxThreshold: 25 });
  assert.strictEqual(v.emaBand, 'DOWN', 'emaBand DOWN');
  assert.strictEqual(v.emaSlope, 'DOWN', 'emaSlope DOWN');
  assert.strictEqual(v.adxRegime, 'DOWN', 'adxRegime DOWN');
  ok('strong downtrend → DOWN across all three');
}

// --- flat market → all NEUTRAL (band + flat slope + low ADX) ---
{
  const htf = Array.from({ length: 80 }, () => mk(100));
  const v = classifyHTFTrend(htf, { emaPeriod: 50, band: 0.005, slopeLookback: 5, slopeThreshold: 0.002, adxPeriod: 14, adxThreshold: 25 });
  assert.strictEqual(v.emaBand, 'NEUTRAL', 'flat: close == EMA → NEUTRAL');
  assert.strictEqual(v.emaSlope, 'NEUTRAL', 'flat: zero slope → NEUTRAL');
  assert.strictEqual(v.adxRegime, 'NEUTRAL', 'flat: no trend → NEUTRAL');
  ok('flat market → all NEUTRAL');
}

console.log(`\n${passed} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_classify_htf_trend.mjs`
Expected: FAIL — `Cannot find module '.../src/core/classifyHTFTrend.js'`.

- [ ] **Step 3: Write the implementation**

```js
// src/core/classifyHTFTrend.js
import { Technicals } from '../indicators/technical.js';

/** close vs EMA with a neutral band. */
function emaBandVerdict(htf, emaPeriod, band) {
  const closes = htf.map((c) => c.close);
  const ema = Technicals.ema(closes, emaPeriod);
  if (!ema.length) return 'NEUTRAL';
  const e = ema[ema.length - 1];
  const close = closes[closes.length - 1];
  if (close > e * (1 + band)) return 'UP';
  if (close < e * (1 - band)) return 'DOWN';
  return 'NEUTRAL';
}

/** EMA slope over `lookback` HTF bars, with a neutral threshold. */
function emaSlopeVerdict(htf, emaPeriod, lookback, threshold) {
  const closes = htf.map((c) => c.close);
  const ema = Technicals.ema(closes, emaPeriod);
  if (ema.length <= lookback) return 'NEUTRAL';
  const now = ema[ema.length - 1];
  const past = ema[ema.length - 1 - lookback];
  if (!(past > 0)) return 'NEUTRAL';
  const slope = (now - past) / past;
  if (slope > threshold) return 'UP';
  if (slope < -threshold) return 'DOWN';
  return 'NEUTRAL';
}

/** Wilder ADX over HTF bars; returns the latest ADX or null if insufficient data. */
function computeADX(htf, period) {
  const n = htf.length;
  if (n < period * 2 + 1) return null;
  const tr = [], plusDM = [], minusDM = [];
  for (let i = 1; i < n; i++) {
    const h = htf[i].high, l = htf[i].low;
    const pc = htf[i - 1].close, ph = htf[i - 1].high, pl = htf[i - 1].low;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    const up = h - ph, down = pl - l;
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
  }
  const smooth = (arr) => {
    let s = 0;
    for (let i = 0; i < period; i++) s += arr[i];
    const out = [s];
    for (let i = period; i < arr.length; i++) { s = s - s / period + arr[i]; out.push(s); }
    return out;
  };
  const trS = smooth(tr), pdS = smooth(plusDM), mdS = smooth(minusDM);
  const dx = [];
  for (let i = 0; i < trS.length; i++) {
    if (!(trS[i] > 0)) { dx.push(0); continue; }
    const pdi = 100 * pdS[i] / trS[i];
    const mdi = 100 * mdS[i] / trS[i];
    const denom = pdi + mdi;
    dx.push(denom === 0 ? 0 : 100 * Math.abs(pdi - mdi) / denom);
  }
  if (dx.length < period) return null;
  let adx = 0;
  for (let i = 0; i < period; i++) adx += dx[i];
  adx /= period;
  for (let i = period; i < dx.length; i++) adx = (adx * (period - 1) + dx[i]) / period;
  return adx;
}

/** ADX gate: range (ADX < threshold) → NEUTRAL; else direction from emaBand. */
function adxRegimeVerdict(htf, emaPeriod, band, adxPeriod, adxThreshold) {
  const adx = computeADX(htf, adxPeriod);
  if (adx == null || adx < adxThreshold) return 'NEUTRAL';
  return emaBandVerdict(htf, emaPeriod, band);
}

/**
 * Classify the HTF trend three ways. NEUTRAL is the over-filter safeguard:
 * in a range every definition returns NEUTRAL so both trade sides pass.
 *
 * @param {import('./contracts.js').Candle[]} htf closed HTF candles, ascending
 * @param {object} [opts]
 * @param {number} [opts.emaPeriod=50]
 * @param {number} [opts.band=0.005] neutral band fraction for emaBand
 * @param {number} [opts.slopeLookback=5] HTF bars for emaSlope
 * @param {number} [opts.slopeThreshold=0.002] neutral threshold for emaSlope
 * @param {number} [opts.adxPeriod=14]
 * @param {number} [opts.adxThreshold=25]
 * @returns {{emaBand:'UP'|'DOWN'|'NEUTRAL', emaSlope:'UP'|'DOWN'|'NEUTRAL', adxRegime:'UP'|'DOWN'|'NEUTRAL'}}
 */
export function classifyHTFTrend(htf, opts = {}) {
  const {
    emaPeriod = 50, band = 0.005,
    slopeLookback = 5, slopeThreshold = 0.002,
    adxPeriod = 14, adxThreshold = 25,
  } = opts;
  if (!Array.isArray(htf) || htf.length === 0) {
    return { emaBand: 'NEUTRAL', emaSlope: 'NEUTRAL', adxRegime: 'NEUTRAL' };
  }
  return {
    emaBand: emaBandVerdict(htf, emaPeriod, band),
    emaSlope: emaSlopeVerdict(htf, emaPeriod, slopeLookback, slopeThreshold),
    adxRegime: adxRegimeVerdict(htf, emaPeriod, band, adxPeriod, adxThreshold),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_classify_htf_trend.mjs`
Expected: PASS — `5 checks passed`.

If `adxRegime` UP/DOWN assertions fail because the synthetic ramp produces an ADX
just under 25, that is a fixture-tuning issue, not a logic bug: increase the ramp
slope (e.g. `i * 4`) so directional movement dominates, OR lower the test's
`adxThreshold` to 20. Do NOT change the default in the implementation.

- [ ] **Step 5: Commit**

```bash
git add src/core/classifyHTFTrend.js tests/test_classify_htf_trend.mjs
git commit -m "$(cat <<'EOF'
feat(core): classifyHTFTrend — emaBand / emaSlope / adxRegime trend verdicts

Pure HTF trend classifier returning all three definitions in one call.
NEUTRAL is the over-filter safeguard (range → both sides pass). adxRegime
implements the research-backed regime gate (ADX < threshold → NEUTRAL) that
protects counter-trend/scalp strategies. Reuses Technicals.ema; Wilder ADX
implemented inline. Reused later by the live gate.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `analyze-htf-filter.js` — analyzer (pure `analyzeTrades` + CLI)

**Files:**
- Create: `scripts/analyze-htf-filter.js`
- Test: `tests/test_analyze_htf_filter.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/test_analyze_htf_filter.mjs
import assert from 'node:assert';
import { analyzeTrades } from '../scripts/analyze-htf-filter.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

const HOUR = 3600000;
const mk = (t, c) => ({ time: t, open: c, high: c + 1, low: c - 1, close: c, volume: 1 });

// 80 rising HTF bars (closes 100,102,...) → emaBand at the last bar = UP.
const htf = Array.from({ length: 80 }, (_, i) => mk(i * 4 * HOUR, 100 + i * 2));
const lastTime = htf[htf.length - 1].time;

// Two trades at the last bar's time: a BUY (+5) and a SELL (-3).
const trades = [
  { side: 'BUY', entryTime: lastTime, pnl: 5 },
  { side: 'SELL', entryTime: lastTime, pnl: -3 },
];

const res = analyzeTrades(trades, htf, { emaPeriod: 50, band: 0.005, adxPeriod: 14, adxThreshold: 25 });

// Every definition must conserve trade count and PnL.
for (const def of ['emaBand', 'emaSlope', 'adxRegime']) {
  const b = res[def];
  const count = b.with.count + b.against.count + b.neutral.count;
  const pnl = b.with.pnl + b.against.pnl + b.neutral.pnl;
  assert.strictEqual(count, 2, `${def}: counts sum to trades`);
  assert.ok(Math.abs(pnl - 2) < 1e-9, `${def}: pnl conserved (5 + -3 = 2)`);
}
ok('count and PnL conserved across all definitions');

// emaBand is the reliable one for a rising series: BUY=with, SELL=against.
assert.strictEqual(res.emaBand.with.count, 1, 'emaBand: BUY in UP → with');
assert.strictEqual(res.emaBand.with.pnl, 5);
assert.strictEqual(res.emaBand.with.wins, 1, 'BUY +5 counts as a win');
assert.strictEqual(res.emaBand.against.count, 1, 'emaBand: SELL in UP → against');
assert.strictEqual(res.emaBand.against.pnl, -3);
assert.strictEqual(res.emaBand.against.wins, 0);
ok('emaBand buckets BUY=with / SELL=against in an uptrend');

// A trade before the first HTF bar → neutral (no closed HTF bar yet).
const early = analyzeTrades([{ side: 'BUY', entryTime: -1, pnl: 1 }], htf, {});
assert.strictEqual(early.emaBand.neutral.count, 1, 'pre-history trade → neutral');
ok('trade before first HTF bar → neutral');

console.log(`\n${passed} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_analyze_htf_filter.mjs`
Expected: FAIL — `Cannot find module '.../scripts/analyze-htf-filter.js'` (or `analyzeTrades is not a function`).

- [ ] **Step 3: Write the implementation**

```js
// scripts/analyze-htf-filter.js
import path from 'path';
import { fileURLToPath } from 'url';
import { aggregateHTF } from '../src/core/aggregateHTF.js';
import { classifyHTFTrend } from '../src/core/classifyHTFTrend.js';

const DEFS = ['emaBand', 'emaSlope', 'adxRegime'];

/** Index of the last HTF bar with time <= entryTime, or -1 if none. (htf ascending) */
function lastClosedIndex(htf, entryTime) {
  let j = -1;
  for (let i = 0; i < htf.length; i++) {
    if (htf[i].time <= entryTime) j = i; else break;
  }
  return j;
}

/** with/against/neutral bucket for a side given an UP/DOWN/NEUTRAL verdict. */
function bucketOf(side, verdict) {
  if (verdict === 'NEUTRAL') return 'neutral';
  if (verdict === 'UP') return side === 'BUY' ? 'with' : 'against';
  return side === 'SELL' ? 'with' : 'against'; // DOWN
}

/**
 * Classify each trade's entry against the HTF trend (all three definitions) and tally
 * count / PnL / wins per with-against-neutral bucket. Pure and deterministic.
 *
 * @param {{side:'BUY'|'SELL', entryTime:number, pnl:number}[]} trades
 * @param {import('../src/core/contracts.js').Candle[]} htf closed HTF candles
 * @param {object} [opts] classifyHTFTrend options
 * @returns {Record<'emaBand'|'emaSlope'|'adxRegime', Record<'with'|'against'|'neutral', {count:number,pnl:number,wins:number}>>}
 */
export function analyzeTrades(trades, htf, opts = {}) {
  const z = () => ({ count: 0, pnl: 0, wins: 0 });
  const blank = () => ({ with: z(), against: z(), neutral: z() });
  const res = { emaBand: blank(), emaSlope: blank(), adxRegime: blank() };

  for (const t of trades) {
    const j = lastClosedIndex(htf, t.entryTime);
    const verdicts = j < 0
      ? { emaBand: 'NEUTRAL', emaSlope: 'NEUTRAL', adxRegime: 'NEUTRAL' }
      : classifyHTFTrend(htf.slice(0, j + 1), opts);
    for (const def of DEFS) {
      const cell = res[def][bucketOf(t.side, verdicts[def])];
      cell.count += 1;
      cell.pnl += t.pnl;
      if (t.pnl > 0) cell.wins += 1;
    }
  }
  return res;
}

/** Format one definition's tally as printable lines. */
export function formatTally(label, def, tally, startEquity) {
  const pct = (x) => (startEquity > 0 ? (x / startEquity * 100).toFixed(2) + '%' : x.toFixed(2));
  const wr = (cell) => (cell.count > 0 ? Math.round(cell.wins / cell.count * 100) + '%' : '—');
  const line = (name, cell) =>
    `  ${name.padEnd(8)} ${String(cell.count).padStart(4)}  PnL ${pct(cell.pnl).padStart(8)}  WR ${wr(cell)}`;
  return [
    `${label} [${def}]:`,
    line('with', tally.with),
    line('against', tally.against),
    line('neutral', tally.neutral),
  ].join('\n');
}

async function main() {
  // Lazy imports so the unit test never loads sqlite/backtest machinery.
  const { parseArgs } = await import('../backtest/download-data.js');
  const { simulate } = await import('../src/backtest/simulator.js');
  const { buildGuardrails, buildCosts } = await import('../backtest/run-backtest.js');
  const { openMarketDb } = await import('../src/data/marketDataSchema.js');
  const { MarketDataRepo } = await import('../src/data/MarketDataRepo.js');

  const args = parseArgs(process.argv.slice(2));
  const symbol = String(args.symbol || 'BTCUSDT');
  const tf = String(args.tf || '1H');
  const logicType = String(args.logic || 'SMC');
  const lookback = args.lookback != null ? Number(args.lookback) : 250;
  const ratio = args.ratio != null ? Number(args.ratio) : 4;
  const opts = {
    emaPeriod: args.emaPeriod != null ? Number(args.emaPeriod) : 50,
    band: args.band != null ? Number(args.band) : 0.005,
    slopeLookback: args.slopeLookback != null ? Number(args.slopeLookback) : 5,
    slopeThreshold: args.slopeThreshold != null ? Number(args.slopeThreshold) : 0.002,
    adxPeriod: args.adxPeriod != null ? Number(args.adxPeriod) : 14,
    adxThreshold: args.adxThreshold != null ? Number(args.adxThreshold) : 25,
  };

  const marketDb = await openMarketDb(path.join(process.cwd(), 'market_data.db'));
  const marketRepo = new MarketDataRepo(marketDb);
  const candles = await marketRepo.getCandles(symbol, tf, 0, Number.MAX_SAFE_INTEGER);
  const spec = await marketRepo.getContractSpec(symbol);
  await marketDb.close();

  if (candles.length < lookback + 2) {
    throw new Error(`Not enough candles for ${symbol} ${tf}: ${candles.length} (need > ${lookback + 1}).`);
  }

  const guardrails = buildGuardrails(args, spec);
  const costs = buildCosts(args, spec);
  const sim = simulate({
    candles, config: { logicType, logic: {} }, guardrails, costs,
    symbol, timeframe: tf, lookback, startEquity: guardrails.portfolioValue,
  });

  const htf = aggregateHTF(candles, ratio);
  const res = analyzeTrades(sim.trades, htf, opts);
  const label = `${logicType} ${symbol} ${tf} (HTF=${ratio}x, ${htf.length} bars, ${sim.trades.length} trades)`;

  console.log('\n══════════ HTF FILTER MEASUREMENT ══════════');
  console.log(label);
  for (const def of DEFS) {
    console.log(formatTally(label, def, res[def], guardrails.portfolioValue));
  }
  console.log('════════════════════════════════════════════');
}

// Run only when invoked directly (Windows-safe).
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((e) => { console.error('[analyze-htf-filter] FAILED:', e.message); process.exit(1); });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_analyze_htf_filter.mjs`
Expected: PASS — `3 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/analyze-htf-filter.js tests/test_analyze_htf_filter.mjs
git commit -m "$(cat <<'EOF'
feat(scripts): analyze-htf-filter — measure with/against/neutral per strategy

Post-processing analyzer (Spec 3). Pure analyzeTrades classifies each backtest
trade's entry against the HTF trend (all three definitions) and tallies count /
PnL / win-rate per with-against-neutral bucket. Thin CLI runs simulate() on
market_data.db and prints the tables. No change to any decision path.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Run the measurement + record findings

**Files:**
- Create/append: `docs/research/2026-06-06-htf-filter-measurement.md`

- [ ] **Step 1: Confirm available data**

Run: `node -e "import('./src/data/marketDataSchema.js').then(async m => { const db = await m.openMarketDb('market_data.db'); const r = await db.all('SELECT symbol, timeframe, COUNT(*) n FROM candles GROUP BY symbol, timeframe ORDER BY n DESC'); console.log(r); await db.close(); })"`
Expected: a list of `{symbol, timeframe, n}` rows. Note which (symbol, tf) pairs have the most candles — pick 2-3 with the deepest history (need ≳ `lookback + emaPeriod*ratio` LTF candles for a non-NEUTRAL HTF verdict).

- [ ] **Step 2: Run the analyzer per strategy on the deepest dataset**

For each available logicType that the dataset supports, run (substituting the chosen symbol/tf, e.g. BTCUSDT 1H):

```bash
node scripts/analyze-htf-filter.js --logic SMC --symbol BTCUSDT --tf 1H --ratio 4
node scripts/analyze-htf-filter.js --logic BREAKOUT --symbol BTCUSDT --tf 1H --ratio 4
node scripts/analyze-htf-filter.js --logic REVERSAL --symbol BTCUSDT --tf 1H --ratio 4
node scripts/analyze-htf-filter.js --logic VMC_CIPHERB --symbol BTCUSDT --tf 1H --ratio 4
```

Expected: a `HTF FILTER MEASUREMENT` block per run with three definition tables.
Capture the printed numbers.

- [ ] **Step 3: Record findings**

Create `docs/research/2026-06-06-htf-filter-measurement.md` with:
- One section per strategy: the three definition tables (paste the analyzer output).
- For each strategy, a one-line verdict using this rule:
  - **enable rigid gate** if `against` is a large share AND its PnL is clearly negative
    (filtering removes mostly losers);
  - **needs regime-aware (adxRegime)** if `emaBand against` is large but *profitable*,
    while `adxRegime` reclassifies most of it to `neutral` (range);
  - **leave off** if `against` is small or filtering would remove net-positive trades
    under all three definitions.
- A "Recommended gate definition per strategy" summary table (strategy → emaBand /
  emaSlope / adxRegime / off) to drive the future gate spec.

- [ ] **Step 4: Update the knowledge graph**

Run: `graphify update .`
Expected: graph updated (AST-only, no API cost).

- [ ] **Step 5: Commit**

```bash
git add docs/research/2026-06-06-htf-filter-measurement.md graphify-out
git commit -m "$(cat <<'EOF'
docs(research): HTF filter measurement results per strategy

Measured with/against/neutral split and PnL for each strategy under all three
HTF trend definitions on the deepest available dataset. Includes a recommended
gate-definition-per-strategy summary to drive the future live-gate spec.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- aggregateHTF (calendar-aligned, closed-only, modal-delta) → Task 1 ✓
- classifyHTFTrend (emaBand/emaSlope/adxRegime, NEUTRAL safeguard, edge→NEUTRAL) → Task 2 ✓
- analyzer post-processing (last-closed bar, with/against/neutral, count+PnL+WR) → Task 3 ✓
- run + research note (per-strategy tables + recommendation) → Task 4 ✓
- "no change to decision path" → enforced: no task edits pipeline/RiskPolicy/simulator ✓
- "two helpers reused by the gate" → aggregateHTF & classifyHTFTrend live in src/core ✓

**Placeholder scan:** none — every code step has complete code; every run step has an exact command + expected output. Task 4 Steps 1-3 are intentionally data-dependent (the numbers are produced by the run), with an explicit decision rule rather than a placeholder.

**Type consistency:** `aggregateHTF(candles, ratio)` → Candle[]; consumed by `classifyHTFTrend(htf, opts)` and `analyzeTrades(trades, htf, opts)`. Verdict keys `emaBand/emaSlope/adxRegime` and bucket keys `with/against/neutral` are identical across Task 2, Task 3, tests, and the formatter. Trade shape `{side, entryTime, pnl}` matches `simulator.js` trade records (`side`, `entryTime`, `pnl` all present). ✓
