# B+ Scalp-Breakout Concept-Proof — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure whether the ProScalping breakout setup (minus order book, with all candle-observable rules) has a positive after-cost edge on volatile alts, on a rolling no-look-ahead daily universe.

**Architecture:** Pure modules (`score`, `historicalUniverse`, `scalpBreakout`, `universeGate`) + thin I/O (futures downloader, sweep driver). The rolling universe is modeled as a `withUniverseGate` decorator over `evaluateBar` — same pattern as `withHtfGate`. Exits are a swept dimension: arm A (structural stop + TP 2R + no-impulse time-stop) and arm B (structural stop + channel trailing). `bot_engine.js` untouched; all simulator changes additive and gated on opt-in `exitPolicy` flags.

**Tech Stack:** Node ESM, `sqlite`/`sqlite3`, existing `simulate()` / `RiskPolicy` / `MarketDataRepo` / Binance klines fetch.

**Commit trailer (every commit):** `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

## File Structure

- Create `src/screener/score.js` — pure rank-composite selection (shared with screener spec).
- Create `src/backtest/historicalUniverse.js` — pure daily-stats + rolling picks (no look-ahead).
- Create `src/indicators/scalpBreakout.js` — pure breakout setup.
- Modify `src/core/SignalAdapter.js` + `src/indicators/index.js` — wire `SCALPBREAKOUT`.
- Create `src/backtest/universeGate.js` — `withUniverseGate` decorator.
- Modify `src/backtest/simulator.js` — add no-impulse time-stop (block 3d).
- Modify `src/data/marketParse.js` — parametrize candle base (spot/futures).
- Create `backtest/download-futures-universe.mjs` — fetch top-N alt perps + download klines.
- Create `backtest/run-bplus-scout.mjs` — sweep driver + gate + majors control.
- Create tests: `tests/test_screener_score.mjs`, `test_historical_universe.mjs`, `test_scalp_breakout.mjs`, `test_scalp_breakout_signal.mjs`, `test_universe_gate.mjs`, `test_time_stop.mjs`.

---

### Task 1: `score.js` — rank-composite selection (pure)

**Files:**
- Create: `src/screener/score.js`
- Test: `tests/test_screener_score.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/test_screener_score.mjs
import assert from 'node:assert';
import { scoreUniverse } from '../src/screener/score.js';
let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

const rows = [
  { symbol: 'A', volatility: 0.10, momentum: 0.50, liquidity: 100e6 },
  { symbol: 'B', volatility: 0.02, momentum: 0.05, liquidity: 5e6 },   // below floor
  { symbol: 'C', volatility: 0.08, momentum: 0.30, liquidity: 50e6 },
  { symbol: 'D', volatility: 0.20, momentum: 0.40, liquidity: 30e6 },
];
const picks = scoreUniverse(rows, { minLiquidity: 10e6, topN: 2 });
assert.strictEqual(picks.length, 2, 'topN respected'); ok('topN cap');
assert.ok(!picks.find(r => r.symbol === 'B'), 'liquidity floor excludes B'); ok('liquidity floor');
assert.strictEqual(picks[0].rank, 1, 'rank assigned'); ok('rank assigned');
assert.ok(picks.every(r => r.score >= 0 && r.score <= 1), 'score in 0..1'); ok('score bounded');
// denylist
const p2 = scoreUniverse(rows, { minLiquidity: 0, denylist: ['A'], topN: 5 });
assert.ok(!p2.find(r => r.symbol === 'A'), 'denylist excludes A'); ok('denylist');

console.log(`\n${p} checks passed`);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/test_screener_score.mjs`
Expected: FAIL — `Cannot find module '../src/screener/score.js'`.

- [ ] **Step 3: Implement**

```javascript
// src/screener/score.js
/** Midrank percentile in [0,1]; ties share the midpoint. n<=1 → 0.5. */
function pctRank(values, v) {
  let less = 0, eq = 0;
  for (const x of values) { if (x < v) less++; else if (x === v) eq++; }
  const n = values.length;
  if (n <= 1) return 0.5;
  return (less + 0.5 * (eq - 1)) / (n - 1);
}

/**
 * Rank-composite universe selection. Pure. Rows carry pre-computed metrics.
 * @param {{symbol:string, volatility:number, momentum:number, liquidity:number}[]} rows
 * @param {{minLiquidity?:number, denylist?:string[], topN?:number, weights?:{vol:number,mom:number,liq:number}}} [opts]
 * @returns {{symbol:string, score:number, rank:number, volatility:number, momentum:number, liquidity:number}[]}
 */
export function scoreUniverse(rows, opts = {}) {
  const { minLiquidity = 0, denylist = [], topN = 15,
          weights = { vol: 0.5, mom: 0.3, liq: 0.2 } } = opts;
  const deny = new Set(denylist);
  const survivors = rows.filter(r => r.liquidity >= minLiquidity && !deny.has(r.symbol));
  if (survivors.length === 0) return [];
  const vols = survivors.map(r => r.volatility);
  const moms = survivors.map(r => r.momentum);
  const liqs = survivors.map(r => r.liquidity);
  const scored = survivors.map(r => ({
    symbol: r.symbol, volatility: r.volatility, momentum: r.momentum, liquidity: r.liquidity,
    score: weights.vol * pctRank(vols, r.volatility)
         + weights.mom * pctRank(moms, r.momentum)
         + weights.liq * pctRank(liqs, r.liquidity),
  }));
  scored.sort((a, b) => (b.score - a.score) || (b.liquidity - a.liquidity));
  return scored.slice(0, topN).map((r, i) => ({ ...r, rank: i + 1 }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/test_screener_score.mjs`
Expected: PASS — `5 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/screener/score.js tests/test_screener_score.mjs
git commit -m "feat(screener): rank-composite scoreUniverse (pure, shared core)"
```

---

### Task 2: `historicalUniverse.js` — rolling picks, no look-ahead (pure)

**Files:**
- Create: `src/backtest/historicalUniverse.js`
- Test: `tests/test_historical_universe.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/test_historical_universe.mjs
import assert from 'node:assert';
import { dayKey, dailyStats, buildPicksByDay } from '../src/backtest/historicalUniverse.js';
let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

const D1 = Date.UTC(2025, 0, 1, 0, 0), DAY = 86400000;
// helper: one candle
const c = (t, o, h, l, cl, v) => ({ time: t, open: o, high: h, low: l, close: cl, volume: v });

assert.strictEqual(dayKey(D1), '2025-01-01', 'dayKey UTC'); ok('dayKey');

const candles = [
  c(D1, 10, 12, 9, 11, 100),         // day 1
  c(D1 + 3600000, 11, 13, 10, 12, 50),
  c(D1 + DAY, 12, 14, 11, 13, 200),  // day 2
];
const ds = dailyStats(candles);
assert.strictEqual(ds.length, 2, 'two days'); ok('dailyStats groups by day');
assert.ok(Math.abs(ds[0].volatility - (13 - 9) / 9) < 1e-9, 'day1 volatility = (hi-lo)/lo'); ok('volatility');

// buildPicksByDay: day D picks use D-1 stats only (no look-ahead)
const sym = {
  HOT: [c(D1, 1, 2, 1, 2, 1e6), c(D1 + DAY, 2, 2.1, 1.9, 2, 1e6)],   // big day-1 move
  FLAT: [c(D1, 1, 1.01, 0.99, 1, 1e6), c(D1 + DAY, 1, 1.01, 0.99, 1, 1e6)],
};
const picks = buildPicksByDay(sym, { minLiquidity: 0, topN: 1 });
assert.deepStrictEqual(picks['2025-01-02'], ['HOT'], 'day-2 picks from day-1 stats, HOT wins'); ok('rolling no-look-ahead pick');
assert.ok(picks['2025-01-01'] === undefined, 'first day has no prior → no picks'); ok('no pick on first day');

console.log(`\n${p} checks passed`);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/test_historical_universe.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```javascript
// src/backtest/historicalUniverse.js
import { scoreUniverse } from '../screener/score.js';

/** UTC date key 'YYYY-MM-DD' from epoch ms. */
export function dayKey(ms) { return new Date(ms).toISOString().slice(0, 10); }

/**
 * Aggregate candles into per-UTC-day stats. Pure.
 * @param {{time:number,open:number,high:number,low:number,close:number,volume:number}[]} candles ascending
 * @returns {{dayKey:string, volatility:number, momentum:number, liquidity:number}[]}
 */
export function dailyStats(candles) {
  const byDay = new Map();
  for (const c of candles) {
    const k = dayKey(c.time);
    let d = byDay.get(k);
    if (!d) { d = { dayKey: k, open: c.open, high: c.high, low: c.low, close: c.close, quoteVol: 0 }; byDay.set(k, d); }
    if (c.high > d.high) d.high = c.high;
    if (c.low < d.low) d.low = c.low;
    d.close = c.close;
    d.quoteVol += c.volume * c.close; // notional approximation
  }
  return [...byDay.values()].map(d => ({
    dayKey: d.dayKey,
    volatility: d.low > 0 ? (d.high - d.low) / d.low : 0,
    momentum: d.open > 0 ? Math.abs(d.close - d.open) / d.open : 0,
    liquidity: d.quoteVol,
  }));
}

/**
 * Rolling daily picks with NO look-ahead: day D's shortlist is scored from each symbol's
 * PRIOR day (D-1) stats. Pure.
 * @param {Record<string, object[]>} symbolCandles symbol → ascending candles
 * @param {object} [opts] passed to scoreUniverse (minLiquidity, denylist, topN, weights)
 * @returns {Record<string, string[]>} dayKey → array of selected symbols
 */
export function buildPicksByDay(symbolCandles, opts = {}) {
  const perSym = {};
  const allDays = new Set();
  for (const [sym, cs] of Object.entries(symbolCandles)) {
    const m = new Map();
    for (const d of dailyStats(cs)) { m.set(d.dayKey, d); allDays.add(d.dayKey); }
    perSym[sym] = m;
  }
  const days = [...allDays].sort();
  const picks = {};
  for (let i = 1; i < days.length; i++) {
    const D = days[i], prev = days[i - 1];
    const rows = [];
    for (const [sym, m] of Object.entries(perSym)) {
      const s = m.get(prev);
      if (s) rows.push({ symbol: sym, volatility: s.volatility, momentum: s.momentum, liquidity: s.liquidity });
    }
    picks[D] = scoreUniverse(rows, opts).map(r => r.symbol);
  }
  return picks;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/test_historical_universe.mjs`
Expected: PASS — `6 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/backtest/historicalUniverse.js tests/test_historical_universe.mjs
git commit -m "feat(backtest): rolling no-look-ahead daily universe from candles"
```

---

### Task 3: `scalpBreakout.js` — breakout setup (pure)

**Files:**
- Create: `src/indicators/scalpBreakout.js`
- Test: `tests/test_scalp_breakout.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/test_scalp_breakout.mjs
import assert from 'node:assert';
import ScalpBreakout from '../src/indicators/scalpBreakout.js';
import { SIDE } from '../src/core/contracts.js';
let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

const bar = (h, l, c) => ({ time: 0, open: (h + l) / 2, high: h, low: l, close: c, volume: 1 });
// 30 prior bars hugging resistance ~100 (multiple touches, tight pinch), then a breakout bar.
const prior = [];
for (let i = 0; i < 30; i++) prior.push(bar(100, 99, 99.5)); // touches res=100 repeatedly, tight band
const cfg = { lookback: 30, minTouches: 2, touchTol: 0.0015, breakoutMargin: 0.0005, pinchBars: 6, pinchRatio: 2 };

const breakoutUp = [...prior, bar(101, 99.6, 100.8)]; // close 100.8 > 100*(1.0005)
let r = ScalpBreakout.execute(breakoutUp, cfg);
assert.strictEqual(r.side, SIDE.BUY, 'breakout up → BUY'); ok('BUY on upside breakout');
assert.strictEqual(r.invalidation, 100, 'invalidation = broken resistance'); ok('invalidation = level');

const inside = [...prior, bar(100, 99.5, 99.8)]; // no breakout
r = ScalpBreakout.execute(inside, cfg);
assert.strictEqual(r.side, SIDE.HOLD, 'inside channel → HOLD'); ok('HOLD inside');

// too few bars
assert.strictEqual(ScalpBreakout.execute([bar(1, 1, 1)], cfg).side, SIDE.HOLD, 'short input → HOLD'); ok('HOLD short input');

console.log(`\n${p} checks passed`);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/test_scalp_breakout.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```javascript
// src/indicators/scalpBreakout.js
import { SIDE } from '../core/contracts.js';

const pick = (cfg, a, b, d) => (cfg && cfg[a] != null ? cfg[a] : (cfg && cfg[b] != null ? cfg[b] : d));
const rangeOf = (arr) => Math.max(...arr.map(c => c.high)) - Math.min(...arr.map(c => c.low));

/**
 * ProScalping-style level-breakout setup (candle-only; order book excluded).
 * Detects a tested level (cluster of touches), requires consolidation (pinch), then a
 * breakout close. Returns the broken level as `invalidation` (structural stop sits behind it).
 */
export default class ScalpBreakout {
  static execute(candles, config = {}) {
    const lookback = pick(config, 'lookback', 'lookback', 30);
    const minTouches = pick(config, 'minTouches', 'min_touches', 2);
    const touchTol = pick(config, 'touchTol', 'touch_tol', 0.0015);
    const breakoutMargin = pick(config, 'breakoutMargin', 'breakout_margin', 0.0005);
    const pinchBars = pick(config, 'pinchBars', 'pinch_bars', 6);
    const pinchRatio = pick(config, 'pinchRatio', 'pinch_ratio', 0.7);
    if (candles.length < lookback + 1) return { side: SIDE.HOLD, invalidation: null, level: null, touches: 0 };

    const prior = candles.slice(candles.length - lookback - 1, candles.length - 1); // lookback bars, excl current
    const cur = candles[candles.length - 1];
    const res = Math.max(...prior.map(c => c.high));
    const sup = Math.min(...prior.map(c => c.low));
    const resTouches = prior.filter(c => Math.abs(c.high - res) / res <= touchTol).length;
    const supTouches = prior.filter(c => Math.abs(c.low - sup) / sup <= touchTol).length;

    // Pinch: recent pinchBars range must be <= pinchRatio * the preceding pinchBars range.
    const recent = prior.slice(-pinchBars);
    const earlier = prior.slice(-2 * pinchBars, -pinchBars);
    const pinchOk = earlier.length === 0 ? true : rangeOf(recent) <= pinchRatio * rangeOf(earlier);

    const price = cur.close;
    if (pinchOk && resTouches >= minTouches && price > res * (1 + breakoutMargin)) {
      return { side: SIDE.BUY, invalidation: res, level: res, touches: resTouches };
    }
    if (pinchOk && supTouches >= minTouches && price < sup * (1 - breakoutMargin)) {
      return { side: SIDE.SELL, invalidation: sup, level: sup, touches: supTouches };
    }
    return { side: SIDE.HOLD, invalidation: null, level: null, touches: 0 };
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/test_scalp_breakout.mjs`
Expected: PASS — `4 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/indicators/scalpBreakout.js tests/test_scalp_breakout.mjs
git commit -m "feat(indicators): scalpBreakout level-breakout setup (pure, candle-only)"
```

---

### Task 4: Wire `SCALPBREAKOUT` through SignalAdapter + IndicatorManager

**Files:**
- Modify: `src/core/SignalAdapter.js` (add mapper after `fromDonchianTrend`; add switch case)
- Modify: `src/indicators/index.js` (import + switch case)
- Test: `tests/test_scalp_breakout_signal.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/test_scalp_breakout_signal.mjs
import assert from 'node:assert';
import { deriveSignal } from '../src/core/SignalAdapter.js';
let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

let s = deriveSignal('SCALPBREAKOUT', { side: 'BUY', invalidation: 100 }, {});
assert.strictEqual(s.side, 'BUY', 'BUY passthrough'); ok('side passthrough');
assert.strictEqual(s.invalidation, 100, 'invalidation passthrough'); ok('invalidation passthrough');
assert.ok(s.conviction > 0, 'conviction set'); ok('conviction');

s = deriveSignal('SCALPBREAKOUT', { side: 'HOLD', invalidation: null }, {});
assert.strictEqual(s.side, 'HOLD', 'HOLD → hold'); ok('HOLD maps to hold');

console.log(`\n${p} checks passed`);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/test_scalp_breakout_signal.mjs`
Expected: FAIL — `Unsupported logicType: SCALPBREAKOUT`.

- [ ] **Step 3: Implement**

In `src/core/SignalAdapter.js`, add after the `fromDonchianTrend` function:

```javascript
/** ScalpBreakout: execute() resolved the side; flat conviction; invalidation = broken level. */
function fromScalpBreakout(raw) {
  const side = raw?.side ?? SIDE.HOLD;
  if (side === SIDE.HOLD) return hold('ScalpBreakout: no breakout');
  return { side, conviction: 0.6, reason: `ScalpBreakout ${side}`, invalidation: raw.invalidation ?? null };
}
```

In the `deriveSignal` switch, add before `default`:

```javascript
    case 'SCALPBREAKOUT': return fromScalpBreakout(raw);
```

In `src/indicators/index.js`, add the import near the other logic imports:

```javascript
import ScalpBreakout from './scalpBreakout.js';
```

and in the `calculate` switch add:

```javascript
      case 'SCALPBREAKOUT': return ScalpBreakout.execute(candles, this.config);
```

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/test_scalp_breakout_signal.mjs`
Expected: PASS — `4 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/core/SignalAdapter.js src/indicators/index.js tests/test_scalp_breakout_signal.mjs
git commit -m "feat(core): wire SCALPBREAKOUT through SignalAdapter + IndicatorManager"
```

---

### Task 5: `universeGate.js` — entry veto outside the day's picks

**Files:**
- Create: `src/backtest/universeGate.js`
- Test: `tests/test_universe_gate.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/test_universe_gate.mjs
import assert from 'node:assert';
import { withUniverseGate } from '../src/backtest/universeGate.js';
let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

const D = Date.UTC(2025, 0, 2, 12, 0); // 2025-01-02
const permit = () => ({ signal: { side: 'BUY' }, decision: { decision: 'PERMIT', order: { side: 'BUY' } } });
const ctx = { candles: [{ time: D }] };
const picks = { '2025-01-02': ['SEL'] };

let g = withUniverseGate(permit, picks, 'SEL');
assert.strictEqual(g(ctx, {}).decision.decision, 'PERMIT', 'selected symbol passes'); ok('selected → PERMIT');

g = withUniverseGate(permit, picks, 'OTHER');
assert.strictEqual(g(ctx, {}).decision.decision, 'DENY', 'unselected symbol vetoed'); ok('unselected → DENY');

// inner DENY passes through untouched
const deny = () => ({ signal: {}, decision: { decision: 'DENY', reason: 'x' } });
g = withUniverseGate(deny, picks, 'SEL');
assert.strictEqual(g(ctx, {}).decision.decision, 'DENY', 'inner DENY preserved'); ok('inner DENY preserved');

console.log(`\n${p} checks passed`);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/test_universe_gate.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```javascript
// src/backtest/universeGate.js
import { dayKey } from './historicalUniverse.js';

/**
 * Wrap a decide fn so a PERMIT is vetoed (→ DENY) when `symbol` is not in that bar-day's
 * pick list. The day is taken from the last candle's time (closed-only; no look-ahead).
 * Inner DENY / HOLD pass through unchanged. Same shape as withHtfGate.
 *
 * @param {(ctx:object, account:object)=>{signal:object, decision:object}} decide
 * @param {Record<string,string[]>} picksByDay dayKey → selected symbols
 * @param {string} symbol the symbol being simulated
 */
export function withUniverseGate(decide, picksByDay, symbol) {
  return (ctx, account) => {
    const result = decide(ctx, account);
    const d = result && result.decision;
    if (!d || d.decision !== 'PERMIT' || !d.order) return result;
    const cs = ctx.candles;
    const k = dayKey(cs[cs.length - 1].time);
    const picks = picksByDay[k] || [];
    if (!picks.includes(symbol)) {
      return { signal: result.signal, decision: { decision: 'DENY', reason: `universe gate: ${symbol} not selected on ${k}` } };
    }
    return result;
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/test_universe_gate.mjs`
Expected: PASS — `3 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/backtest/universeGate.js tests/test_universe_gate.mjs
git commit -m "feat(backtest): withUniverseGate — entry veto outside the day's picks"
```

---

### Task 6: Simulator no-impulse time-stop (arm A)

**Files:**
- Modify: `src/backtest/simulator.js` (add block 3d after the channel-trailing block, ~line 137)
- Test: `tests/test_time_stop.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/test_time_stop.mjs
import assert from 'node:assert';
import { simulate } from '../src/backtest/simulator.js';
let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

// Flat market that never moves: a BUY entered must be time-stopped at breakeven-ish, not held.
const bar = (t, px) => ({ time: t, open: px, high: px * 1.0005, low: px * 0.9995, close: px, volume: 1 });
const candles = [];
for (let i = 0; i < 40; i++) candles.push(bar(i * 300000, 100));
// Force an entry via a stub decide that PERMITs a BUY once, structural-style SL below.
let fired = false;
const decide = (ctx) => {
  if (fired) return { signal: { side: 'HOLD' }, decision: { decision: 'DENY' } };
  fired = true;
  return { signal: { side: 'BUY' }, decision: { decision: 'PERMIT', order: { side: 'BUY', sizeUSD: 100, slPrice: 99, tpPrice: 200 } } };
};
const res = simulate({
  candles, config: { logicType: 'SCALPBREAKOUT' },
  guardrails: { portfolioValue: 1000, leverage: 1 },
  costs: { takerFee: 0, makerFee: 0, slippageBps: 0 },
  symbol: 'X', timeframe: '5m', lookback: 5,
  exitPolicy: { timeStopBars: 6, impulseR: 1 },
}, decide);

const ts = res.trades.find(t => t.reason === 'TIME_STOP');
assert.ok(ts, 'a TIME_STOP exit occurred'); ok('time-stop fires with no impulse');
assert.ok(Math.abs(ts.pnl) < 1e-6, 'flat market → ~breakeven pnl (no fees)'); ok('breakeven pnl');

console.log(`\n${p} checks passed`);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/test_time_stop.mjs`
Expected: FAIL — no trade has `reason === 'TIME_STOP'` (position held to end).

- [ ] **Step 3: Implement**

In `src/backtest/simulator.js`, immediately AFTER the channel-trailing block (the block labeled `// 3c)`, ending near line 137), insert:

```javascript
    // 3d) No-impulse time-stop (arm A). If after timeStopBars the favorable excursion has not
    // reached impulseR*R, force a market exit at this bar's close — models the trader's "вкат".
    // Additive and gated on exitPolicy.timeStopBars; existing runs (flag absent) are unchanged.
    if (position && p.exitPolicy && p.exitPolicy.timeStopBars > 0 && !position.timeStopDone) {
      const age = i - position.entryIndex;
      if (age >= p.exitPolicy.timeStopBars) {
        position.timeStopDone = true;
        const R = Math.abs(position.entryPrice - position.initialSlPrice);
        const fav = position.side === 'BUY' ? bar.high - position.entryPrice : position.entryPrice - bar.low;
        const impulseR = p.exitPolicy.impulseR != null ? p.exitPolicy.impulseR : 1;
        if (R > 0 && fav < impulseR * R) {
          const exitSide = position.side === 'BUY' ? 'SELL' : 'BUY';
          const exitPrice = slip(bar.close, exitSide, slippageBps);
          slippageCost += position.sizeUSD * Math.abs(exitPrice - bar.close) / bar.close;
          const exitFee = position.sizeUSD * takerFee;
          const ret = position.side === 'BUY'
            ? (exitPrice - position.entryPrice) / position.entryPrice
            : (position.entryPrice - exitPrice) / position.entryPrice;
          const fees = position.entryFee + exitFee;
          const pnl = position.sizeUSD * ret - fees - position.fundingAccrued;
          equity += pnl;
          totalFunding += position.fundingAccrued;
          trades.push({
            side: position.side, entryTime: position.entryTime, entryPrice: position.entryPrice,
            exitTime: bar.time, exitPrice, sizeUSD: position.sizeUSD,
            pnl, fees, funding: position.fundingAccrued, reason: 'TIME_STOP',
          });
          position = null;
        }
      }
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/test_time_stop.mjs`
Expected: PASS — `2 checks passed`.

- [ ] **Step 5: Run the full simulator suite to confirm no regression**

Run: `node tests/test_simulator.js && node tests/test_backtest_integration.js`
Expected: both exit 0 (existing runs unaffected — `timeStopBars` flag absent).

- [ ] **Step 6: Commit**

```bash
git add src/backtest/simulator.js tests/test_time_stop.mjs
git commit -m "feat(backtest): no-impulse time-stop exit (arm A), additive + gated"
```

---

### Task 7: Parametrize candle base (spot ↔ futures klines)

**Files:**
- Modify: `src/data/marketParse.js` (`candlesUrl` accepts an optional `market`)
- Test: extend `tests/test_market_parse.js`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_market_parse.js`:

```javascript
add('candlesUrl futures uses fapi/v1 base', () => {
  const u = candlesUrl({ symbol: 'BTCUSDT', timeframe: '5m', limit: 1000, startTime: 1, market: 'futures' });
  assert.ok(u.startsWith('https://fapi.binance.com/fapi/v1/klines?'), `futures base, got ${u}`);
});
add('candlesUrl defaults to spot api/v3', () => {
  const u = candlesUrl({ symbol: 'BTCUSDT', timeframe: '5m', limit: 1000, startTime: 1 });
  assert.ok(u.startsWith('https://api.binance.com/api/v3/klines?'), `spot default, got ${u}`);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/test_market_parse.js`
Expected: FAIL — futures URL still points at `api.binance.com/api/v3`.

- [ ] **Step 3: Implement**

In `src/data/marketParse.js`, add a futures base constant near the top:

```javascript
const BINANCE_FUTURES_BASE = 'https://fapi.binance.com';
```

Replace `candlesUrl` with:

```javascript
export function candlesUrl({ symbol, timeframe, limit = 1000, startTime, endTime, market = 'spot' }) {
  const interval = BINANCE_INTERVAL[timeframe];
  if (!interval) throw new Error(`Unknown timeframe: ${timeframe}`);
  const p = new URLSearchParams({ symbol, interval, limit: String(limit) });
  if (startTime != null) p.set('startTime', String(startTime));
  if (endTime != null) p.set('endTime', String(endTime));
  return market === 'futures'
    ? `${BINANCE_FUTURES_BASE}/fapi/v1/klines?${p.toString()}`
    : `${BINANCE_BASE}/api/v3/klines?${p.toString()}`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/test_market_parse.js`
Expected: PASS (all existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/data/marketParse.js tests/test_market_parse.js
git commit -m "feat(data): candlesUrl market param (spot ↔ futures klines)"
```

---

### Task 8: Futures universe downloader

**Files:**
- Create: `backtest/download-futures-universe.mjs`
- (No new unit test — this is I/O glue verified by a smoke run in Step 4.)

> Note: `fetchCandlesPage` in `src/data/marketDataFetch.js` calls `candlesUrl({...})`. To download
> futures klines, pass `market: 'futures'` through. If `downloadCandles` does not forward a
> `market` option, thread it through `downloadCandles` → `fetchCandlesPage` → `candlesUrl`
> (one optional param each, default `'spot'`), so existing callers are unaffected.

- [ ] **Step 1: Implement the downloader**

```javascript
// backtest/download-futures-universe.mjs
// Select the top-N alt USDⓈ-M perps by 24h quote volume (+ 6 majors) and download 5m+15m klines.
import path from 'path';
import { openMarketDb } from '../src/data/marketDataSchema.js';
import { MarketDataRepo } from '../src/data/MarketDataRepo.js';
import { downloadCandles, verifyCandles } from '../src/data/marketDataFetch.js';
import { parseArgs } from './download-data.js';

const MAJORS = ['BTCUSDT', 'ETHUSDT', 'LTCUSDT', 'SOLUSDT', 'XLMUSDT', 'XRPUSDT'];
const STABLE_BASES = ['USDC', 'FDUSD', 'TUSD', 'DAI', 'BUSD'];

async function topAltPerps(n) {
  const res = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
  if (!res.ok) throw new Error(`fapi 24hr HTTP ${res.status}`);
  const rows = await res.json();
  return rows
    .filter(r => r.symbol.endsWith('USDT'))
    .filter(r => !STABLE_BASES.some(s => r.symbol.startsWith(s)))
    .filter(r => !MAJORS.includes(r.symbol))
    .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))
    .slice(0, n)
    .map(r => r.symbol);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const n = args.n ? Number(args.n) : 30;
  const from = args.from ? Date.parse(args.from) : Date.parse('2024-06-01');
  const tfs = String(args.tfs || '5m,15m').split(',').map(s => s.trim());
  const alts = await topAltPerps(n);
  const symbols = [...alts, ...MAJORS];
  console.log(`[universe] ${alts.length} alts + ${MAJORS.length} majors; tfs=${tfs.join(',')}`);

  const db = await openMarketDb(path.join(process.cwd(), 'market_data.db'));
  const repo = new MarketDataRepo(db);
  for (const symbol of symbols) {
    for (const tf of tfs) {
      try {
        const added = await downloadCandles(repo, { symbol, timeframe: tf, from, market: 'futures' });
        const v = await verifyCandles(repo, symbol, tf);
        console.log(`[dl] ${symbol} ${tf}: +${added} (total ${v.count}, gaps ${v.gaps.length})`);
      } catch (e) {
        console.warn(`[dl] ERROR ${symbol} ${tf}: ${e.message}`);
      }
    }
  }
  await db.close();
  // Persist the selected alt list for the scout to read.
  const fs = await import('fs');
  fs.writeFileSync(path.join(process.cwd(), 'backtest', 'bplus-universe.json'),
    JSON.stringify({ generatedAt: Date.now(), alts, majors: MAJORS }, null, 2));
  console.log('[universe] wrote backtest/bplus-universe.json');
}
main().catch(e => { console.error(e); process.exit(1); });
```

> `verifyCandles` lives in `backtest/download-data.js` in the current tree; if it is not exported
> from `src/data/marketDataFetch.js`, import it from `./download-data.js` instead. Confirm the
> export location before running.

- [ ] **Step 2: Smoke run (small)**

Run: `node backtest/download-futures-universe.mjs --n 3 --from 2026-05-01 --tfs 5m`
Expected: logs `[universe] 3 alts + 6 majors`, per-symbol `+N` candle lines, writes `bplus-universe.json`.

- [ ] **Step 3: Full download for the measurement window**

Run: `node backtest/download-futures-universe.mjs --n 30 --from 2024-06-01 --tfs 5m,15m`
Expected: completes; alts with short history simply download fewer candles (logged), not fatal.

- [ ] **Step 4: Commit**

```bash
git add backtest/download-futures-universe.mjs src/data/marketParse.js src/data/marketDataFetch.js
git commit -m "feat(backtest): futures-universe downloader (top alts + majors, 5m/15m)"
```

> `bplus-universe.json` and `market_data.db` are data, not source — do not commit them.

---

### Task 9: B+ sweep driver (universe × TF × exit-arm × window) + gate

**Files:**
- Create: `backtest/run-bplus-scout.mjs`
- (No unit test — direct-`simulate` measurement driver, like `run-donchian-scout.mjs`.)

- [ ] **Step 1: Implement the driver**

```javascript
// backtest/run-bplus-scout.mjs
// Frozen B+ concept-proof. Pre-registered configs (no tuning). Candle-only (no order book).
import path from 'path';
import fs from 'fs';
import { openMarketDb } from '../src/data/marketDataSchema.js';
import { MarketDataRepo } from '../src/data/MarketDataRepo.js';
import { simulate } from '../src/backtest/simulator.js';
import { buildPicksByDay } from '../src/backtest/historicalUniverse.js';
import { withUniverseGate } from '../src/backtest/universeGate.js';
import { evaluateBar } from '../src/core/pipeline.js';

const TFS = ['5m', '15m'];
const WINDOWS = {
  train: ['2024-06-01', '2025-06-01'],
  test:  ['2025-06-01', '2026-06-08'],
};
const COSTS = { takerFee: 0.0006, makerFee: 0.0002, slippageBps: 5 };
const SCORE_OPTS = { minLiquidity: 20e6, topN: 15, denylist: [] };

// Exit arms: A = structural stop + TP 2R + no-impulse time-stop; B = structural stop + trailing.
const ARMS = {
  A: { guardrails: { stopMode: 'structural', structuralRR: 2 }, exitPolicy: { timeStopBars: 6, impulseR: 1 } },
  B: { guardrails: { stopMode: 'structural', structuralRR: 10 }, exitPolicy: { channelExit: 10 } },
};

function baseGuardrails(extra) {
  return {
    portfolioValue: 10000, riskPerTrade: 0.02, sizingMode: 'fixed',
    minRiskRewardRatio: 0, maxOpenPositions: 1, maxPortfolioHeatPct: 100,
    dailyLossLimitPct: 1, maxTradesPerDay: 999999, leverage: 1, ...extra,
  };
}
function maxDrawdown(curve) {
  let peak = -Infinity, mdd = 0;
  for (const pt of curve) { if (pt.equity > peak) peak = pt.equity; if (peak > 0) mdd = Math.max(mdd, (peak - pt.equity) / peak); }
  return mdd;
}

async function main() {
  const uni = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'backtest', 'bplus-universe.json'), 'utf8'));
  const alts = uni.alts, majors = uni.majors, all = [...alts, ...majors];
  const db = await openMarketDb(path.join(process.cwd(), 'market_data.db'));
  const repo = new MarketDataRepo(db);
  const rows = [];

  for (const [win, [fromS, toS]] of Object.entries(WINDOWS)) {
    const from = Date.parse(fromS), to = Date.parse(toS);
    for (const tf of TFS) {
      // Load candles once per (window, tf), build the rolling pick map from alts only.
      const candlesBySym = {};
      for (const sym of all) {
        const cs = await repo.getCandles(sym, tf, from, to);
        if (cs && cs.length >= 260) candlesBySym[sym] = cs;
      }
      const altCandles = Object.fromEntries(Object.entries(candlesBySym).filter(([s]) => alts.includes(s)));
      const picksByDay = buildPicksByDay(altCandles, SCORE_OPTS);

      for (const [armName, arm] of Object.entries(ARMS)) {
        for (const sym of all) {
          const cs = candlesBySym[sym];
          if (!cs) { rows.push({ win, tf, arm: armName, sym, skip: true }); continue; }
          const isAlt = alts.includes(sym);
          // Majors (control) trade their own breakouts ungated; alts are gated to the daily picks.
          const decide = isAlt ? withUniverseGate(evaluateBar, picksByDay, sym) : evaluateBar;
          const res = simulate({
            candles: cs,
            config: { logicType: 'ScalpBreakout', logic: {} },
            guardrails: baseGuardrails(arm.guardrails),
            costs: COSTS, symbol: sym, timeframe: tf, lookback: 250,
            exitPolicy: arm.exitPolicy,
          }, decide);
          const pnlPct = res.finalEquity / 10000 - 1;
          const bh = cs[cs.length - 1].close / cs[0].close - 1;
          rows.push({ win, tf, arm: armName, sym, isAlt, pnlPct, mdd: maxDrawdown(res.equityCurve), trades: res.trades.length, bh });
        }
      }
    }
  }
  await db.close();

  const pct = (x) => (x * 100).toFixed(1) + '%';
  console.log('window\ttf\tarm\tsym\tgroup\tpnl\tmaxdd\ttrades\tbh');
  for (const r of rows) {
    if (r.skip) { console.log(`${r.win}\t${r.tf}\t${r.arm}\t${r.sym}\tSKIP`); continue; }
    console.log(`${r.win}\t${r.tf}\t${r.arm}\t${r.sym}\t${r.isAlt ? 'alt' : 'major'}\t${pct(r.pnlPct)}\t${pct(r.mdd)}\t${r.trades}\t${pct(r.bh)}`);
  }

  // Test-year gate per (tf × arm): alts breadth, beats-BH, MaxDD, + majors control.
  console.log('\n-- TEST-YEAR GATE (alts) + majors control --');
  for (const tf of TFS) for (const armName of Object.keys(ARMS)) {
    const cells = rows.filter(r => !r.skip && r.win === 'test' && r.tf === tf && r.arm === armName);
    const altC = cells.filter(r => r.isAlt), majC = cells.filter(r => !r.isAlt);
    const posShare = (g) => g.length ? g.filter(r => r.pnlPct > 0).length / g.length : 0;
    const avg = (g) => g.length ? g.reduce((a, r) => a + r.pnlPct, 0) / g.length : 0;
    const beat = altC.filter(r => r.pnlPct > r.bh).length;
    const mddMax = altC.length ? Math.max(...altC.map(r => r.mdd)) : 0;
    console.log(`${tf}\t${armName}\talts: pos ${(100 * posShare(altC)).toFixed(0)}% avg ${pct(avg(altC))} beatBH ${beat}/${altC.length} worstDD ${pct(mddMax)} | majors avg ${pct(avg(majC))}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Smoke run after a small download**

Run: `node backtest/run-bplus-scout.mjs`
Expected: prints the per-cell TSV and the gate summary; no crash. (If `bplus-universe.json` is missing, run Task 8 first.)

- [ ] **Step 3: Commit**

```bash
git add backtest/run-bplus-scout.mjs
git commit -m "feat(backtest): B+ scalp-breakout sweep driver (gate + majors control)"
```

---

### Task 10: Run the measurement + write the research note

**Files:**
- Create (LOCAL, NOT committed): `docs/research/2026-06-13-bplus-scalp-breakout.md`

- [ ] **Step 1: Ensure data is present**

Run: `node backtest/download-futures-universe.mjs --n 30 --from 2024-06-01 --tfs 5m,15m`
Expected: alts + majors downloaded into `market_data.db`; `bplus-universe.json` written.

- [ ] **Step 2: Run the full sweep, capture output**

Run: `node backtest/run-bplus-scout.mjs > backtest/bplus-out.txt`
Expected: TSV + gate summary in `backtest/bplus-out.txt`.

- [ ] **Step 3: Write the research note (honest verdict)**

Create `docs/research/2026-06-13-bplus-scalp-breakout.md` containing, with NO goalpost-moving:
- the frozen protocol (universe, rolling no-look-ahead selection, TFs, two exit arms, costs, leverage 1, windows);
- the test-year table per (tf × arm): alts positive-share, avg PnL, beat-BH, worst MaxDD, and the majors-control avg;
- the four-part gate verdict per (tf × arm);
- the **traffic-light interpretation**: 🟢 alts clearly positive AND stronger than majors → green-light the live order-book forward harness; 🟡 alts ≈ flat or ≈ majors → edge (if any) lives in the order book, forward-only; no clean 🔴 (order book untested);
- restate the fidelity caveat (B+ is a lower bound — no order-book skip/confirm filter) and the survivorship caveat.

- [ ] **Step 4: Confirm the note is untracked (local-only)**

Run: `git status --porcelain docs/research/2026-06-13-bplus-scalp-breakout.md`
Expected: shows `??` (untracked). Do NOT `git add` it — research docs stay local.

- [ ] **Step 5: Commit (code/data-artifact cleanup only)**

```bash
# Only if bplus-out.txt should be discarded (it is a scratch artifact, not source):
rm -f backtest/bplus-out.txt
```
No source changes in this task → no code commit. The deliverable is the local research note + the verdict reported to the user.

---

## Self-Review

**Spec coverage:**
- Universe ~30 alts + 6 majors control → Task 8. ✔
- Rolling no-look-ahead selection via score.js → Tasks 1, 2. ✔
- 5m + 15m → driver `TFS` (Task 9). ✔
- Exit arms A (structural+TP2R+time-stop) & B (structural+trailing) → Tasks 6, 9 (`ARMS`). ✔
- Costs (taker 0.06%, slip 5bps), leverage 1 → driver `COSTS`/`baseGuardrails`. ✔
- Setup (level, pinch, breakout, invalidation) → Task 3; round-number toggle is out-of-scope v1 (spec) → intentionally omitted. ✔
- Gate (PnL>0, breadth ≥50%, beats BH, MaxDD≤30%) + majors control → Task 9 summary + Task 10 note. ✔
- Asymmetric interpretation + fidelity/survivorship caveats → Task 10 note. ✔
- `universeGate` mirrors `withHtfGate` → Task 5. ✔
- `score.js` shared with screener → Task 1. ✔

**Placeholder scan:** all code blocks are complete; no TBD/TODO. Task 10 Step 3 lists exact note contents (a measurement-writing step, not a code placeholder).

**Type consistency:** `scoreUniverse(rows, opts)` returns objects with `{symbol,score,rank,...}` (Task 1) consumed by `buildPicksByDay` via `.map(r => r.symbol)` (Task 2). `buildPicksByDay` returns `{dayKey: [symbols]}` consumed by `withUniverseGate(decide, picksByDay, symbol)` (Task 5) and the driver (Task 9). `ScalpBreakout.execute` returns `{side, invalidation, level, touches}` (Task 3) consumed by `fromScalpBreakout` (Task 4) → signal `invalidation` → `RiskPolicy` structural. `exitPolicy.timeStopBars`/`impulseR` (Task 6) match the driver's arm A (Task 9). Logic type string `'ScalpBreakout'` (config) upper-cases to `'SCALPBREAKOUT'` in both switches (Task 4). Consistent.
