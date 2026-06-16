# PnL Campaign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the engine knobs (compound sizing, ATR/structural stops, breakeven exit) needed to push the best SMC backtest from +10.13% toward ≥+100% net over 2 years, then calibrate and validate on a train/test split.

**Architecture:** All new behavior is opt-in via guardrails/CLI flags, default-off so the live decision path and every existing run stay byte-identical. Code tasks (1–5) are TDD. Experiment tasks (6–8) are controller-run sweeps that read results, pick parameters on the train window only, and record a research note — they implement no new code.

**Tech Stack:** Node ESM; pure functions in `src/core` / `src/backtest`; standalone `node tests/*.mjs` harness with a manual `ok()` counter.

**Spec:** `docs/specs/2026-06-11-pnl-campaign-design.md` (local, gitignored).

> **Doc handling:** spec/plan/research docs under `docs/` are gitignored. Every `git add` stages ONLY code/test files — never `docs/`, never `git add -A`/`.`. Commit trailer on its own line after a blank line: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

> **Live safety invariant (applies to every code task):** `src/agents/RiskPolicy.js` and `src/core/pipeline.js` are shared with live (`bot_engine.js`). Every new mode must default to the pre-existing behavior when its flag is unset, so `node tests/test_simulator.js` and the live path are unaffected. Strategy configs never set these flags.

---

## File Structure

- **Modify** `src/agents/RiskPolicy.js` — add `sizingMode` (Task 1) and `stopMode`/ATR/structural SL-TP (Task 3) to `evaluate()`. One file, the deterministic risk gate.
- **Modify** `src/backtest/simulator.js` — pass `equity` for compound sizing (Task 1); call breakeven helper (Task 4).
- **Create** `src/backtest/exitPolicy.js` — pure `breakevenStop()` (Task 4).
- **Modify** `src/indicators/technical.js` — add `atr()` (Task 2).
- **Modify** `src/core/pipeline.js` — compute ATR and pass into the risk ctx when `stopMode==='atr'` (Task 3).
- **Modify** `backtest/run-backtest.js` — CLI flags `--sizing` (Task 1), `--stopMode/--atrPeriod/--atrSL/--atrTP/--structuralRR` (Task 3), `--breakevenR` (Task 4).
- **Modify** `backtest/run-matrix.js` — `--sizing` per cell (Task 1).
- **Create** `templates/risk/pnl_rpt025.json … pnl_rpt100.json` (Task 5).
- **Create** tests: `tests/test_sizing_mode.mjs`, `tests/test_atr.mjs`, `tests/test_stop_modes.mjs`, `tests/test_breakeven.mjs`.

---

## Task 1: Compound sizing mode

**Files:**
- Modify: `src/agents/RiskPolicy.js` (sizing line ~66)
- Modify: `src/backtest/simulator.js` (decide block ~121-129)
- Modify: `backtest/run-backtest.js` (`buildGuardrails` ~13-32)
- Modify: `backtest/run-matrix.js` (cell loop ~102)
- Test: `tests/test_sizing_mode.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/test_sizing_mode.mjs`:

```js
// tests/test_sizing_mode.mjs
import assert from 'node:assert';
import { RiskPolicy } from '../src/agents/RiskPolicy.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

const buy = { side: 'BUY', conviction: 1 };
const base = { portfolioValue: 1000, riskPerTrade: 0.5, stopLossPct: 0.02, takeProfitPct: 0.04, minRiskRewardRatio: 0, leverage: 1 };

// --- fixed (default): size uses portfolioValue regardless of equity ---
{
  const rp = new RiskPolicy({ ...base }); // no sizingMode → 'fixed'
  const d = rp.evaluate(buy, { entryPrice: 100, equity: 9999 });
  assert.strictEqual(d.decision, 'PERMIT');
  assert.strictEqual(d.order.sizeUSD, 500, 'fixed ignores ctx.equity → 1000*0.5');
  ok('fixed mode ignores equity (byte-identical)');
}

// --- compound: size uses ctx.equity ---
{
  const rp = new RiskPolicy({ ...base, sizingMode: 'compound' });
  const grown = rp.evaluate(buy, { entryPrice: 100, equity: 2000 });
  assert.strictEqual(grown.order.sizeUSD, 1000, 'compound grows with equity → 2000*0.5');
  const shrunk = rp.evaluate(buy, { entryPrice: 100, equity: 400 });
  assert.strictEqual(shrunk.order.sizeUSD, 200, 'compound shrinks with equity → 400*0.5');
  ok('compound mode scales with equity');
}

// --- compound with no ctx.equity → fallback to portfolioValue ---
{
  const rp = new RiskPolicy({ ...base, sizingMode: 'compound' });
  const d = rp.evaluate(buy, { entryPrice: 100 }); // equity absent
  assert.strictEqual(d.order.sizeUSD, 500, 'compound falls back to portfolioValue when equity absent');
  ok('compound fallback when equity absent');
}

// --- maxTradeSizeUSD caps both modes ---
{
  const rp = new RiskPolicy({ ...base, sizingMode: 'compound', maxTradeSizeUSD: 300 });
  const d = rp.evaluate(buy, { entryPrice: 100, equity: 2000 });
  assert.strictEqual(d.order.sizeUSD, 300, 'cap applies in compound mode');
  ok('maxTradeSizeUSD caps compound');
}

console.log(`\n${passed} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_sizing_mode.mjs`
Expected: FAIL on the compound assertions (size still 500 because compound is not implemented).

- [ ] **Step 3: Implement compound sizing in RiskPolicy**

In `src/agents/RiskPolicy.js`, replace the single sizing line (currently):

```js
    // Sizing — single unit (USD)
    const sizeUSD = Math.min((g.portfolioValue || 0) * (g.riskPerTrade || 0), g.maxTradeSizeUSD ?? Infinity);
```

with:

```js
    // Sizing — single unit (USD). Compound mode sizes off live equity (passed by the
    // backtest simulator as ctx.equity); fixed mode (default) sizes off static portfolioValue.
    const sizingBase = (g.sizingMode === 'compound' && ctx && ctx.equity != null)
      ? ctx.equity
      : (g.portfolioValue || 0);
    const sizeUSD = Math.min(sizingBase * (g.riskPerTrade || 0), g.maxTradeSizeUSD ?? Infinity);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_sizing_mode.mjs`
Expected: PASS — `4 checks passed`.

- [ ] **Step 5: Wire equity into the simulator decide ctx**

In `src/backtest/simulator.js`, the decide block currently reads:

```js
      const portfolio = { openPositions: 0, portfolioHeatPct: 0, dailyPnlPct: 0, tradesToday: 0 };
      if (isFutures) portfolio.freeEquity = equity;
      const account = { guardrails, portfolio };
```

Change the middle line region to also pass equity for compound sizing:

```js
      const portfolio = { openPositions: 0, portfolioHeatPct: 0, dailyPnlPct: 0, tradesToday: 0 };
      if (isFutures) portfolio.freeEquity = equity;
      if (guardrails.sizingMode === 'compound') portfolio.equity = equity;
      const account = { guardrails, portfolio };
```

(`equity` here is the running settled equity — correct: the account is flat when a new entry is decided.)

- [ ] **Step 6: Run the simulator regression**

Run: `node tests/test_simulator.js`
Expected: still passes (no `sizingMode` set in those tests → fixed path unchanged). Prints its existing pass line ending `futures cases OK`.

- [ ] **Step 7: Add the `--sizing` CLI flag (single-run + matrix)**

In `backtest/run-backtest.js`, `buildGuardrails`, add one field to the returned object (place it next to `riskPerTrade`):

```js
    sizingMode: args.sizing === 'compound' ? 'compound' : 'fixed',
```

In `backtest/run-matrix.js`, in the cell loop right after `const guardrails = riskProfileToGuardrails(settings, { leverage, mmr });` add:

```js
        guardrails.sizingMode = args.sizing === 'compound' ? 'compound' : 'fixed';
```

- [ ] **Step 8: Smoke-check the flag end to end**

Run (uses `market_data.db`; pick a present cell):
```
node backtest/run-backtest.js --symbol XRPUSDT --tf 1H --logic SMC --equity 200 --riskPerTrade 0.5 --sl 0.03 --tp 0.06 --sizing compound --from 2024-06-01 --to 2025-06-01
```
Expected: run completes; Net PnL is materially larger than the same command without `--sizing compound` (compounding grows position size as equity rises). If `market_data.db` lacks XRPUSDT 1H, substitute any present cell. Report both numbers.

- [ ] **Step 9: Commit**

```
git add src/agents/RiskPolicy.js src/backtest/simulator.js backtest/run-backtest.js backtest/run-matrix.js tests/test_sizing_mode.mjs
git commit -m "feat(backtest): compound sizing mode (opt-in --sizing compound)"
```

---

## Task 2: `Technicals.atr` (Wilder)

**Files:**
- Modify: `src/indicators/technical.js` (add method to the `Technicals` object)
- Test: `tests/test_atr.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/test_atr.mjs`:

```js
// tests/test_atr.mjs
import assert from 'node:assert';
import { Technicals } from '../src/indicators/technical.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };
const c = (h, l, cl) => ({ high: h, low: l, close: cl });

// --- constant true range → ATR equals that constant ---
{
  // every bar: high 105, low 95, close 100, prev close 100 → TR = max(10,5,5) = 10.
  const candles = Array.from({ length: 20 }, () => c(105, 95, 100));
  const atr = Technicals.atr(candles, 14);
  assert.strictEqual(atr.length, 20 - 14, 'series length = n - period');
  for (const v of atr) assert.ok(Math.abs(v - 10) < 1e-9, 'constant TR → ATR = 10');
  ok('constant true range → ATR constant');
}

// --- insufficient data → [] ---
{
  const candles = Array.from({ length: 14 }, () => c(105, 95, 100)); // need > period
  assert.deepStrictEqual(Technicals.atr(candles, 14), [], 'n <= period → []');
  assert.deepStrictEqual(Technicals.atr([], 14), [], 'empty → []');
  ok('insufficient data → []');
}

// --- gap widens TR via |low - prevClose| ---
{
  // bars hold high=105 low=95 close=100 except a gap-down bar with low far below prev close.
  const candles = Array.from({ length: 16 }, () => c(105, 95, 100));
  candles[15] = c(105, 80, 100); // TR = max(25, |105-100|, |95? -> 80-100|=20) = 25
  const atr = Technicals.atr(candles, 14);
  assert.ok(atr[atr.length - 1] > 10, 'gap bar lifts the latest ATR above the 10 baseline');
  ok('gap widens true range');
}

console.log(`\n${passed} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_atr.mjs`
Expected: FAIL — `Technicals.atr is not a function`.

- [ ] **Step 3: Implement `atr`**

In `src/indicators/technical.js`, add this method to the `Technicals` object (after `highest`, before the closing `};`). Note it consumes candle objects, not a value array — documented inline:

```js
  /**
   * Wilder's Average True Range. Consumes OHLC candle objects (not a value array).
   * TR = max(high-low, |high-prevClose|, |low-prevClose|). Seed = SMA of the first
   * `period` TRs, then Wilder smoothing: ATR = (prevATR*(period-1) + TR) / period.
   * Returns an ascending ATR series of length (candles.length - period), or [] if
   * there are not more than `period` candles. (candles ascending by time)
   */
  atr(candles, period) {
    if (!Array.isArray(candles) || candles.length < period + 1) return [];
    const tr = [];
    for (let i = 1; i < candles.length; i++) {
      const h = candles[i].high, l = candles[i].low, pc = candles[i - 1].close;
      tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
    let sum = 0;
    for (let i = 0; i < period; i++) sum += tr[i];
    const out = [sum / period];
    for (let i = period; i < tr.length; i++) {
      out.push((out[out.length - 1] * (period - 1) + tr[i]) / period);
    }
    return out;
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_atr.mjs`
Expected: PASS — `3 checks passed`.

- [ ] **Step 5: Commit**

```
git add src/indicators/technical.js tests/test_atr.mjs
git commit -m "feat(indicators): Wilder ATR on Technicals"
```

---

## Task 3: ATR & structural stop modes

**Files:**
- Modify: `src/agents/RiskPolicy.js` (SL/TP block ~68-72)
- Modify: `src/core/pipeline.js` (compute ATR, pass into ctx)
- Modify: `backtest/run-backtest.js` (`buildGuardrails`)
- Test: `tests/test_stop_modes.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/test_stop_modes.mjs`:

```js
// tests/test_stop_modes.mjs
import assert from 'node:assert';
import { RiskPolicy } from '../src/agents/RiskPolicy.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };
const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-6, `${m}: ${a} vs ${b}`);

const buy = { side: 'BUY', conviction: 1 };
const sell = { side: 'SELL', conviction: 1 };
const g = { portfolioValue: 1000, riskPerTrade: 0.1, minRiskRewardRatio: 0, leverage: 1, stopLossPct: 0.02, takeProfitPct: 0.04 };

// --- ATR mode: SL/TP are atrSL/atrTP multiples of ctx.atr, mirrored by side ---
{
  const rp = new RiskPolicy({ ...g, stopMode: 'atr', atrSL: 2, atrTP: 4 });
  const b = rp.evaluate(buy, { entryPrice: 100, atr: 5 });
  near(b.order.slPrice, 90, 'BUY atr SL = 100 - 2*5');
  near(b.order.tpPrice, 120, 'BUY atr TP = 100 + 4*5');
  const s = rp.evaluate(sell, { entryPrice: 100, atr: 5 });
  near(s.order.slPrice, 110, 'SELL atr SL = 100 + 2*5');
  near(s.order.tpPrice, 80, 'SELL atr TP = 100 - 4*5');
  ok('atr mode SL/TP mirrored by side');
}

// --- ATR mode with invalid atr → fallback to percent ---
{
  const rp = new RiskPolicy({ ...g, stopMode: 'atr', atrSL: 2, atrTP: 4 });
  const b = rp.evaluate(buy, { entryPrice: 100, atr: null });
  near(b.order.slPrice, 98, 'fallback percent SL = 100*(1-0.02)');
  near(b.order.tpPrice, 104, 'fallback percent TP = 100*(1+0.04)');
  ok('atr invalid → percent fallback');
}

// --- structural mode: SL = invalidation, TP = entry + RR*risk ---
{
  const rp = new RiskPolicy({ ...g, stopMode: 'structural', structuralRR: 2 });
  const b = rp.evaluate(buy, { entryPrice: 100, invalidation: 96 }); // risk = 4
  near(b.order.slPrice, 96, 'structural SL = invalidation');
  near(b.order.tpPrice, 108, 'structural TP = 100 + 2*4');
  ok('structural mode uses invalidation + RR target');
}

// --- structural with wrong-side invalidation → fallback to percent ---
{
  const rp = new RiskPolicy({ ...g, stopMode: 'structural', structuralRR: 2 });
  const b = rp.evaluate(buy, { entryPrice: 100, invalidation: 105 }); // above entry for a BUY → invalid
  near(b.order.slPrice, 98, 'wrong-side invalidation → percent SL');
  ok('structural wrong-side → percent fallback');
}

// --- percent mode (default) unchanged ---
{
  const rp = new RiskPolicy({ ...g });
  const b = rp.evaluate(buy, { entryPrice: 100 });
  near(b.order.slPrice, 98, 'default percent SL');
  near(b.order.tpPrice, 104, 'default percent TP');
  ok('default percent mode unchanged');
}

console.log(`\n${passed} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_stop_modes.mjs`
Expected: FAIL — atr/structural assertions fail (only percent is implemented).

- [ ] **Step 3: Implement stop modes in RiskPolicy**

In `src/agents/RiskPolicy.js`, replace the SL/TP block (currently):

```js
    // SL/TP prices mirrored by side (round to 8 dp to avoid FP artifacts)
    const round = (n) => n == null ? null : Math.round(n * 1e8) / 1e8;
    const sl = g.stopLossPct, tp = g.takeProfitPct;
    const slPrice = sl == null ? null : round(proposal.side === 'BUY' ? entryPrice * (1 - sl) : entryPrice * (1 + sl));
    const tpPrice = tp == null ? null : round(proposal.side === 'BUY' ? entryPrice * (1 + tp) : entryPrice * (1 - tp));
```

with:

```js
    // SL/TP prices mirrored by side (round to 8 dp to avoid FP artifacts).
    // stopMode selects the SL/TP geometry; 'atr' and 'structural' fall back to 'percent'
    // when their inputs are missing/invalid, so behavior degrades safely.
    const round = (n) => n == null ? null : Math.round(n * 1e8) / 1e8;
    const isBuy = proposal.side === 'BUY';
    const sl = g.stopLossPct, tp = g.takeProfitPct;
    const pctSl = sl == null ? null : round(isBuy ? entryPrice * (1 - sl) : entryPrice * (1 + sl));
    const pctTp = tp == null ? null : round(isBuy ? entryPrice * (1 + tp) : entryPrice * (1 - tp));

    let slPrice = pctSl, tpPrice = pctTp;
    if (g.stopMode === 'atr' && ctx && ctx.atr > 0) {
      const kSl = g.atrSL ?? 2, kTp = g.atrTP ?? 4;
      slPrice = round(isBuy ? entryPrice - kSl * ctx.atr : entryPrice + kSl * ctx.atr);
      tpPrice = round(isBuy ? entryPrice + kTp * ctx.atr : entryPrice - kTp * ctx.atr);
    } else if (g.stopMode === 'structural' && ctx && ctx.invalidation != null
               && (isBuy ? ctx.invalidation < entryPrice : ctx.invalidation > entryPrice)) {
      const rr = g.structuralRR ?? 2;
      const risk = Math.abs(entryPrice - ctx.invalidation);
      slPrice = round(ctx.invalidation);
      tpPrice = round(isBuy ? entryPrice + rr * risk : entryPrice - rr * risk);
    }
```

(The rest of the method — the spot/futures PERMIT returns using `slPrice`/`tpPrice` — is unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_stop_modes.mjs`
Expected: PASS — `5 checks passed`.

- [ ] **Step 5: Plumb ATR into the pipeline ctx**

In `src/core/pipeline.js`, add the import at the top (after the existing imports). Use the
direct module path — `src/indicators/index.js` imports `Technicals` but does NOT re-export it,
so import from `technical.js` (same as `classifyHTFTrend` does):

```js
import { Technicals } from '../indicators/technical.js';
```

Then in `evaluateBar`, compute ATR only when the gate asks for it and pass it into the risk ctx. Replace the body's decision construction:

```js
export function evaluateBar(ctx, account) {
  const price = ctx.candles[ctx.candles.length - 1].close;
  const raw = new IndicatorManager(ctx.config.logic || {}).calculate(ctx.config.logicType, ctx.candles);
  const signal = deriveSignal(ctx.config.logicType, raw, { price, candles: ctx.candles });
  const g = account.guardrails || {};
  let atr = null;
  if (g.stopMode === 'atr') {
    const series = Technicals.atr(ctx.candles, g.atrPeriod || 14);
    atr = series.length ? series[series.length - 1] : null;
  }
  const decision = new RiskPolicy(g).evaluate(signal, {
    ...(account.portfolio || {}),
    entryPrice: price,
    invalidation: signal.invalidation ?? null,
    atr,
  });
  return { signal, decision };
}
```

- [ ] **Step 6: Pipeline regression — default path unchanged**

Run: `node tests/test_simulator.js` and `node tests/test_stop_modes.mjs`
Expected: both pass. With no `stopMode` set, `atr` stays `null` and the decision is identical to before.

- [ ] **Step 7: Add the stop-mode CLI flags**

In `backtest/run-backtest.js`, `buildGuardrails`, add these fields to the returned object:

```js
    stopMode: args.stopMode || 'percent',
    atrPeriod: num(args.atrPeriod, 14),
    atrSL: num(args.atrSL, 2),
    atrTP: num(args.atrTP, 4),
    structuralRR: num(args.structuralRR, 2),
```

- [ ] **Step 8: Smoke-check ATR stops end to end**

Run (disable the RR gate during ATR runs since its percent-ratio proxy doesn't reflect ATR geometry):
```
node backtest/run-backtest.js --symbol XRPUSDT --tf 1H --logic SMC --equity 200 --riskPerTrade 0.5 --sizing compound --stopMode atr --atrSL 2 --atrTP 4 --minRR 0 --from 2024-06-01 --to 2025-06-01
```
Expected: run completes; trades show ATR-derived SL/TP distances (varying, not fixed %). Report PnL and trade count vs the percent-stop equivalent.

- [ ] **Step 9: Commit**

```
git add src/agents/RiskPolicy.js src/core/pipeline.js backtest/run-backtest.js tests/test_stop_modes.mjs
git commit -m "feat(risk): ATR and structural stop modes (opt-in, percent fallback)"
```

---

## Task 4: Breakeven exit policy

**Files:**
- Create: `src/backtest/exitPolicy.js`
- Modify: `src/backtest/simulator.js` (entry block ~66-73; new step after exit management ~119)
- Modify: `backtest/run-backtest.js` (`main()` builds `exitPolicy`; `runOne` forwards it)
- Test: `tests/test_breakeven.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/test_breakeven.mjs`:

```js
// tests/test_breakeven.mjs
import assert from 'node:assert';
import { breakevenStop } from '../src/backtest/exitPolicy.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

// BUY: entry 100, initial SL 90 → R = 10. breakevenR 1 → target 110.
{
  const pos = { side: 'BUY', entryPrice: 100, initialSlPrice: 90, slPrice: 90 };
  assert.strictEqual(breakevenStop(pos, { high: 109, low: 95 }, 1), 90, 'not reached → unchanged');
  assert.strictEqual(breakevenStop(pos, { high: 111, low: 95 }, 1), 100, 'reached → SL moves to entry');
  ok('BUY breakeven moves SL to entry once target hit');
}

// SELL: entry 100, initial SL 110 → R = 10. breakevenR 1 → target 90.
{
  const pos = { side: 'SELL', entryPrice: 100, initialSlPrice: 110, slPrice: 110 };
  assert.strictEqual(breakevenStop(pos, { high: 105, low: 91 }, 1), 110, 'not reached → unchanged');
  assert.strictEqual(breakevenStop(pos, { high: 105, low: 89 }, 1), 100, 'reached → SL moves to entry');
  ok('SELL breakeven moves SL to entry once target hit');
}

// profit-only: never moves SL adversely; R=0 or breakevenR<=0 → unchanged
{
  const buy = { side: 'BUY', entryPrice: 100, initialSlPrice: 90, slPrice: 99 };
  assert.strictEqual(breakevenStop(buy, { high: 111, low: 95 }, 1), 100, 'BUY moves up to entry (max)');
  const flat = { side: 'BUY', entryPrice: 100, initialSlPrice: 100, slPrice: 100 };
  assert.strictEqual(breakevenStop(flat, { high: 200, low: 95 }, 1), 100, 'R=0 → unchanged');
  const off = { side: 'BUY', entryPrice: 100, initialSlPrice: 90, slPrice: 90 };
  assert.strictEqual(breakevenStop(off, { high: 999, low: 95 }, 0), 90, 'breakevenR<=0 → unchanged');
  ok('profit-only and guarded edges');
}

console.log(`\n${passed} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_breakeven.mjs`
Expected: FAIL — cannot find module `../src/backtest/exitPolicy.js`.

- [ ] **Step 3: Implement the pure helper**

Create `src/backtest/exitPolicy.js`:

```js
// src/backtest/exitPolicy.js
/**
 * Breakeven stop move. R = |entryPrice - initialSlPrice|. Once the bar's favorable
 * excursion reaches entry ± breakevenR*R, return the stop moved to entryPrice; otherwise
 * return the current slPrice unchanged. Profit-only (never widens the stop) and pure — the
 * caller is responsible for applying it once (one-shot flag) so it does not re-fire.
 *
 * @param {{side:'BUY'|'SELL', entryPrice:number, initialSlPrice:number, slPrice:number}} position
 * @param {{high:number, low:number}} bar
 * @param {number} breakevenR R-multiple that triggers the move (e.g. 1)
 * @returns {number} the (possibly moved) stop price
 */
export function breakevenStop(position, bar, breakevenR) {
  const R = Math.abs(position.entryPrice - position.initialSlPrice);
  if (!(R > 0) || !(breakevenR > 0)) return position.slPrice;
  if (position.side === 'BUY') {
    if (bar.high >= position.entryPrice + breakevenR * R) {
      return Math.max(position.slPrice, position.entryPrice);
    }
  } else {
    if (bar.low <= position.entryPrice - breakevenR * R) {
      return Math.min(position.slPrice, position.entryPrice);
    }
  }
  return position.slPrice;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_breakeven.mjs`
Expected: PASS — `3 checks passed`.

- [ ] **Step 5: Wire the helper into the simulator**

In `src/backtest/simulator.js`:

(a) Import at the top, next to the execution import:

```js
import { breakevenStop } from './exitPolicy.js';
```

(b) In the entry block (where `position = { ... }` is built at step 1), add two fields so breakeven has its reference and one-shot flag:

```js
        fundingAccrued: 0, lastFundingTime: bar.time,
        initialSlPrice: pending.slPrice, breakevenMoved: false,
```

(c) Add a new step immediately AFTER the exit-management block (after the `if (position) { ... checkExit ... }` block closes, before step 4 "If flat, decide"):

```js
    // 3b) Breakeven stop. Recomputes the stop AFTER this bar's exit check, so it only
    // affects subsequent bars (no intrabar ambiguity). One-shot, profit-only.
    if (position && p.exitPolicy && p.exitPolicy.breakevenR != null && !position.breakevenMoved) {
      const moved = breakevenStop(position, bar, p.exitPolicy.breakevenR);
      if (moved !== position.slPrice) { position.slPrice = moved; position.breakevenMoved = true; }
    }
```

- [ ] **Step 6: Simulator regression**

Run: `node tests/test_simulator.js` and `node tests/test_breakeven.mjs`
Expected: both pass. With no `p.exitPolicy`, step 3b is skipped → existing simulator behavior byte-identical.

- [ ] **Step 7: Add the `--breakevenR` CLI flag**

In `backtest/run-backtest.js`, `runOne` builds the `simulate({...})` call. Add `exitPolicy: p.exitPolicy` to that object literal (next to `funding`):

```js
    { candles: p.candles, config, guardrails: p.guardrails, costs: p.costs, symbol: p.symbol, timeframe: p.tf, lookback: p.lookback, startEquity: p.guardrails.portfolioValue, funding, exitPolicy: p.exitPolicy },
```

In `main()`, build `exitPolicy` from the flag and pass it into the `runOne(...)` arg object:

```js
  const exitPolicy = args.breakevenR != null ? { breakevenR: Number(args.breakevenR) } : undefined;
```

and add `exitPolicy,` to the `runOne(btRepo, { ... })` argument object.

- [ ] **Step 8: Smoke-check breakeven end to end**

Run:
```
node backtest/run-backtest.js --symbol XRPUSDT --tf 1H --logic SMC --equity 200 --riskPerTrade 0.5 --sizing compound --sl 0.03 --tp 0.06 --breakevenR 1 --from 2024-06-01 --to 2025-06-01
```
Expected: run completes; trade outcomes differ from the no-breakeven run (some losers become ~breakeven exits). Report PnL/WR vs the no-breakeven equivalent.

- [ ] **Step 9: Commit**

```
git add src/backtest/exitPolicy.js src/backtest/simulator.js backtest/run-backtest.js tests/test_breakeven.mjs
git commit -m "feat(backtest): breakeven exit policy (opt-in --breakevenR)"
```

---

## Task 5: PnL risk templates

**Files:**
- Create: `templates/risk/pnl_rpt025.json`, `pnl_rpt050.json`, `pnl_rpt075.json`, `pnl_rpt100.json`

- [ ] **Step 1: Inspect an existing template for the exact shape**

Read one current file, e.g. `templates/risk/aggressive.json` (or whatever exists under `templates/risk/`), to copy its key casing (snake_case `*_percent` settings) exactly. The matrix loads via `loadRiskProfile` → `toCamel(raw.content?.settings || raw.settings || raw)`, so match the existing structure precisely (settings wrapper if the others use one).

- [ ] **Step 2: Create the four templates**

Create `templates/risk/pnl_rpt050.json` mirroring the existing template's structure, with these values (and the analogous files for 0.25/0.75/1.0 differing only in `risk_per_trade_percent`):

```json
{
  "name": "PnL rpt 0.50",
  "settings": {
    "risk_per_trade_percent": 50,
    "stop_loss_percent": 3,
    "take_profit_percent": 6,
    "min_risk_reward_ratio": 1.5,
    "max_open_positions": 1,
    "daily_loss_limit_percent": 100,
    "max_trades_per_day": 999999
  }
}
```

> Adjust the wrapper to match the sibling templates: if they put settings at the top level (no `settings` key), do the same. If `risk_per_trade_percent` is stored as a fraction elsewhere, follow the project's stored convention (snake_case percent per CLAUDE.md casing policy — `50` means 50%). The four files differ ONLY in `risk_per_trade_percent`: 25 / 50 / 75 / 100, and their `name`.

- [ ] **Step 3: Verify they load**

Run a 1-cell matrix on the train window to confirm the templates parse and produce a run:
```
node backtest/run-matrix.js --risks pnl_rpt050 --logics SMC --symbols XRPUSDT --tfs 1H --sizing compound --from 2024-06-01 --to 2025-06-01 --group pnl_tmpl_check
```
Expected: one cell runs, no "ERROR ... cannot load risk profile". Report the cell's PnL.

- [ ] **Step 4: Commit**

```
git add templates/risk/pnl_rpt025.json templates/risk/pnl_rpt050.json templates/risk/pnl_rpt075.json templates/risk/pnl_rpt100.json
git commit -m "feat(templates): pnl_rpt{025,050,075,100} risk profiles for sizing sweep"
```

---

## Task 6 (controller-run): Phase 2 — exposure calibration on train

No new code. The controller runs this sweep and records results; it picks parameters on the **train window only**.

- [ ] **Step 1: Run the sizing sweep on train**

```
node backtest/run-matrix.js --risks pnl_rpt025,pnl_rpt050,pnl_rpt075,pnl_rpt100 --logics SMC --symbols XRPUSDT,SOLUSDT,BTCUSDT --tfs 1H --sizing compound --from 2024-06-01 --to 2025-06-01 --group pnl_p2_sizing
```
Also run the same with `--htf` appended into `--group pnl_p2_sizing_htf`.

- [ ] **Step 2: Read results and pick the base**

Query `backtest.db` for `run_group IN ('pnl_p2_sizing','pnl_p2_sizing_htf')`, columns: symbol, rpt, htf on/off, train netPnlPct, train MaxDD, trades, WR. Select the **highest `riskPerTrade` whose train MaxDD ≤ 20%** for the best symbol/HTF combination. Record the chosen base config (symbol, rpt, sl/tp, htf) in a scratch note.

- [ ] **Step 3: Record**

Append the Phase 2 table and the chosen base to `docs/research/<run-date>-pnl-campaign.md` (create it). No commit (docs are gitignored).

---

## Task 7 (controller-run): Phase 3 — edge experiments on train

No new code. One lever at a time, on the chosen base, train window only. Accept a lever only if it improves train PnL or lowers train MaxDD across a **plateau** of neighboring parameter values (not a single point).

- [ ] **Step 1: ATR stops grid**

For the chosen base symbol, sweep individual single-runs (atrSL ∈ {1.5,2,3} × atrTP ∈ {3,4,6}), each with `--minRR 0`:
```
node backtest/run-backtest.js --symbol <BASE> --tf 1H --logic SMC --equity 200 --riskPerTrade <BASE_RPT> --sizing compound --stopMode atr --atrSL <x> --atrTP <y> --minRR 0 --from 2024-06-01 --to 2025-06-01 --group pnl_p3_atr
```
Record PnL/MaxDD per point. Keep ATR stops only if a contiguous region beats the percent base.

- [ ] **Step 2: Structural stops**

```
node backtest/run-backtest.js --symbol <BASE> --tf 1H --logic SMC --equity 200 --riskPerTrade <BASE_RPT> --sizing compound --stopMode structural --structuralRR <r> --from 2024-06-01 --to 2025-06-01 --group pnl_p3_struct
```
for `r ∈ {1.5, 2, 3}`. Compare to base and to the ATR winner.

- [ ] **Step 3: Breakeven**

```
node backtest/run-backtest.js --symbol <BASE> --tf 1H --logic SMC --equity 200 --riskPerTrade <BASE_RPT> --sizing compound --sl 0.03 --tp 0.06 --breakevenR <b> --from 2024-06-01 --to 2025-06-01 --group pnl_p3_be
```
for `b ∈ {0.5, 1, 1.5}`. Keep only if it lowers MaxDD without killing PnL on a plateau.

- [ ] **Step 4: Assemble ≤2 candidates**

Combine the winning levers into at most TWO full candidate configs (e.g. "best PnL" and "best risk-adjusted"). Record both, with every flag, in the research note BEFORE Phase 4.

---

## Task 8 (controller-run): Phase 4 — freeze & blind test

No new code. Run each frozen candidate exactly once on full period and once on the test window.

- [ ] **Step 1: Full-period and test-window runs**

For each of the ≤2 candidates, run the exact frozen flag set on:
- full: `--from 2024-06-01 --to 2026-06-08 --group pnl_p4_full`
- test: `--from 2025-06-01 --to 2026-06-08 --group pnl_p4_test`

- [ ] **Step 2: Verdict**

Compute, per candidate: full netPnlPct, train netPnlPct, test netPnlPct, MaxDD (full), trades (test ≥ 20?), WR, profit factor. Apply the §2 success criterion (full ≥ +100% AND test > 0 AND MaxDD ≤ 30%). State PASS/FAIL **in plain text**, including an honest FAIL with the best achieved numbers if the bar isn't met. Do not re-optimize after seeing test.

- [ ] **Step 3: Write the research note**

Finalize `docs/research/<run-date>-pnl-campaign.md`: baseline (+10.13%), Phase 2 table, Phase 3 lever findings, the ≤2 frozen candidates, Phase 4 full/train/test results, and the verdict. (Local, gitignored — no commit.)

---

## Self-Review

**1. Spec coverage:**
- §3 compound sizing → Task 1 (RiskPolicy + simulator + both CLIs + tests). ✓
- §5(a) ATR + Wilder `Technicals.atr` → Task 2; ATR stop mode + pipeline plumbing → Task 3. ✓
- §5(b) structural SL from invalidation → Task 3. ✓
- §5(c) breakeven (simulator-only) → Task 4 (pure helper + simulator + CLI). ✓
- §4 exposure calibration + risk templates → Task 5 (templates) + Task 6 (sweep). ✓
- §5 edge experiments (plateau discipline) → Task 7. ✓
- §6 freeze + blind test + research note → Task 8. ✓
- §6 tests (sizing/atr/stop modes/breakeven) → Tasks 1–4 each ship a test file; all existing suites kept green via explicit regression steps. ✓
- §7 out-of-scope (new logic, portfolio mode, walk-forward, live wiring, BREAKOUT) → no task touches them. ✓
- §2 lev=1, train/test split, ≤2 candidates → encoded in Tasks 6–8 commands and verdict step. ✓

**2. Placeholder scan:** Code steps contain complete code. The only deliberately parameterized items are the Phase 2/3 sweep values (`<BASE>`, `<x>`, `<b>`) — these are controller decisions made from results, not code placeholders, and each carries an exact command template and decision rule. Task 5 Step 2 flags the one shape-uncertainty (template wrapper/casing) with an explicit verification instruction rather than a guess. ✓

**3. Type consistency:** `sizingMode` ('fixed'|'compound'), `stopMode` ('percent'|'atr'|'structural'), guardrail keys (`atrSL/atrTP/atrPeriod/structuralRR`), ctx keys (`equity`, `atr`, `invalidation`), and `exitPolicy.breakevenR` are used identically across RiskPolicy, pipeline, simulator, CLI, and tests. `Technicals.atr` returns a series; the pipeline takes its last element (matching how classifyHTFTrend consumes `ema`). `breakevenStop(position, bar, breakevenR)` signature identical in helper, test, and simulator call site. ✓
