# Phase 4 — Futures Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the spot backtest into a leveraged-futures simulator — RiskPolicy leverage/margin path, isolated-margin liquidation, and 8h funding accrual — while keeping the `leverage = 1` spot path byte-for-byte identical to Phase 3.

**Architecture:** Pure core / imperative shell, unchanged. A new pure `liqPrice` helper lives in `src/core/` (so both RiskPolicy and the shell share one formula with no agents→backtest dependency). A new pure `funding` module builds a deterministic funding-rate series (real data where the DB has it; a synthetic fallback derived from the real mean — or optional tiling — elsewhere; no randomness, to preserve determinism and cross-config comparability). `RiskPolicy.evaluate` gains a futures branch that is **dormant** at `leverage = 1`. The simulator reserves isolated margin, accrues funding per bar, and adds a liquidation exit whose loss is capped at margin. Metrics and the CLI surface funding + liquidation counts that were already stubbed as `0`.

**Tech Stack:** Node.js ESM, `node:assert` test scripts run via `node tests/<file>.js` (no test framework, no new deps). SQLite via `sqlite`/`sqlite3` (already present). snake_case in DB/JSON, camelCase in JS.

**Design decisions locked in (from the user):**
- **Funding model:** real funding where present in `market_data.db`; outside that window a **synthetic constant = mean of the real rates** (mode `real-mean`, default). Optional `tile` mode repeats the real series cyclically; `constant` mode uses an explicit `--funding-rate`. **No random mode** (would break determinism and make config sweeps non-comparable).
- **"SL beyond liquidation" gate:** `PERMIT` + attach a `warning` (never `DENY`). Liquidations then show up honestly in `metrics.costs.liquidationCount`.
- **Parity guarantee:** at `leverage = 1`, every futures addition is inert. The Phase 3 spot tests (`test_execution.js`, `test_simulator.js`, `test_metrics.js`, `test_run_backtest.js`, `test_backtest_integration.js`) MUST still pass unchanged.

**Approximations (labeled, per spec §6/§12):** isolated margin only; one position per instance; single-tier MMR; liquidation on candle price (not mark price); funding charged at 8h epoch boundaries on the bar whose close crosses the boundary; on liquidation the realized loss = `margin + liq fee + accrued funding` (entry fee is absorbed into the margin loss so total loss stays capped at margin + fees).

---

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `src/core/liquidation.js` | **Create** | Pure `liqPrice(entry, side, leverage, mmr)` — isolated-margin liquidation price. Shared by RiskPolicy + shell. |
| `src/core/contracts.js` | Modify | Extend `Order` (+`marginUSD`,`leverage`), `AccountState` (+`leverage`,`freeEquity`,`mmr`), `Decision` (+`warning`) typedefs. |
| `src/agents/RiskPolicy.js` | Modify | Futures branch (leverage>1): `marginUSD`, margin gate, SL-beyond-liq warning. Spot path byte-identical. |
| `src/backtest/funding.js` | **Create** | Pure `buildFundingSeries({realRows,mode,constantRate})→rateAt(time)` + `fundingBetween(...)`. |
| `src/backtest/execution.js` | Modify | `checkExit` gains an optional `liqPrice` level (LIQUIDATION / LIQ_GAP), adverse-level-first ordering. Spot behavior unchanged. |
| `src/backtest/simulator.js` | Modify | Futures: reserve margin, compute `liqPrice` at fill, accrue funding per bar, liquidation exit (loss capped at margin). Spot path unchanged. |
| `src/backtest/metrics.js` | Modify | Populate `costs.totalFunding` (Σ `trade.funding`) and `costs.liquidationCount` (reason starts with `LIQ`). Both `0` for spot. |
| `backtest/run-backtest.js` | Modify | Remove the `leverage !== 1` throw; add `--leverage/--mmr/--funding-mode/--funding-rate/--liq-fee`; build the funding series; pass futures inputs to `simulate`; print a futures cost block. |
| `tests/test_liquidation.js` | **Create** | Unit tests for `liqPrice`. |
| `tests/test_funding.js` | **Create** | Unit tests for the funding series + accrual. |
| `tests/test_futures_integration.js` | **Create** | Real-pipeline futures run: margin/funding/liquidation seam, determinism, parity vs spot. |
| `tests/test_risk_policy.mjs` | Modify | Add futures-branch + parity cases. |
| `tests/test_execution.js` | Modify | Add liquidation exit cases (existing cases must still pass). |
| `tests/test_simulator.js` | Modify | Add leveraged-liquidation + funding-accrual + parity cases. |
| `tests/test_metrics.js` | Modify | Add funding/liquidation aggregation cases. |
| `tests/test_run_backtest.js` | Modify | Add futures builder cases. |

---

## Task 1: Core liquidation helper

**Files:**
- Create: `src/core/liquidation.js`
- Test: `tests/test_liquidation.js`

- [ ] **Step 1: Write the failing test**

Create `tests/test_liquidation.js`:

```js
import assert from 'node:assert';
import { liqPrice } from '../src/core/liquidation.js';

// Long 10x, mmr 0.005: liq ≈ entry × (1 − 1/10 + 0.005) = entry × 0.905
assert.ok(Math.abs(liqPrice(100, 'BUY', 10, 0.005) - 90.5) < 1e-9, 'long 10x liq');
// Short 10x: liq ≈ entry × (1 + 1/10 − 0.005) = entry × 1.095
assert.ok(Math.abs(liqPrice(100, 'SELL', 10, 0.005) - 109.5) < 1e-9, 'short 10x liq');
// Long 5x, mmr 0: liq = entry × 0.8
assert.ok(Math.abs(liqPrice(200, 'BUY', 5, 0) - 160) < 1e-9, 'long 5x liq no-mmr');
// Higher leverage → liq closer to entry (long)
assert.ok(liqPrice(100, 'BUY', 20, 0.005) > liqPrice(100, 'BUY', 5, 0.005), 'more leverage → closer liq (long)');
// Spot / no inputs → null (no liquidation concept)
assert.strictEqual(liqPrice(100, 'BUY', 1, 0.005), null, 'leverage 1 → null');
assert.strictEqual(liqPrice(100, 'BUY', 10, null), null, 'no mmr → null');
assert.strictEqual(liqPrice(100, 'HOLD', 10, 0.005), null, 'bad side → null');

console.log('test_liquidation.js OK');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_liquidation.js`
Expected: FAIL — `Cannot find module '.../src/core/liquidation.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/liquidation.js`:

```js
/**
 * Isolated-margin liquidation price (single-tier MMR, v1 approximation).
 * Long  ≈ entry × (1 − 1/leverage + mmr)
 * Short ≈ entry × (1 + 1/leverage − mmr)
 * Returns null when liquidation does not apply (spot / missing inputs).
 *
 * @param {number} entry entry (fill) price
 * @param {'BUY'|'SELL'} side position side
 * @param {number} leverage >1 for futures
 * @param {number} mmr maintenance margin rate (e.g. 0.005)
 * @returns {number|null}
 */
export function liqPrice(entry, side, leverage, mmr) {
  if (!(leverage > 1) || mmr == null || !Number.isFinite(mmr) || !Number.isFinite(entry)) return null;
  if (side === 'BUY') return entry * (1 - 1 / leverage + mmr);
  if (side === 'SELL') return entry * (1 + 1 / leverage - mmr);
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_liquidation.js`
Expected: `test_liquidation.js OK`.

- [ ] **Step 5: Commit**

```bash
git add src/core/liquidation.js tests/test_liquidation.js
git commit -m "feat(core): pure isolated-margin liquidation-price helper" -m "Long entry*(1-1/lev+mmr), short mirror; null for spot/missing inputs. Shared by RiskPolicy and the execution shell to avoid an agents->backtest dependency." -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: RiskPolicy futures path + contract typedefs

**Files:**
- Modify: `src/core/contracts.js`
- Modify: `src/agents/RiskPolicy.js`
- Test: `tests/test_risk_policy.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_risk_policy.mjs` (before any final `console.log`, or at end — these are standalone assertions):

```js
// ---- Phase 4: futures branch ----
import { RiskPolicy as RP4 } from '../src/agents/RiskPolicy.js';
import assert4 from 'node:assert';

const baseG = {
  portfolioValue: 10000, riskPerTrade: 0.1, maxTradeSizeUSD: Infinity,
  stopLossPct: 0.02, takeProfitPct: 0.04, minRiskRewardRatio: 1.5,
  maxOpenPositions: 1, maxPortfolioHeatPct: 100, dailyLossLimitPct: 1,
  dailyProfitTargetPct: null, maxTradesPerDay: 999999,
};

// Parity: leverage=1 (and absent) → Order has NO marginUSD/leverage, byte-identical to spot shape.
const spot = new RP4(baseG).evaluate({ side: 'BUY', conviction: 1 }, { entryPrice: 100 });
assert4.deepStrictEqual(spot, {
  decision: 'PERMIT',
  order: { side: 'BUY', sizeUSD: 1000, entryPrice: 100, slPrice: 98, tpPrice: 104 },
}, 'leverage=1 spot Order is byte-identical (no futures fields)');

// Futures: leverage=5 → marginUSD = sizeUSD/leverage, futures fields present.
const fut = new RP4({ ...baseG, leverage: 5, mmr: 0.005 }).evaluate({ side: 'BUY', conviction: 1 }, { entryPrice: 100, freeEquity: 10000 });
assert4.strictEqual(fut.decision, 'PERMIT', 'futures permits');
assert4.strictEqual(fut.order.marginUSD, 200, 'marginUSD = 1000/5');
assert4.strictEqual(fut.order.leverage, 5, 'leverage echoed in order');
assert4.strictEqual(fut.order.sizeUSD, 1000, 'sizeUSD stays the notional');
assert4.ok(!('warning' in fut) || fut.warning == null, 'tight SL → no liq warning');

// Margin gate: marginUSD must fit free equity.
const broke = new RP4({ ...baseG, riskPerTrade: 1, leverage: 2, mmr: 0.005 })
  .evaluate({ side: 'BUY', conviction: 1 }, { entryPrice: 100, freeEquity: 100 });
assert4.strictEqual(broke.decision, 'DENY', 'margin > free equity → DENY');
assert4.ok(/[Mm]argin/.test(broke.reason), 'deny reason mentions margin');

// SL-beyond-liquidation → PERMIT + warning (NOT deny). Wide SL (50%) sits past the 10x liq (~90.5).
const warn = new RP4({ ...baseG, stopLossPct: 0.5, takeProfitPct: 0.75, leverage: 10, mmr: 0.005 })
  .evaluate({ side: 'BUY', conviction: 1 }, { entryPrice: 100, freeEquity: 10000 });
assert4.strictEqual(warn.decision, 'PERMIT', 'wide SL still permits');
assert4.ok(warn.warning && /liquidat/i.test(warn.warning), 'warning flags liquidation risk');

console.log('test_risk_policy.mjs futures cases OK');
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/test_risk_policy.mjs`
Expected: FAIL — `fut.order.marginUSD` is `undefined` (futures branch not implemented).

- [ ] **Step 3a: Extend contract typedefs**

In `src/core/contracts.js`, replace the `AccountState`, `Order`, and `Decision` typedef blocks with:

```js
 * @typedef {Object} AccountState
 * @property {number} entryPrice
 * @property {number} [openPositions]
 * @property {number} [portfolioHeatPct]
 * @property {number} [dailyPnlPct]
 * @property {number} [tradesToday]
 * @property {number} [freeEquity] - free equity available for margin (futures)
 *
 * @typedef {Object} Order
 * @property {'BUY'|'SELL'} side
 * @property {number} sizeUSD - position notional in USD
 * @property {number} entryPrice
 * @property {number|null} slPrice
 * @property {number|null} tpPrice
 * @property {number} [marginUSD] - reserved margin (futures only; sizeUSD/leverage)
 * @property {number} [leverage] - position leverage (futures only)
 *
 * @typedef {Object} Decision
 * @property {'PERMIT'|'DENY'} decision
 * @property {string} [reason]
 * @property {string} [warning] - non-blocking advisory (e.g. SL beyond liquidation)
 * @property {Order} [order]
 */
```

(Leverage and `mmr` are carried on the guardrails object, not in the typedef list — guardrails is an open config bag.)

- [ ] **Step 3b: Add the futures branch to RiskPolicy**

In `src/agents/RiskPolicy.js`, add the import at the top (after the file's opening comment):

```js
import { liqPrice } from '../core/liquidation.js';
```

Then replace the final `return { decision: 'PERMIT', order: {...} };` block (the spot return at the end of `evaluate`) with:

```js
    const leverage = g.leverage || 1;
    if (leverage <= 1) {
      // SPOT — byte-identical to pre-Phase-4 behavior (futures additions dormant).
      return {
        decision: 'PERMIT',
        order: { side: proposal.side, sizeUSD, entryPrice, slPrice, tpPrice },
      };
    }

    // FUTURES (leverage > 1) — isolated margin.
    const marginUSD = Math.round((sizeUSD / leverage) * 1e8) / 1e8;
    const free = ctx.freeEquity != null ? ctx.freeEquity : (g.portfolioValue || 0);
    if (marginUSD > free) {
      return { decision: 'DENY', reason: `Margin ${marginUSD.toFixed(2)} exceeds free equity ${free.toFixed(2)}` };
    }

    // "SL beyond liquidation" → PERMIT + warning (never DENY); honest liquidation cost surfaces in metrics.
    let warning;
    const liq = liqPrice(entryPrice, proposal.side, leverage, g.mmr);
    if (liq != null && slPrice != null) {
      const slBeyondLiq = proposal.side === 'BUY' ? slPrice <= liq : slPrice >= liq;
      if (slBeyondLiq) {
        warning = `SL ${slPrice} is at/beyond liquidation ${liq.toFixed(2)} at ${leverage}x — liquidation may trigger first`;
      }
    }

    const result = {
      decision: 'PERMIT',
      order: { side: proposal.side, sizeUSD, marginUSD, entryPrice, slPrice, tpPrice, leverage },
    };
    if (warning) result.warning = warning;
    return result;
```

> **Note on heat:** the spot notional-heat gate above stays as-is. In the single-position backtest instance `portfolioHeatPct` is always 0, so it never trips; margin-based portfolio heat belongs to the deferred portfolio-risk layer (spec §7/§12) and is intentionally out of scope here.

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/test_risk_policy.mjs`
Expected: existing assertions pass + `test_risk_policy.mjs futures cases OK`.

- [ ] **Step 5: Commit**

```bash
git add src/core/contracts.js src/agents/RiskPolicy.js tests/test_risk_policy.mjs
git commit -m "feat(risk): RiskPolicy futures branch (margin, gate, liq warning)" -m "leverage>1: marginUSD=sizeUSD/leverage, margin gate vs free equity, SL-beyond-liquidation -> PERMIT+warning. leverage=1 path byte-identical to spot (verified by parity test). Extends Order/AccountState/Decision typedefs." -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Funding series module

**Files:**
- Create: `src/backtest/funding.js`
- Test: `tests/test_funding.js`

- [ ] **Step 1: Write the failing test**

Create `tests/test_funding.js`:

```js
import assert from 'node:assert';
import { buildFundingSeries, fundingBetween } from '../src/backtest/funding.js';

const H8 = 8 * 3600000; // 8h in ms
// Real rows at three consecutive 8h boundaries.
const real = [
  { time: 2 * H8, rate: 0.0001 },
  { time: 3 * H8, rate: 0.0003 },
  { time: 4 * H8, rate: -0.0002 }, // mean = (0.0001+0.0003-0.0002)/3 = 0.0000666...
];

// real-mean: inside coverage → exact real rate; outside → mean of real.
const rm = buildFundingSeries({ realRows: real, mode: 'real-mean' });
assert.strictEqual(rm(3 * H8), 0.0003, 'real rate used inside coverage');
const mean = (0.0001 + 0.0003 - 0.0002) / 3;
assert.ok(Math.abs(rm(100 * H8) - mean) < 1e-12, 'mean used outside coverage');
assert.ok(Math.abs(rm(0) - mean) < 1e-12, 'mean used before coverage');

// constant: explicit rate everywhere.
const cn = buildFundingSeries({ realRows: real, mode: 'constant', constantRate: 0.001 });
assert.strictEqual(cn(3 * H8), 0.001, 'constant ignores real');
assert.strictEqual(cn(99 * H8), 0.001, 'constant everywhere');

// tile: inside coverage → real; outside → cyclic repeat of the real series by boundary index.
const tl = buildFundingSeries({ realRows: real, mode: 'tile' });
assert.strictEqual(tl(2 * H8), 0.0001, 'tile inside = real');
// boundary index 5 → 5 % 3 = 2 → real[2].rate
assert.strictEqual(tl(5 * H8), -0.0002, 'tile outside cycles by boundary index');

// empty real + no constant → 0 (never NaN).
const empty = buildFundingSeries({ realRows: [], mode: 'real-mean' });
assert.strictEqual(empty(3 * H8), 0, 'empty real → 0');

// fundingBetween: sum of rates at boundaries strictly in (prev, cur].
const sum = fundingBetween(2 * H8, 4 * H8, H8, rm); // boundaries 3*H8 and 4*H8
assert.ok(Math.abs(sum - (0.0003 + -0.0002)) < 1e-12, 'sums boundaries in (prev,cur]');
assert.strictEqual(fundingBetween(2 * H8, 2 * H8 + 1, H8, rm), 0, 'no boundary crossed → 0');

console.log('test_funding.js OK');
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/test_funding.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/backtest/funding.js`:

```js
/**
 * Deterministic funding-rate series for the backtest. Real funding is used wherever
 * the DB has coverage; outside that window a synthetic fallback fills the gap.
 * NO randomness — determinism and cross-config comparability are required.
 *
 * Modes:
 *  - 'real-mean' (default): real rate inside coverage; mean of real rates outside (0 if none).
 *  - 'tile': real rate inside coverage; cyclic repeat of the real series (by 8h-boundary index) outside.
 *  - 'constant': constantRate everywhere (real ignored).
 *
 * @param {object} p
 * @param {{time:number,rate:number}[]} p.realRows sorted-or-not real funding rows
 * @param {'real-mean'|'tile'|'constant'} [p.mode='real-mean']
 * @param {number} [p.constantRate=0] used by 'constant' mode
 * @returns {(time:number)=>number} rateAt
 */
export function buildFundingSeries({ realRows = [], mode = 'real-mean', constantRate = 0 } = {}) {
  if (mode === 'constant') return () => constantRate;

  const rows = [...realRows].sort((a, b) => a.time - b.time);
  const byTime = new Map(rows.map(r => [r.time, r.rate]));
  const minT = rows.length ? rows[0].time : null;
  const maxT = rows.length ? rows[rows.length - 1].time : null;
  const mean = rows.length ? rows.reduce((s, r) => s + r.rate, 0) / rows.length : 0;

  if (mode === 'tile') {
    if (!rows.length) return () => 0;
    const H8 = 8 * 3600000;
    return (time) => {
      if (byTime.has(time)) return byTime.get(time);
      if (time >= minT && time <= maxT) return mean; // inside coverage but off-grid → mean (rare)
      const idx = ((Math.floor(time / H8) % rows.length) + rows.length) % rows.length;
      return rows[idx].rate;
    };
  }

  // 'real-mean' (default)
  return (time) => {
    if (byTime.has(time)) return byTime.get(time);
    return mean;
  };
}

/**
 * Sum funding rates at every funding boundary strictly within (prevTime, curTime].
 * A boundary is a timestamp where time % fundIntervalMs === 0.
 * @param {number} prevTime
 * @param {number} curTime
 * @param {number} fundIntervalMs e.g. 8h = 28800000
 * @param {(time:number)=>number} rateAt
 * @returns {number} summed rate
 */
export function fundingBetween(prevTime, curTime, fundIntervalMs, rateAt) {
  let sum = 0;
  let b = Math.floor(prevTime / fundIntervalMs) * fundIntervalMs + fundIntervalMs;
  for (; b <= curTime; b += fundIntervalMs) sum += rateAt(b);
  return sum;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/test_funding.js`
Expected: `test_funding.js OK`.

- [ ] **Step 5: Commit**

```bash
git add src/backtest/funding.js tests/test_funding.js
git commit -m "feat(backtest): deterministic funding series (real-mean/tile/constant)" -m "Real funding inside DB coverage; synthetic mean (or cyclic tile, or explicit constant) outside. No randomness -> determinism + comparable config sweeps. fundingBetween sums 8h-boundary rates in (prev,cur]." -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Liquidation level in checkExit

**Files:**
- Modify: `src/backtest/execution.js`
- Test: `tests/test_execution.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_execution.js`:

```js
// ---- Phase 4: liquidation level ----
import { checkExit as checkExit4 } from '../src/backtest/execution.js';
import assertL from 'node:assert';

const noCost = { slippageBps: 0 };

// Long, liq below SL is irrelevant; here liq (95) is ABOVE sl (90) → liq triggers first on a fall.
const lpos = { side: 'BUY', slPrice: 90, tpPrice: 110, liqPrice: 95 };
const liqHit = checkExit4(lpos, { open: 100, high: 100, low: 94 }, noCost, false);
assertL.strictEqual(liqHit.reason, 'LIQUIDATION', 'long: liq above SL triggers first');
assertL.strictEqual(liqHit.exitPrice, 95, 'liq fills at liq price');

// Long, SL (96) above liq (90): SL triggers first (normal, tight SL).
const slFirst = checkExit4({ side: 'BUY', slPrice: 96, tpPrice: 110, liqPrice: 90 }, { open: 100, high: 100, low: 95 }, noCost, false);
assertL.strictEqual(slFirst.reason, 'SL', 'long: SL above liq triggers first');

// Long gap down through liq on the open (non-entry) → LIQ_GAP.
const liqGap = checkExit4(lpos, { open: 93, high: 96, low: 92 }, noCost, false);
assertL.strictEqual(liqGap.reason, 'LIQ_GAP', 'long: open gaps past liq → LIQ_GAP');

// Short mirror: liq (105) below sl (110) → liq triggers first on a rise.
const spos = { side: 'SELL', slPrice: 110, tpPrice: 90, liqPrice: 105 };
const sLiq = checkExit4(spos, { open: 100, high: 106, low: 100 }, noCost, false);
assertL.strictEqual(sLiq.reason, 'LIQUIDATION', 'short: liq below SL triggers first');

// Spot parity: no liqPrice on pos → behaves exactly as before (SL).
const spot = checkExit4({ side: 'BUY', slPrice: 96, tpPrice: 110 }, { open: 100, high: 100, low: 95 }, noCost, false);
assertL.strictEqual(spot.reason, 'SL', 'no liqPrice → spot SL behavior unchanged');

console.log('test_execution.js liquidation cases OK');
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/test_execution.js`
Expected: existing cases pass, new cases FAIL (`reason` is `SL`/`null`, not `LIQUIDATION`).

- [ ] **Step 3: Rewrite checkExit**

Replace the entire body of `checkExit` in `src/backtest/execution.js` (keep `slip` and the JSDoc above; update the `@param pos` line to mention `liqPrice` and add `'LIQUIDATION'|'LIQ_GAP'` to the return reasons) with:

```js
export function checkExit(pos, bar, costs, isEntryBar) {
  const { side, slPrice, tpPrice, liqPrice } = pos;
  const exitSide = side === 'BUY' ? 'SELL' : 'BUY';
  const bps = (costs && costs.slippageBps) || 0;
  const mkt = (ideal, reason) => ({ idealPrice: ideal, exitPrice: slip(ideal, exitSide, bps), reason, market: true });
  const lim = (price, reason) => ({ idealPrice: price, exitPrice: price, reason, market: false });
  // Liquidation fills AT the liq price (loss is capped at margin by the simulator regardless).
  const liqExit = (reason) => ({ idealPrice: liqPrice, exitPrice: liqPrice, reason, market: true });

  if (side === 'BUY') {
    // Adverse = downward. Among {SL, LIQ} the HIGHER price is hit first while falling.
    if (!isEntryBar) {
      const slGap = slPrice != null && bar.open <= slPrice;
      const liqGap = liqPrice != null && bar.open <= liqPrice;
      if (liqGap && (!slGap || liqPrice >= slPrice)) return liqExit('LIQ_GAP');
      if (slGap) return mkt(bar.open, 'SL_GAP');
      if (tpPrice != null && bar.open >= tpPrice) return lim(tpPrice, 'TP_GAP');
    }
    const slHit = slPrice != null && bar.low <= slPrice;
    const liqHit = liqPrice != null && bar.low <= liqPrice;
    if (liqHit && (!slHit || liqPrice >= slPrice)) return liqExit('LIQUIDATION');
    if (slHit) return mkt(slPrice, 'SL');
    if (tpPrice != null && bar.high >= tpPrice) return lim(tpPrice, 'TP');
  } else {
    // Adverse = upward. Among {SL, LIQ} the LOWER price is hit first while rising.
    if (!isEntryBar) {
      const slGap = slPrice != null && bar.open >= slPrice;
      const liqGap = liqPrice != null && bar.open >= liqPrice;
      if (liqGap && (!slGap || liqPrice <= slPrice)) return liqExit('LIQ_GAP');
      if (slGap) return mkt(bar.open, 'SL_GAP');
      if (tpPrice != null && bar.open <= tpPrice) return lim(tpPrice, 'TP_GAP');
    }
    const slHit = slPrice != null && bar.high >= slPrice;
    const liqHit = liqPrice != null && bar.high >= liqPrice;
    if (liqHit && (!slHit || liqPrice <= slPrice)) return liqExit('LIQUIDATION');
    if (slHit) return mkt(slPrice, 'SL');
    if (tpPrice != null && bar.low <= tpPrice) return lim(tpPrice, 'TP');
  }
  return null;
}
```

- [ ] **Step 4: Run to verify both old and new pass**

Run: `node tests/test_execution.js`
Expected: all existing cases pass + `test_execution.js liquidation cases OK`.

- [ ] **Step 5: Commit**

```bash
git add src/backtest/execution.js tests/test_execution.js
git commit -m "feat(backtest): liquidation level in checkExit (LIQUIDATION/LIQ_GAP)" -m "Adverse levels {SL,LIQ} ordered by first-hit geometry (long: higher first; short: lower first). liqPrice absent -> spot behavior byte-identical (existing 8 cases green)." -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Simulator futures integration

**Files:**
- Modify: `src/backtest/simulator.js`
- Test: `tests/test_simulator.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_simulator.js`:

```js
// ---- Phase 4: futures (leverage, funding, liquidation) ----
import { simulate as simulate4 } from '../src/backtest/simulator.js';
import assertF from 'node:assert';

const H8 = 8 * 3600000;
const TF = 3600000; // 1h bars
// Always-enter decider: PERMIT a long with fixed SL/TP and notional.
const alwaysLong = (lev) => () => ({
  signal: { side: 'BUY', conviction: 1 },
  decision: { decision: 'PERMIT', order: { side: 'BUY', sizeUSD: 1000, slPrice: null, tpPrice: null, leverage: lev, marginUSD: 1000 / lev } },
});

// Helper: n flat-ish candles starting at t0.
const mkBars = (n, t0, priceFn) => Array.from({ length: n }, (_, i) => {
  const c = priceFn(i);
  return { time: t0 + i * TF, open: c, high: c * 1.001, low: c * 0.999, close: c };
});

// (a) Liquidation: 10x long, price crashes below liq (~0.905*entry). Loss capped at margin (+ fees).
const crash = mkBars(40, 0, (i) => i < 20 ? 100 : 50); // halves after bar 20
const liqRun = simulate4({
  candles: crash, config: { logicType: 'X' },
  guardrails: { portfolioValue: 10000, leverage: 10, mmr: 0.005 },
  costs: { takerFee: 0.0006, makerFee: 0.0002, slippageBps: 0, liqFeeRate: 0.0006 },
  symbol: 'T', timeframe: '1H', lookback: 5,
}, alwaysLong(10));
const liqTrade = liqRun.trades.find(t => t.reason === 'LIQUIDATION' || t.reason === 'LIQ_GAP');
assertF.ok(liqTrade, 'a liquidation occurred on the crash');
// margin = 1000/10 = 100; loss ≈ -(100 + liqFee + funding). With no funding here: ~ -100 - (1000*0.0006).
assertF.ok(liqTrade.pnl < -99 && liqTrade.pnl > -102, `liq loss capped near margin, got ${liqTrade.pnl}`);

// (b) Funding accrual: long pays positive funding; equity ends lower than the no-funding run.
const flat = mkBars(80, 0, () => 100); // price never moves
const common = {
  candles: flat, config: { logicType: 'X' },
  guardrails: { portfolioValue: 10000, leverage: 5, mmr: 0.005 },
  costs: { takerFee: 0, makerFee: 0, slippageBps: 0, liqFeeRate: 0 },
  symbol: 'T', timeframe: '1H', lookback: 5,
};
const withFunding = simulate4({ ...common, funding: { rateAt: () => 0.0001, intervalMs: H8 } }, alwaysLong(5));
const noFunding = simulate4({ ...common }, alwaysLong(5));
assertF.ok(withFunding.finalEquity < noFunding.finalEquity, 'positive funding lowers equity for a long');
assertF.ok(withFunding.totalFunding > 0, 'totalFunding positive (long paid funding)');

// (c) Determinism: same futures inputs → identical result.
const r1 = simulate4({ ...common, funding: { rateAt: () => 0.0001, intervalMs: H8 } }, alwaysLong(5));
const r2 = simulate4({ ...common, funding: { rateAt: () => 0.0001, intervalMs: H8 } }, alwaysLong(5));
assertF.deepStrictEqual(r1, r2, 'futures run is deterministic');

// (d) Parity: leverage=1 + no funding must equal the pure spot path (no funding/liq fields leak).
const spotRun = simulate4({
  candles: flat, config: { logicType: 'X' },
  guardrails: { portfolioValue: 10000 }, costs: { takerFee: 0, makerFee: 0, slippageBps: 0 },
  symbol: 'T', timeframe: '1H', lookback: 5,
}, () => ({ signal: { side: 'BUY', conviction: 1 }, decision: { decision: 'PERMIT', order: { side: 'BUY', sizeUSD: 1000, slPrice: null, tpPrice: null } } }));
assertF.strictEqual(spotRun.totalFunding, 0, 'spot totalFunding = 0');
assertF.ok(spotRun.trades.every(t => t.funding === 0), 'spot trades carry funding 0');

console.log('test_simulator.js futures cases OK');
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/test_simulator.js`
Expected: existing cases pass; new cases FAIL (`totalFunding` undefined, no liquidation handling).

- [ ] **Step 3: Rewrite simulate**

Replace the full contents of `src/backtest/simulator.js` with:

```js
import { evaluateBar } from '../core/pipeline.js';
import { slip, checkExit } from './execution.js';
import { liqPrice } from '../core/liquidation.js';
import { fundingBetween } from './funding.js';

/**
 * Pure walk-forward backtest. Spot (leverage = 1) is byte-identical to Phase 3.
 * Futures (leverage > 1): isolated margin, 8h funding accrual, liquidation (loss capped at margin).
 * Deterministic: no I/O, no Date.now(), no randomness.
 *
 * @param {object} p
 * @param {import('../core/contracts.js').Candle[]} p.candles ascending by time
 * @param {{logicType:string, logic?:object}} p.config
 * @param {object} p.guardrails RiskPolicy guardrails (portfolioValue drives sizing; leverage/mmr for futures)
 * @param {{takerFee:number, makerFee:number, slippageBps:number, liqFeeRate?:number}} p.costs
 * @param {string} p.symbol
 * @param {string} p.timeframe
 * @param {number} [p.lookback=250]
 * @param {number} [p.startEquity]
 * @param {{rateAt:(t:number)=>number, intervalMs:number}} [p.funding] futures funding series (omit for spot)
 * @param {(ctx:object, account:object)=>{signal:object, decision:object}} [decide=evaluateBar]
 * @returns {{trades:object[], equityCurve:{time:number,equity:number}[], finalEquity:number, slippageCost:number, totalFunding:number, liquidationCount:number}}
 */
export function simulate(p, decide = evaluateBar) {
  const { candles, config, guardrails, costs, symbol, timeframe } = p;
  const lookback = p.lookback || 250;
  const startEquity = p.startEquity != null ? p.startEquity : (guardrails.portfolioValue || 0);
  const takerFee = (costs && costs.takerFee) || 0;
  const makerFee = (costs && costs.makerFee) || 0;
  const slippageBps = (costs && costs.slippageBps) || 0;
  const liqFeeRate = (costs && costs.liqFeeRate != null) ? costs.liqFeeRate : takerFee;

  const leverage = guardrails.leverage || 1;
  const mmr = guardrails.mmr;
  const isFutures = leverage > 1;
  const funding = isFutures ? p.funding : null;

  let equity = startEquity;
  let position = null;
  let pending = null;
  const trades = [];
  const equityCurve = [];
  let slippageCost = 0;
  let totalFunding = 0;
  let liquidationCount = 0;

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
        sizeUSD: pending.sizeUSD, entryFee: pending.sizeUSD * takerFee, // market entry → taker
        marginUSD: isFutures ? pending.sizeUSD / leverage : pending.sizeUSD,
        liqPrice: isFutures ? liqPrice(entryFill, pending.side, leverage, mmr) : null,
        fundingAccrued: 0, lastFundingTime: bar.time,
      };
      pending = null;
    }

    // 2) Accrue funding over the holding period (futures only), before exit/MtM.
    if (position && funding && i > position.entryIndex) {
      const sumRate = fundingBetween(position.lastFundingTime, bar.time, funding.intervalMs, funding.rateAt);
      const cost = position.sizeUSD * sumRate * (position.side === 'BUY' ? 1 : -1);
      position.fundingAccrued += cost;
      position.lastFundingTime = bar.time;
    }

    // 3) Manage exit for an open position (entry bar may exit intrabar).
    if (position) {
      const ex = checkExit(position, bar, { slippageBps }, position.entryIndex === i);
      if (ex) {
        const isLiq = ex.reason === 'LIQUIDATION' || ex.reason === 'LIQ_GAP';
        let pnl, fees;
        if (isLiq) {
          // Isolated margin: loss capped at margin + liq fee + accrued funding. Entry fee absorbed.
          const liqFee = position.sizeUSD * liqFeeRate;
          fees = position.entryFee + liqFee;
          pnl = -(position.marginUSD + liqFee + position.fundingAccrued);
          liquidationCount += 1;
        } else {
          const exitFee = position.sizeUSD * (ex.market ? takerFee : makerFee);
          if (ex.market) slippageCost += position.sizeUSD * Math.abs(ex.exitPrice - ex.idealPrice) / ex.idealPrice;
          const ret = position.side === 'BUY'
            ? (ex.exitPrice - position.entryPrice) / position.entryPrice
            : (position.entryPrice - ex.exitPrice) / position.entryPrice;
          fees = position.entryFee + exitFee;
          pnl = position.sizeUSD * ret - fees - position.fundingAccrued;
        }
        equity += pnl;
        totalFunding += position.fundingAccrued;
        trades.push({
          side: position.side, entryTime: position.entryTime, entryPrice: position.entryPrice,
          exitTime: bar.time, exitPrice: ex.exitPrice, sizeUSD: position.sizeUSD,
          pnl, fees, funding: position.fundingAccrued, reason: ex.reason,
        });
        position = null;
      }
    }

    // 4) If flat, decide for a next-bar entry (uses only data up to close[i]).
    if (!position && !pending && i + 1 < n) {
      const window = candles.slice(Math.max(0, i - lookback + 1), i + 1);
      const ctx = { candles: window, config, symbol, timeframe };
      const account = { guardrails, portfolio: { openPositions: 0, portfolioHeatPct: 0, dailyPnlPct: 0, tradesToday: 0, freeEquity: equity } };
      const { decision } = decide(ctx, account);
      if (decision && decision.decision === 'PERMIT' && decision.order) {
        const o = decision.order;
        pending = { side: o.side, slPrice: o.slPrice, tpPrice: o.tpPrice, sizeUSD: o.sizeUSD };
      }
    }

    // 5) Mark-to-market equity at bar close (less accrued funding while open).
    const open = position ? unreal(position, bar.close) - position.fundingAccrued : 0;
    equityCurve.push({ time: bar.time, equity: equity + open });
  }

  return { trades, equityCurve, finalEquity: equity, slippageCost, totalFunding, liquidationCount };
}
```

> **Parity note:** when `leverage = 1`, `isFutures` is false → `funding` is null, `liqPrice` is null (no liquidation), `marginUSD = sizeUSD`, `fundingAccrued` stays 0. The `pnl` formula reduces to `sizeUSD*ret - fees` and `trade.funding === 0`, identical to Phase 3. The new return fields `totalFunding`/`liquidationCount` are `0`. The added `freeEquity` in the portfolio object is ignored by the spot RiskPolicy path.

- [ ] **Step 4: Run to verify both old and new pass**

Run: `node tests/test_simulator.js`
Expected: existing cases pass + `test_simulator.js futures cases OK`.

- [ ] **Step 5: Verify Phase 3 integration parity is untouched**

Run: `node tests/test_backtest_integration.js`
Expected: still PASS (spot path unchanged — same 21 trades / finalEquity as before).

- [ ] **Step 6: Commit**

```bash
git add src/backtest/simulator.js tests/test_simulator.js
git commit -m "feat(backtest): futures simulation (margin, funding, liquidation)" -m "leverage>1: reserve isolated margin, accrue 8h funding per bar, liquidation loss capped at margin+liqFee+funding. Returns totalFunding/liquidationCount. leverage=1 byte-identical to Phase 3 (parity + integration tests green)." -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Metrics — populate funding + liquidation count

**Files:**
- Modify: `src/backtest/metrics.js`
- Test: `tests/test_metrics.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_metrics.js`:

```js
// ---- Phase 4: funding + liquidation aggregation ----
import { computeMetrics as cm4 } from '../src/backtest/metrics.js';
import assertM from 'node:assert';

const eq = [{ time: 0, equity: 10000 }, { time: 3600000, equity: 9900 }];
const trades = [
  { side: 'BUY', entryTime: 0, exitTime: 3600000, pnl: -50, fees: 1, funding: 2, reason: 'LIQUIDATION' },
  { side: 'SELL', entryTime: 0, exitTime: 3600000, pnl: -50, fees: 1, funding: -1, reason: 'SL' },
];
const m = cm4({ trades, equityCurve: eq, startEquity: 10000, timeframe: '1H' });
assertM.ok(Math.abs(m.costs.totalFunding - 1) < 1e-12, 'totalFunding = 2 + (-1) = 1');
assertM.strictEqual(m.costs.liquidationCount, 1, 'one LIQUIDATION counted');

// Spot trades (no funding field, no LIQ) → 0/0.
const spot = cm4({ trades: [{ side: 'BUY', entryTime: 0, exitTime: 3600000, pnl: 5, fees: 1, reason: 'TP' }], equityCurve: eq, startEquity: 10000, timeframe: '1H' });
assertM.strictEqual(spot.costs.totalFunding, 0, 'no funding field → 0');
assertM.strictEqual(spot.costs.liquidationCount, 0, 'no liquidation → 0');

console.log('test_metrics.js futures cases OK');
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/test_metrics.js`
Expected: existing cases pass; new cases FAIL (`totalFunding`/`liquidationCount` hardcoded 0).

- [ ] **Step 3: Implement**

In `src/backtest/metrics.js`, just before the final `return {` statement, add:

```js
  const totalFunding = trades.reduce((s, t) => s + (t.funding || 0), 0);
  const liquidationCount = trades.filter(t => t.reason && t.reason.startsWith('LIQ')).length;
```

Then change the `costs` line in the returned object from:

```js
    costs: { totalFees, totalFunding: 0, liquidationCount: 0, slippageCost },
```

to:

```js
    costs: { totalFees, totalFunding, liquidationCount, slippageCost },
```

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/test_metrics.js`
Expected: existing cases pass + `test_metrics.js futures cases OK`.

- [ ] **Step 5: Commit**

```bash
git add src/backtest/metrics.js tests/test_metrics.js
git commit -m "feat(backtest): metrics populate totalFunding + liquidationCount" -m "Sum trade.funding; count reasons starting with LIQ. Spot (no funding field / no LIQ) stays 0/0 — shape unchanged." -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: CLI — futures flags, funding series, output

**Files:**
- Modify: `backtest/run-backtest.js`
- Test: `tests/test_run_backtest.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_run_backtest.js`:

```js
// ---- Phase 4: futures builders ----
import { buildGuardrails as bg4, buildCosts as bc4 } from '../backtest/run-backtest.js';
import assertR from 'node:assert';

// leverage + mmr flow into guardrails; defaults are spot.
const gSpot = bg4({});
assertR.strictEqual(gSpot.leverage, 1, 'default leverage 1');
const gFut = bg4({ leverage: '5' });
assertR.strictEqual(gFut.leverage, 5, 'leverage parsed');

// mmr falls back to the contract spec.
const gMmr = bg4({}, { mmr: 0.004 });
assertR.strictEqual(gMmr.mmr, 0.004, 'mmr from spec');
const gMmrArg = bg4({ mmr: '0.01' }, { mmr: 0.004 });
assertR.strictEqual(gMmrArg.mmr, 0.01, 'mmr arg overrides spec');

// liqFeeRate defaults to taker fee, overridable.
const c1 = bc4({}, { taker_fee: 0.0006 });
assertR.strictEqual(c1.liqFeeRate, 0.0006, 'liqFeeRate defaults to taker');
const c2 = bc4({ liqFee: '0.001' }, { taker_fee: 0.0006 });
assertR.strictEqual(c2.liqFeeRate, 0.001, 'liqFee arg overrides');

console.log('test_run_backtest.js futures cases OK');
```

> Note: `buildGuardrails` gains a second `spec` argument (for `mmr`). The existing Phase 3 calls pass one argument; `spec` defaults to `null`, so those calls keep working.

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/test_run_backtest.js`
Expected: existing cases pass; new cases FAIL (`leverage`/`mmr`/`liqFeeRate` undefined).

- [ ] **Step 3: Implement the CLI changes**

In `backtest/run-backtest.js`:

**(a)** Add the funding-series import after the existing imports (after the `parseArgs` import line):

```js
import { buildFundingSeries } from '../src/backtest/funding.js';
import { TF_MS } from '../src/data/marketParse.js';
```

**(b)** Replace `buildGuardrails` with (adds `leverage` + `mmr`; keeps every existing field):

```js
/** Build RiskPolicy guardrails from CLI args (fixed-notional sizing; spot defaults). */
export function buildGuardrails(args, spec = null) {
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
    leverage: num(args.leverage, 1),
    mmr: args.mmr != null ? Number(args.mmr) : (spec && spec.mmr != null ? spec.mmr : null),
  };
}
```

**(c)** Replace `buildCosts` with (adds `liqFeeRate`):

```js
/** Build cost config from CLI args, falling back to the stored contract spec, then constants. */
export function buildCosts(args, spec = null) {
  const taker = args.takerFee != null ? Number(args.takerFee) : (spec && spec.taker_fee != null ? spec.taker_fee : 0.0006);
  return {
    takerFee: taker,
    makerFee: args.makerFee != null ? Number(args.makerFee) : (spec && spec.maker_fee != null ? spec.maker_fee : 0.0002),
    slippageBps: args.slippageBps != null ? Number(args.slippageBps) : 5,
    liqFeeRate: args.liqFee != null ? Number(args.liqFee) : taker,
  };
}
```

**(d)** In `main()`, replace the leverage guard line:

```js
  const leverage = args.leverage != null ? Number(args.leverage) : 1;
  if (leverage !== 1) throw new Error('Phase 3 supports spot only (leverage = 1). Futures arrive in Phase 4.');
```

with:

```js
  const leverage = args.leverage != null ? Number(args.leverage) : 1;
  const fundingMode = String(args.fundingMode || 'real-mean');
  const fundingRateArg = args.fundingRate != null ? Number(args.fundingRate) : 0;
```

**(e)** In `main()`, replace the guardrails/costs/config build block:

```js
  const guardrails = buildGuardrails(args);
  const costs = buildCosts(args, spec);
  const config = { logicType, logic: {} };
```

with (pass `spec` to guardrails; build the funding series for futures):

```js
  const guardrails = buildGuardrails(args, spec);
  const costs = buildCosts(args, spec);
  const config = { logicType, logic: {} };

  let funding = null;
  if (leverage > 1) {
    if (guardrails.mmr == null) throw new Error(`No MMR for ${symbol} (need contract spec or --mmr) for futures.`);
    const fundIntervalH = (spec && spec.fund_interval_h) || 8;
    const intervalMs = fundIntervalH * 3600000;
    const realRows = candles.length
      ? await (async () => {
          const mdb = await openMarketDb(path.join(process.cwd(), 'market_data.db'));
          const rows = await new MarketDataRepo(mdb).getFunding(symbol, candles[0].time, candles[candles.length - 1].time);
          await mdb.close();
          return rows;
        })()
      : [];
    const rateAt = buildFundingSeries({ realRows, mode: fundingMode, constantRate: fundingRateArg });
    funding = { rateAt, intervalMs };
    console.log(`[backtest] funding mode=${fundingMode}, real rows=${realRows.length}, interval=${fundIntervalH}h`);
  }
```

**(f)** In `main()`, replace the `console.log('[backtest] ...spot)')` + `simulate(...)` lines:

```js
  console.log(`[backtest] ${label}: ${candles.length} candles, lookback ${lookback}, leverage 1 (spot)`);
  const sim = simulate({ candles, config, guardrails, costs, symbol, timeframe: tf, lookback, startEquity: guardrails.portfolioValue });
```

with:

```js
  console.log(`[backtest] ${label}: ${candles.length} candles, lookback ${lookback}, leverage ${leverage}${leverage > 1 ? ' (futures)' : ' (spot)'}`);
  const sim = simulate({ candles, config, guardrails, costs, symbol, timeframe: tf, lookback, startEquity: guardrails.portfolioValue, funding });
```

**(g)** In `main()`, update the metrics call to pass funding/liquidation through (computeMetrics derives them from trades, so no signature change is needed) and extend the printed cost block. Replace:

```js
  console.log(`Costs         : fees ${m.costs.totalFees.toFixed(2)}, slippage ${m.costs.slippageCost.toFixed(2)}`);
  console.log(`Long / Short  : ${m.breakdown.long.count} / ${m.breakdown.short.count}`);
```

with:

```js
  console.log(`Costs         : fees ${m.costs.totalFees.toFixed(2)}, slippage ${m.costs.slippageCost.toFixed(2)}, funding ${m.costs.totalFunding.toFixed(2)}`);
  if (leverage > 1) console.log(`Liquidations  : ${m.costs.liquidationCount}  (leverage ${leverage}x)`);
  console.log(`Long / Short  : ${m.breakdown.long.count} / ${m.breakdown.short.count}`);
```

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/test_run_backtest.js`
Expected: existing cases pass + `test_run_backtest.js futures cases OK`.

- [ ] **Step 5: Commit**

```bash
git add backtest/run-backtest.js tests/test_run_backtest.js
git commit -m "feat(backtest): CLI futures support (leverage, mmr, funding flags)" -m "Lift the spot-only guard; --leverage/--mmr/--funding-mode/--funding-rate/--liq-fee. Builds funding series from real BitGet rows + synthetic fallback; prints funding + liquidation count." -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Futures integration test + manual smoke + final review

**Files:**
- Create: `tests/test_futures_integration.js`

- [ ] **Step 1: Write the integration test**

Create `tests/test_futures_integration.js`:

```js
import assert from 'node:assert';
import { simulate } from '../src/backtest/simulator.js';

const TF = 3600000, H8 = 8 * 3600000;

// Deterministic synthetic series: long uptrend then a sharp crash, 300 bars.
const candles = Array.from({ length: 300 }, (_, i) => {
  const base = i < 200 ? 100 + i * 0.2 : 140 - (i - 200) * 2; // rises, then crashes after bar 200
  return { time: i * TF, open: base, high: base * 1.002, low: base * 0.998, close: base };
});

const config = { logicType: 'SMC', logic: { indicators: { pivot_length: 2 } } };
const guardrails = {
  portfolioValue: 10000, riskPerTrade: 0.2, maxTradeSizeUSD: Infinity,
  stopLossPct: 0.05, takeProfitPct: 0.10, minRiskRewardRatio: 1.5,
  maxOpenPositions: 1, maxPortfolioHeatPct: 100, dailyLossLimitPct: 1,
  dailyProfitTargetPct: null, maxTradesPerDay: 999999,
  leverage: 10, mmr: 0.005,
};
const costs = { takerFee: 0.0006, makerFee: 0.0002, slippageBps: 5, liqFeeRate: 0.0006 };
const funding = { rateAt: () => 0.0001, intervalMs: H8 };
const params = { candles, config, guardrails, costs, symbol: 'BTCUSDT', timeframe: '1H', lookback: 100, funding };

// Runs the REAL pipeline (default decide = evaluateBar).
const a = simulate(params);
const b = simulate(params);

assert.ok(Array.isArray(a.trades), 'trades is an array');
assert.strictEqual(a.equityCurve.length, candles.length - 100, 'equity curve covers post-warmup bars');
assert.ok(Number.isFinite(a.finalEquity), 'finalEquity finite');
assert.ok(a.trades.length >= 1, 'real pipeline booked at least one futures trade (PERMIT->fill seam)');
assert.ok(a.totalFunding !== 0, 'funding accrued on held positions');
assert.deepStrictEqual(a, b, 'futures run is deterministic');

// Crash phase should produce at least one liquidation at 10x.
assert.ok(a.liquidationCount >= 1, 'the crash liquidated a leveraged long');

// Parity: same inputs at leverage=1, no funding → spot path, no funding/liq leakage.
const spot = simulate({ ...params, guardrails: { ...guardrails, leverage: 1, mmr: undefined }, funding: null });
assert.strictEqual(spot.totalFunding, 0, 'spot totalFunding 0');
assert.strictEqual(spot.liquidationCount, 0, 'spot has no liquidations');
assert.ok(spot.trades.every(t => t.funding === 0), 'spot trades funding 0');

console.log(`test_futures_integration.js OK — trades=${a.trades.length}, liq=${a.liquidationCount}, funding=${a.totalFunding.toFixed(2)}, finalEquity=${a.finalEquity.toFixed(2)}`);
```

- [ ] **Step 2: Run the integration test**

Run: `node tests/test_futures_integration.js`
Expected: PASS, prints trades/liq/funding/finalEquity. If `trades` or `liquidationCount` is 0, the seam is not exercised — investigate (adjust `pivot_length`/crash depth only if the REAL pipeline genuinely needs it; do not weaken the assertions).

- [ ] **Step 3: Run the full backtest test suite**

Run each and confirm all PASS:

```bash
node tests/test_liquidation.js
node tests/test_funding.js
node tests/test_execution.js
node tests/test_simulator.js
node tests/test_metrics.js
node tests/test_risk_policy.mjs
node tests/test_run_backtest.js
node tests/test_backtest_integration.js
node tests/test_futures_integration.js
node tests/test_contracts.js
node tests/test_pipeline.js
```

Expected: every file prints its OK line. The Phase 3 files (`test_execution`, `test_simulator`, `test_metrics`, `test_backtest_integration`) must be green — that is the parity proof.

- [ ] **Step 4: Manual smoke on real data (leveraged)**

Run a 10x futures backtest over the funding-covered window (≈ last 33 days, where real funding exists), so funding + any liquidations actually bite:

```bash
node backtest/run-backtest.js --symbol BTCUSDT --tf 1H --logic SMC --leverage 10 --from 2026-04-30 --sl 0.02 --tp 0.04 --label "SMC 10x smoke"
```

Expected: a BACKTEST RESULT block that now includes `funding` in Costs and a `Liquidations` line. Confirm:
- the run completes and persists (a new run id in `backtest.db`);
- `funding` is non-zero (real rates were applied in-window);
- the result is plausibly worse than the equivalent spot run (leverage + funding amplify costs).

Also run the same window at `--leverage 1` and confirm the spot path still prints `funding 0.00` and no Liquidations line.

- [ ] **Step 5: Final holistic review**

Self-review the whole Phase 4 increment against spec §5 and §6:
- pure/shell discipline intact (no I/O in `liquidation.js`, `funding.js`, `execution.js`, `simulator.js`, `metrics.js`);
- look-ahead safety preserved (funding/liquidation use only the current bar and earlier);
- **parity**: confirm the Phase 3 spot tests are byte-for-byte green and the spot Order shape is unchanged;
- liquidation loss is capped at margin (+ fees + funding);
- determinism holds (integration `deepStrictEqual`);
- nothing outside the listed files changed (`git diff --stat <base>..HEAD`).

- [ ] **Step 6: Commit**

```bash
git add tests/test_futures_integration.js
git commit -m "test(backtest): real-pipeline futures integration (funding + liquidation + parity)" -m "Synthetic uptrend+crash over evaluateBar: books real futures trades, accrues funding, liquidates a 10x long; determinism via deepStrictEqual; parity check at leverage=1." -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review (plan vs spec)

**Spec coverage:**
- §5 RiskPolicy leverage path — accept leverage ✓ (Task 2), `marginUSD = sizeUSD/leverage` ✓ (Task 2), margin gate ✓ (Task 2), SL-inside-liquidation gate → PERMIT+warning ✓ (Task 2, per user). Margin-based heat: **intentionally deferred** (single-position backtest keeps heat at 0; portfolio heat is spec §7/§12 deferred) — noted in Task 2.
- §5 parity at leverage=1 — Tasks 2 & 5 enforce + tests (`test_risk_policy.mjs` parity, `test_simulator.js` (d), `test_backtest_integration.js` re-run).
- §6 fills/no-look-ahead — inherited from Phase 3 simulator (unchanged); liquidation added to the same `checkExit` (Task 4).
- §6 exit priority gap→SL→TP→liquidation — Task 4 (adverse-level ordering; liq vs SL by first-hit geometry).
- §6 costs: fees ✓ (existing), slippage ✓ (existing), funding every 8h signed by side ✓ (Tasks 3, 5).
- §6 liquidation isolated, loss = margin (+liq fee) ✓ (Task 5); liq price from leverage+MMR ✓ (Task 1).
- §6 spot = degenerate futures (leverage 1, no funding/liquidation) ✓ (parity).
- §9 metrics costs.totalFunding / liquidationCount become live ✓ (Task 6); persistence via metrics_json (existing BacktestRepo, no schema change).
- §6 approximations labeled ✓ (plan header).

**Placeholder scan:** none — every code/test step has complete code and an exact run command.

**Type consistency:** `liqPrice(entry, side, leverage, mmr)` used identically in Tasks 1/2/5. `buildFundingSeries({realRows,mode,constantRate})→rateAt` and `fundingBetween(prev,cur,intervalMs,rateAt)` consistent across Tasks 3/5/7. `simulate(...)` return adds `totalFunding`/`liquidationCount` (Task 5) consumed by metrics-from-trades (Task 6) and the integration test (Task 8). `trade.funding` produced in Task 5, summed in Task 6. Guardrails carry `leverage`/`mmr`; costs carry `liqFeeRate` — produced in Task 7, read in Tasks 2/5.

---

## Execution Handoff

Plan complete. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review (spec-compliance + code-quality) between tasks.
2. **Inline Execution** — execute in this session with checkpoints.
