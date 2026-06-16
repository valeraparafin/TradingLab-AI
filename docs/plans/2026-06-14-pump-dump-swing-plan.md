# Post-Pump-Dump Swing Scout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure whether shorting the Donchian breakdown of a pumped-then-rolled-over coin and holding the downtrend has a positive after-cost edge on volatile alts.

**Architecture:** One pure detector (`isPumpDumpShort`) + a thin decorator gate (`withPumpDumpGate`, mirroring `withHtfGate`/`withUniverseGate`) composed over `evaluateBar` running `DonchianTrend` (SELL side). Exit is the existing channel trailing (`stopMode:'channel'` 2×ATR initial stop + `exitPolicy.channelExit` trailing). A sweep driver runs the frozen configs over the already-downloaded 36-symbol dataset. `bot_engine.js` and `simulator.js` are untouched — all reuse.

**Tech Stack:** Node ESM, existing `simulate()` / `RiskPolicy` / `donchianTrend` / `MarketDataRepo`.

**Commit trailer (every commit):** `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

## File Structure

- Create `src/backtest/pumpDump.js` — pure `isPumpDumpShort(candles, opts)`.
- Create `src/backtest/pumpDumpGate.js` — `withPumpDumpGate(decide, opts)` decorator.
- Create `backtest/run-ppd-scout.mjs` — sweep driver + 4-part gate + majors control.
- Create tests: `tests/test_pump_dump.mjs`, `tests/test_pump_dump_gate.mjs`.
- (No source file is modified; everything else is reused unchanged.)

---

### Task 1: `pumpDump.js` — post-pump-dump detector (pure)

**Files:**
- Create: `src/backtest/pumpDump.js`
- Test: `tests/test_pump_dump.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/test_pump_dump.mjs
import assert from 'node:assert';
import { isPumpDumpShort } from '../src/backtest/pumpDump.js';
let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

const bar = (h, l, c) => ({ time: 0, open: (h + l) / 2, high: h, low: l, close: c, volume: 1 });
const opts = { pumpWindow: 10, pumpPct: 0.5, dumpPct: 0.15 };

// base ~100 (bars 0-3), pump to peak 200 (bar 6), then roll over to 160 (bar 9): -20% off peak.
const dumped = [
  bar(101, 99, 100), bar(102, 99, 101), bar(101, 99, 100), bar(103, 100, 102),
  bar(140, 110, 138), bar(180, 140, 178), bar(200, 175, 198), // peak high=200 at idx6
  bar(190, 175, 185), bar(180, 165, 172), bar(170, 158, 160), // close 160
];
let r = isPumpDumpShort(dumped, opts);
assert.strictEqual(r.eligible, true, 'pumped then dumped → eligible'); ok('eligible when pumped+rolled+pulled');
assert.ok(Math.abs(r.peak - 200) < 1e-9, 'peak detected'); ok('peak');
assert.ok(r.pumpRet >= 0.5 && r.drawdown >= 0.15, 'thresholds met'); ok('thresholds');

// still pumping: peak is the LAST bar → not rolled over → ineligible
const pumping = [
  bar(101, 99, 100), bar(102, 99, 101), bar(101, 99, 100), bar(103, 100, 102),
  bar(140, 110, 138), bar(150, 140, 148), bar(160, 150, 158),
  bar(175, 160, 173), bar(185, 172, 183), bar(205, 188, 204), // peak at last idx
];
assert.strictEqual(isPumpDumpShort(pumping, opts).eligible, false, 'peak at last bar → ineligible'); ok('not rolled over → ineligible');

// pumped but only 5% off peak → drawdown too small
const shallow = [...dumped.slice(0, 9), bar(196, 190, 192)]; // close 192 vs peak 200 = 4%
assert.strictEqual(isPumpDumpShort(shallow, opts).eligible, false, 'shallow pullback → ineligible'); ok('shallow pullback → ineligible');

// no pump (flat) → ineligible
const flat = Array.from({ length: 10 }, () => bar(101, 99, 100));
assert.strictEqual(isPumpDumpShort(flat, opts).eligible, false, 'flat → ineligible'); ok('flat → ineligible');

// too few bars → ineligible
assert.strictEqual(isPumpDumpShort(dumped.slice(0, 5), opts).eligible, false, 'short input → ineligible'); ok('short input → ineligible');

console.log(`\n${p} checks passed`);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/test_pump_dump.mjs`
Expected: FAIL — `Cannot find module '../src/backtest/pumpDump.js'`.

- [ ] **Step 3: Implement**

```javascript
// src/backtest/pumpDump.js
/**
 * Post-pump-dump SHORT detector. Pure. Evaluated on candles up to the current bar's close.
 * Over the trailing `pumpWindow` bars: find the peak high; require the run-up from the
 * pre-peak base to be >= pumpPct, the peak to be in the past (price rolled over), and the
 * pullback from the peak to be >= dumpPct. Uses only data up to the current bar (no look-ahead).
 *
 * @param {{high:number,low:number,close:number}[]} candles ascending
 * @param {{pumpWindow?:number, pumpPct?:number, dumpPct?:number}} [opts]
 * @returns {{eligible:boolean, peak:number|null, preLow:number|null, pumpRet:number, drawdown:number}}
 */
export function isPumpDumpShort(candles, opts = {}) {
  const { pumpWindow = 480, pumpPct = 0.5, dumpPct = 0.15 } = opts;
  const none = { eligible: false, peak: null, preLow: null, pumpRet: 0, drawdown: 0 };
  if (!Array.isArray(candles) || candles.length < pumpWindow) return none;

  const win = candles.slice(candles.length - pumpWindow);
  const last = win.length - 1;

  let peak = -Infinity, peakIdx = -1;
  for (let i = 0; i < win.length; i++) { if (win[i].high > peak) { peak = win[i].high; peakIdx = i; } }
  if (!(peak > 0)) return none;

  let preLow = Infinity;
  for (let i = 0; i <= peakIdx; i++) { if (win[i].low < preLow) preLow = win[i].low; }
  if (!(preLow > 0)) return none;

  const close = win[last].close;
  const pumpRet = (peak - preLow) / preLow;
  const drawdown = (peak - close) / peak;
  const rolledOver = peakIdx < last;
  const eligible = pumpRet >= pumpPct && rolledOver && drawdown >= dumpPct;
  return { eligible, peak, preLow, pumpRet, drawdown };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/test_pump_dump.mjs`
Expected: PASS — `6 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/backtest/pumpDump.js tests/test_pump_dump.mjs
git commit -m "feat(backtest): post-pump-dump short detector (pure)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `pumpDumpGate.js` — short-only post-pump-dump entry gate

**Files:**
- Create: `src/backtest/pumpDumpGate.js`
- Test: `tests/test_pump_dump_gate.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/test_pump_dump_gate.mjs
import assert from 'node:assert';
import { withPumpDumpGate } from '../src/backtest/pumpDumpGate.js';
let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

const bar = (h, l, c) => ({ time: 0, open: (h + l) / 2, high: h, low: l, close: c, volume: 1 });
// eligible window (pumped to 200 then pulled back to 160), pumpWindow 10
const eligible = [
  bar(101, 99, 100), bar(102, 99, 101), bar(101, 99, 100), bar(103, 100, 102),
  bar(140, 110, 138), bar(180, 140, 178), bar(200, 175, 198),
  bar(190, 175, 185), bar(180, 165, 172), bar(170, 158, 160),
];
const flat = Array.from({ length: 10 }, () => bar(101, 99, 100));
const opts = { pumpWindow: 10, pumpPct: 0.5, dumpPct: 0.15 };

const sell = () => ({ signal: { side: 'SELL' }, decision: { decision: 'PERMIT', order: { side: 'SELL' } } });
const buy  = () => ({ signal: { side: 'BUY'  }, decision: { decision: 'PERMIT', order: { side: 'BUY'  } } });

let g = withPumpDumpGate(sell, opts);
assert.strictEqual(g({ candles: eligible }, {}).decision.decision, 'PERMIT', 'SELL + eligible passes'); ok('SELL+eligible → PERMIT');

g = withPumpDumpGate(buy, opts);
assert.strictEqual(g({ candles: eligible }, {}).decision.decision, 'DENY', 'BUY vetoed (short only)'); ok('BUY → DENY');

g = withPumpDumpGate(sell, opts);
assert.strictEqual(g({ candles: flat }, {}).decision.decision, 'DENY', 'SELL but not post-pump-dump vetoed'); ok('SELL+ineligible → DENY');

// inner DENY passes through
const deny = () => ({ signal: {}, decision: { decision: 'DENY', reason: 'x' } });
g = withPumpDumpGate(deny, opts);
assert.strictEqual(g({ candles: eligible }, {}).decision.decision, 'DENY', 'inner DENY preserved'); ok('inner DENY preserved');

console.log(`\n${p} checks passed`);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/test_pump_dump_gate.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```javascript
// src/backtest/pumpDumpGate.js
import { isPumpDumpShort } from './pumpDump.js';
import { SIDE } from '../core/contracts.js';

/**
 * Wrap a decide fn so a PERMIT survives only when the signal is a SELL AND the current bar is
 * in a post-pump-dump state. Long side and non-eligible bars are vetoed (→ DENY). Inner DENY /
 * HOLD pass through unchanged. Same shape as withHtfGate / withUniverseGate.
 *
 * @param {(ctx:object, account:object)=>{signal:object, decision:object}} decide
 * @param {{pumpWindow?:number, pumpPct?:number, dumpPct?:number}} [opts] forwarded to isPumpDumpShort
 */
export function withPumpDumpGate(decide, opts = {}) {
  return (ctx, account) => {
    const result = decide(ctx, account);
    const d = result && result.decision;
    if (!d || d.decision !== 'PERMIT' || !d.order) return result;
    const side = result.signal && result.signal.side;
    if (side !== SIDE.SELL) {
      return { signal: result.signal, decision: { decision: 'DENY', reason: 'pump-dump gate: long side vetoed' } };
    }
    if (!isPumpDumpShort(ctx.candles, opts).eligible) {
      return { signal: result.signal, decision: { decision: 'DENY', reason: 'pump-dump gate: not post-pump-dump' } };
    }
    return result;
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/test_pump_dump_gate.mjs`
Expected: PASS — `4 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/backtest/pumpDumpGate.js tests/test_pump_dump_gate.mjs
git commit -m "feat(backtest): withPumpDumpGate — short-only post-pump-dump entry veto

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `run-ppd-scout.mjs` — sweep driver (symbol × TF × param-set × window) + gate

**Files:**
- Create: `backtest/run-ppd-scout.mjs`
- (No unit test — direct-`simulate` measurement driver, like `run-bplus-scout.mjs`.)

> Reuse facts (verified): `donchianTrend.execute` reads `config.logic.indicators.entryLookback`
> (camelCase). `stopMode:'channel'` needs `ctx.atr` — `evaluateBar` computes ATR automatically for
> channel mode, so just set `guardrails.stopMode='channel'` + `atrPeriod`. Channel trailing is
> `exitPolicy.channelExit`. The detector needs ≥ `pumpWindow` bars of context, so the driver sets
> `simulate` `lookback = pumpWindow + 40` (otherwise the per-bar window is truncated to 250).

- [ ] **Step 1: Implement the driver**

```javascript
// backtest/run-ppd-scout.mjs
// Frozen post-pump-dump swing concept-proof. Pre-registered configs (no tuning). Fully backtestable.
import path from 'path';
import fs from 'fs';
import { openMarketDb } from '../src/data/marketDataSchema.js';
import { MarketDataRepo } from '../src/data/MarketDataRepo.js';
import { simulate } from '../src/backtest/simulator.js';
import { withPumpDumpGate } from '../src/backtest/pumpDumpGate.js';
import { evaluateBar } from '../src/core/pipeline.js';

const TFS = ['15m', '5m'];
const WINDOWS = {
  train: ['2024-06-01', '2025-06-01'],
  test:  ['2025-06-01', '2026-06-08'],
};
const COSTS = { takerFee: 0.0006, makerFee: 0.0002, slippageBps: 5 };

// Frozen parameter sets (pre-registered). P1 base, P2 strict (only strong pumps).
const PSETS = {
  P1: { pumpWindow: 480, pumpPct: 0.50, dumpPct: 0.15, entryLookback: 96, channelExit: 192 },
  P2: { pumpWindow: 480, pumpPct: 1.00, dumpPct: 0.20, entryLookback: 96, channelExit: 192 },
};

function baseGuardrails(extra) {
  return {
    portfolioValue: 10000, riskPerTrade: 0.02, sizingMode: 'fixed',
    minRiskRewardRatio: 0, maxOpenPositions: 1, maxPortfolioHeatPct: 100,
    dailyLossLimitPct: 1, maxTradesPerDay: 999999, leverage: 1, atrPeriod: 14,
    stopMode: 'channel', ...extra,
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
      const candlesBySym = {};
      for (const sym of all) {
        const cs = await repo.getCandles(sym, tf, from, to);
        if (cs && cs.length >= 540) candlesBySym[sym] = cs; // need >= pumpWindow(480) + margin
      }
      for (const [psName, P] of Object.entries(PSETS)) {
        for (const sym of all) {
          const cs = candlesBySym[sym];
          if (!cs) { rows.push({ win, tf, ps: psName, sym, skip: true }); continue; }
          const isAlt = alts.includes(sym);
          // Same detector gate for alts AND majors (the detector IS the strategy; majors are the
          // control and should rarely qualify). Short-only via the gate.
          const decide = withPumpDumpGate(evaluateBar, { pumpWindow: P.pumpWindow, pumpPct: P.pumpPct, dumpPct: P.dumpPct });
          const res = simulate({
            candles: cs,
            config: { logicType: 'DonchianTrend', logic: { indicators: { entryLookback: P.entryLookback } } },
            guardrails: baseGuardrails({}),
            costs: COSTS, symbol: sym, timeframe: tf, lookback: P.pumpWindow + 40,
            exitPolicy: { channelExit: P.channelExit },
          }, decide);
          const pnlPct = res.finalEquity / 10000 - 1;
          const bh = cs[cs.length - 1].close / cs[0].close - 1;
          rows.push({ win, tf, ps: psName, sym, isAlt, pnlPct, mdd: maxDrawdown(res.equityCurve), trades: res.trades.length, bh });
        }
      }
    }
  }
  await db.close();

  const pct = (x) => (x * 100).toFixed(1) + '%';
  console.log('window\ttf\tpset\tsym\tgroup\tpnl\tmaxdd\ttrades\tbh');
  for (const r of rows) {
    if (r.skip) { console.log(`${r.win}\t${r.tf}\t${r.ps}\t${r.sym}\tSKIP`); continue; }
    console.log(`${r.win}\t${r.tf}\t${r.ps}\t${r.sym}\t${r.isAlt ? 'alt' : 'major'}\t${pct(r.pnlPct)}\t${pct(r.mdd)}\t${r.trades}\t${pct(r.bh)}`);
  }

  // Test-year gate per (tf × pset): alts breadth, beats-BH, MaxDD, + majors control.
  // Breadth/beat counts use only alts that actually traded (trades > 0).
  console.log('\n-- TEST-YEAR GATE (alts that traded) + majors control --');
  for (const tf of TFS) for (const psName of Object.keys(PSETS)) {
    const cells = rows.filter(r => !r.skip && r.win === 'test' && r.tf === tf && r.ps === psName);
    const altC = cells.filter(r => r.isAlt && r.trades > 0), majC = cells.filter(r => !r.isAlt && r.trades > 0);
    const posShare = (g) => g.length ? g.filter(r => r.pnlPct > 0).length / g.length : 0;
    const avg = (g) => g.length ? g.reduce((a, r) => a + r.pnlPct, 0) / g.length : 0;
    const beat = altC.filter(r => r.pnlPct > r.bh).length;
    const mddMax = altC.length ? Math.max(...altC.map(r => r.mdd)) : 0;
    console.log(`${tf}\t${psName}\talts(traded ${altC.length}): pos ${(100 * posShare(altC)).toFixed(0)}% avg ${pct(avg(altC))} beatBH ${beat}/${altC.length} worstDD ${pct(mddMax)} | majors(traded ${majC.length}) avg ${pct(avg(majC))}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Smoke run**

Run: `node backtest/run-ppd-scout.mjs`
Expected: prints the per-cell TSV header + rows + the gate summary; no crash. Many majors (and calm alts) will show 0 trades / SKIP — expected. If `bplus-universe.json` is missing, the B+ downloader (`backtest/download-futures-universe.mjs`) must have been run first; it has been.

- [ ] **Step 3: Commit**

```bash
git add backtest/run-ppd-scout.mjs
git commit -m "feat(backtest): post-pump-dump swing sweep driver (gate + majors control)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Run the measurement + write the research note

**Files:**
- Create (LOCAL, NOT committed): `docs/research/2026-06-14-pump-dump-swing.md`

- [ ] **Step 1: Run the full sweep, capture output**

Run: `node backtest/run-ppd-scout.mjs > backtest/ppd-out.txt`
Expected: TSV + gate summary in `backtest/ppd-out.txt`. (Data already present in `market_data.db`.)

- [ ] **Step 2: Write the research note (honest verdict)**

Create `docs/research/2026-06-14-pump-dump-swing.md` containing, with NO goalpost-moving:
- the frozen protocol (detector params P1/P2, Donchian entry, channel trailing exit, costs, leverage 1, windows, short-only, majors-control-same-gate);
- the test-year table per (tf × pset): alts-that-traded count, positive-share, avg PnL, beat-BH, worst MaxDD, and the majors-control trade count + avg;
- the four-part gate verdict per (tf × pset);
- the **traffic-light interpretation**: 🟢 alts clearly positive AND stronger than majors → candidate for live paper/forward deployment; 🟡 flat or ≈ majors; **🔴 red is valid here** — a negative result genuinely refutes the candle-backtestable post-pump-dump short thesis (no order book needed);
- note how many alts even *qualified* (if almost none traded, the detector is too strict — report it as an inconclusive-sample caveat, not a pass/fail);
- restate the survivorship caveat.

- [ ] **Step 3: Confirm the note is untracked (local-only)**

Run: `git status --porcelain docs/research/2026-06-14-pump-dump-swing.md`
Expected: shows `??` (untracked). Do NOT `git add` it — research docs stay local.

- [ ] **Step 4: Cleanup scratch artifact**

```bash
# ppd-out.txt is a scratch artifact (data, not source) — remove it after the note is written:
rm -f backtest/ppd-out.txt
```
No source changes in this task → no code commit. The deliverable is the local research note + the verdict reported to the user.

---

## Self-Review

**Spec coverage:**
- Detector (pump ≥pumpPct, rolled over, pullback ≥dumpPct) → Task 1. ✔
- Short-only + post-pump-dump gate mirroring withHtfGate → Task 2. ✔
- Donchian breakdown SELL entry → driver `config.logicType:'DonchianTrend'` + `indicators.entryLookback` (Task 3). ✔
- Channel trailing hold (wide window) → `stopMode:'channel'` + `exitPolicy.channelExit:192` (Task 3). ✔
- Universe 36 symbols, 15m+5m, majors control via identical gate → Task 3. ✔
- Costs taker 0.06% + 5bps, leverage 1 → driver `COSTS`/`baseGuardrails`. ✔
- Frozen P1/P2 sets → driver `PSETS`. ✔
- Train/test blind split, 4-part gate + traffic light (🔴 valid) + survivorship caveat → Tasks 3, 4. ✔
- Out of scope (order book, longs, leverage, round numbers, scaling) → intentionally omitted. ✔

**Placeholder scan:** all code blocks complete; no TBD/TODO. Task 4 lists exact note contents (a measurement-writing step, not a code placeholder).

**Type consistency:** `isPumpDumpShort(candles, opts)` returns `{eligible,...}` (Task 1) consumed by `withPumpDumpGate` via `.eligible` (Task 2). `withPumpDumpGate(decide, opts)` wraps `evaluateBar` and is passed as the `decide` arg to `simulate(p, decide)` (Task 3) — same shape as the B+ driver's `withUniverseGate`. `config.logic.indicators.entryLookback` matches `donchianTrend.execute`'s `config.indicators` read (logic is spread into ctx.config; `evaluateBar` calls `new IndicatorManager(ctx.config.logic||{}).calculate(...)`, so `indicators` sits under `logic`). `exitPolicy.channelExit` matches simulator block 3c. `SIDE.SELL` === `'SELL'`. Consistent.
