# Signal Core (Phases 0–1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure, deterministic decision core — a uniform `Signal` contract, a `SignalAdapter` that maps all four indicators to it, and an `evaluateBar` pipeline wiring indicators → signal → `RiskPolicy` — fully unit-tested, with zero I/O and no changes to any live trading path.

**Architecture:** A new `src/core/` module holds the "narrow waist" of the system. `IndicatorManager` (unchanged) produces raw indicator output; `SignalAdapter` normalizes it to `{side, conviction, reason, invalidation}`; `evaluateBar` feeds that through the existing `RiskPolicy`. Everything here is a pure function (no DB, network, or `Date.now()`), so the backtest and live shells (later plans) can share it byte-for-byte.

**Tech Stack:** Node 18+ ESM, built-in `node:assert`, plain `node tests/<file>.js` test scripts (matches existing project convention — no new dependencies). Reuses `src/indicators/index.js` and `src/agents/RiskPolicy.js` unchanged.

---

## File Structure

- `src/core/contracts.js` — **Create.** JSDoc typedefs for the contracts + a frozen `SIDE` constant. No runtime behavior beyond the constant.
- `src/core/SignalAdapter.js` — **Create.** `deriveSignal(logicType, raw, ctx)` dispatching to one pure mapper per indicator (`SMC`, `VMC_CIPHERB`, `BREAKOUT`, `REVERSAL`).
- `src/core/pipeline.js` — **Create.** `evaluateBar(ctx, { guardrails, portfolio })` → `{signal, decision}`. Wires `IndicatorManager` + `SignalAdapter` + `RiskPolicy`.
- `tests/test_contracts.js` — **Create.** Verifies `SIDE`.
- `tests/test_signal_adapter.js` — **Create, grows across tasks.** Per-indicator mapping tests with synthetic raw inputs (deterministic — does not depend on real candle math).
- `tests/test_pipeline.js` — **Create.** Verifies pipeline wiring + return shape on a deterministic flat-market case.

**Reference (existing indicator output shapes the adapter consumes):**
- `IndicatorManager.calculate('SMC', candles)` → `{ structure: {trend, structure[]}, obs: [{range:{top,bottom}, ...}], fvgs: [] }` (`trend`: 1 / -1 / 0).
- `...('VMC_CIPHERB', ...)` → `{ wt:{wt1,wt2}, wtCrossUp, wtCrossDown, mfi, stochRsi:{k,d}, stc, vwap }` (`mfi`/`k`/`stc` on 0..100).
- `...('BREAKOUT', ...)` → `{ channel: {top, bottom, active} }`.
- `...('REVERSAL', ...)` → `{ structure:{trend}, recentFVG: {type}|null, rejection: {type:'bullish'|'bearish', high, low}|null }`.

---

## Task 1: Contracts module

**Files:**
- Create: `src/core/contracts.js`
- Test: `tests/test_contracts.js`

- [ ] **Step 1: Write the failing test**

Create `tests/test_contracts.js`:

```js
import assert from 'assert';
import { SIDE } from '../src/core/contracts.js';

console.log('Running contracts tests...');

assert.strictEqual(SIDE.BUY, 'BUY', 'SIDE.BUY');
assert.strictEqual(SIDE.SELL, 'SELL', 'SIDE.SELL');
assert.strictEqual(SIDE.HOLD, 'HOLD', 'SIDE.HOLD');
assert.ok(Object.isFrozen(SIDE), 'SIDE must be frozen');

console.log('✅ contracts tests passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_contracts.js`
Expected: FAIL — `Cannot find module '.../src/core/contracts.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/contracts.js`:

```js
/**
 * Core decision contracts (the "narrow waist"). JSDoc-only types + the SIDE enum.
 *
 * @typedef {Object} Candle
 * @property {number} time @property {number} open @property {number} high
 * @property {number} low  @property {number} close @property {number} volume
 *
 * @typedef {Object} StrategyContext
 * @property {Candle[]} candles
 * @property {{logicType: string, logic?: object}} config
 * @property {string} symbol
 * @property {string} timeframe
 *
 * @typedef {Object} Signal
 * @property {'BUY'|'SELL'|'HOLD'} side
 * @property {number} conviction  // 0..1
 * @property {string} reason
 * @property {number|null} [invalidation]  // price level that invalidates the idea
 *
 * @typedef {Object} AccountState
 * @property {number} entryPrice
 * @property {number} [openPositions] @property {number} [portfolioHeatPct]
 * @property {number} [dailyPnlPct]   @property {number} [tradesToday]
 *
 * @typedef {Object} Order
 * @property {'BUY'|'SELL'} side @property {number} sizeUSD @property {number} entryPrice
 * @property {number|null} slPrice @property {number|null} tpPrice
 *
 * @typedef {Object} Decision
 * @property {'PERMIT'|'DENY'} decision @property {string} [reason] @property {Order} [order]
 */

export const SIDE = Object.freeze({ BUY: 'BUY', SELL: 'SELL', HOLD: 'HOLD' });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_contracts.js`
Expected: PASS — `✅ contracts tests passed`.

- [ ] **Step 5: Commit**

```bash
git add src/core/contracts.js tests/test_contracts.js
git commit -m "feat(core): signal contracts + SIDE enum"
```

---

## Task 2: SignalAdapter — SMC mapper + dispatch

**Files:**
- Create: `src/core/SignalAdapter.js`
- Create: `tests/test_signal_adapter.js`

- [ ] **Step 1: Write the failing test**

Create `tests/test_signal_adapter.js`:

```js
import assert from 'assert';
import { deriveSignal } from '../src/core/SignalAdapter.js';
import { SIDE } from '../src/core/contracts.js';

const tests = [];
const add = (name, fn) => tests.push({ name, fn });

// ---- SMC ----
add('SMC bullish trend → BUY with confluence', () => {
  const raw = {
    structure: { trend: 1, structure: [{ type: 'BOS', bias: 'bullish', price: 105 }] },
    obs: [{ range: { top: 106, bottom: 104 } }],
    fvgs: [],
  };
  const s = deriveSignal('SMC', raw, { price: 110, candles: [] });
  assert.strictEqual(s.side, SIDE.BUY);
  assert.ok(Math.abs(s.conviction - 0.9) < 1e-9, `conviction ${s.conviction}`);
  assert.strictEqual(s.invalidation, 105);
});

add('SMC bearish trend → SELL', () => {
  const raw = { structure: { trend: -1, structure: [] }, obs: [], fvgs: [] };
  const s = deriveSignal('SMC', raw, { price: 90, candles: [] });
  assert.strictEqual(s.side, SIDE.SELL);
  assert.ok(Math.abs(s.conviction - 0.6) < 1e-9, `conviction ${s.conviction}`);
});

add('SMC neutral trend → HOLD', () => {
  const raw = { structure: { trend: 0, structure: [] }, obs: [], fvgs: [] };
  const s = deriveSignal('SMC', raw, { price: 100, candles: [] });
  assert.strictEqual(s.side, SIDE.HOLD);
});

add('unknown logicType throws', () => {
  assert.throws(() => deriveSignal('NOPE', {}, { price: 1, candles: [] }), /Unsupported/);
});

// ===== runner (do not edit below) =====
let failed = 0;
for (const t of tests) {
  try { t.fn(); console.log(`✅ ${t.name}`); }
  catch (e) { failed++; console.error(`❌ ${t.name}\n   ${e.message}`); }
}
if (failed) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
console.log('\nAll SignalAdapter tests passed!');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_signal_adapter.js`
Expected: FAIL — cannot find `src/core/SignalAdapter.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/SignalAdapter.js`:

```js
import { SIDE } from './contracts.js';

const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
const hold = (reason) => ({ side: SIDE.HOLD, conviction: 0, reason, invalidation: null });

/** SMC: structure.trend drives side; BOS/CHoCH + order-block add conviction. */
function fromSMC(raw) {
  const trend = raw?.structure?.trend ?? 0;
  const side = trend === 1 ? SIDE.BUY : trend === -1 ? SIDE.SELL : SIDE.HOLD;
  if (side === SIDE.HOLD) return hold('SMC: neutral structure');
  let conviction = 0.6;
  const events = raw?.structure?.structure ?? [];
  if (events.length > 0) conviction += 0.2;
  const obs = raw?.obs ?? [];
  if (obs.length > 0 && obs[0]?.range?.top > 0) conviction += 0.1;
  const invalidation = events.length ? events[events.length - 1].price : null;
  return { side, conviction: clamp(conviction), reason: `SMC structure ${side}`, invalidation };
}

/**
 * Dispatch raw indicator output to the matching pure mapper.
 * @param {string} logicType @param {object} raw @param {{price:number, candles:object[]}} ctx
 * @returns {import('./contracts.js').Signal}
 */
export function deriveSignal(logicType, raw, ctx) {
  switch (String(logicType).toUpperCase()) {
    case 'SMC': return fromSMC(raw);
    default: throw new Error(`Unsupported logicType: ${logicType}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_signal_adapter.js`
Expected: PASS — all four SMC/unknown assertions, ending `All SignalAdapter tests passed!`.

- [ ] **Step 5: Commit**

```bash
git add src/core/SignalAdapter.js tests/test_signal_adapter.js
git commit -m "feat(core): SignalAdapter SMC mapping + dispatch"
```

---

## Task 3: SignalAdapter — WaveTrend (VMC_CipherB) mapper

This closes the long-standing gap: WaveTrend had no side mapping anywhere in live code.

**Files:**
- Modify: `src/core/SignalAdapter.js`
- Modify: `tests/test_signal_adapter.js`

- [ ] **Step 1: Write the failing test**

In `tests/test_signal_adapter.js`, insert these blocks immediately above the `// ===== runner` line:

```js
// ---- WaveTrend (VMC_CipherB) ----
add('WaveTrend cross up + full confluence → BUY', () => {
  const raw = { wtCrossUp: true, wtCrossDown: false, mfi: 60, stochRsi: { k: 50, d: 50 }, stc: 60 };
  const s = deriveSignal('VMC_CIPHERB', raw, { price: 100, candles: [] });
  assert.strictEqual(s.side, SIDE.BUY);
  assert.ok(Math.abs(s.conviction - 1.0) < 1e-9, `conviction ${s.conviction}`);
});

add('WaveTrend cross down → SELL', () => {
  const raw = { wtCrossUp: false, wtCrossDown: true, mfi: 40, stochRsi: { k: 50, d: 50 }, stc: 40 };
  const s = deriveSignal('VMC_CIPHERB', raw, { price: 100, candles: [] });
  assert.strictEqual(s.side, SIDE.SELL);
  assert.ok(Math.abs(s.conviction - 1.0) < 1e-9, `conviction ${s.conviction}`);
});

add('WaveTrend no cross → HOLD', () => {
  const raw = { wtCrossUp: false, wtCrossDown: false, mfi: 50, stochRsi: { k: 50, d: 50 }, stc: 50 };
  const s = deriveSignal('VMC_CIPHERB', raw, { price: 100, candles: [] });
  assert.strictEqual(s.side, SIDE.HOLD);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_signal_adapter.js`
Expected: FAIL — `Unsupported logicType: VMC_CIPHERB` surfaces on the WaveTrend cases.

- [ ] **Step 3: Write minimal implementation**

In `src/core/SignalAdapter.js`, add this function above `deriveSignal`:

```js
/** WaveTrend: wt cross drives side; MFI / StochRSI / STC confluence add conviction. */
function fromWaveTrend(raw) {
  const side = raw?.wtCrossUp ? SIDE.BUY : raw?.wtCrossDown ? SIDE.SELL : SIDE.HOLD;
  if (side === SIDE.HOLD) return hold('WaveTrend: no cross');
  let conviction = 0.5;
  const mfi = raw?.mfi ?? 50;
  if ((side === SIDE.BUY && mfi > 50) || (side === SIDE.SELL && mfi < 50)) conviction += 0.2;
  const k = raw?.stochRsi?.k ?? 50; // 0..100
  if ((side === SIDE.BUY && k < 80) || (side === SIDE.SELL && k > 20)) conviction += 0.15;
  const stc = raw?.stc ?? 50; // 0..100
  if ((side === SIDE.BUY && stc > 50) || (side === SIDE.SELL && stc < 50)) conviction += 0.15;
  return { side, conviction: clamp(conviction), reason: `WaveTrend cross ${side}`, invalidation: null };
}
```

Then add the dispatch case inside `deriveSignal`'s switch, above `default:`:

```js
    case 'VMC_CIPHERB': return fromWaveTrend(raw);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_signal_adapter.js`
Expected: PASS — including the three WaveTrend cases.

- [ ] **Step 5: Commit**

```bash
git add src/core/SignalAdapter.js tests/test_signal_adapter.js
git commit -m "feat(core): SignalAdapter WaveTrend mapping (closes VMC side gap)"
```

---

## Task 4: SignalAdapter — Breakout mapper

**Files:**
- Modify: `src/core/SignalAdapter.js`
- Modify: `tests/test_signal_adapter.js`

- [ ] **Step 1: Write the failing test**

In `tests/test_signal_adapter.js`, insert above the `// ===== runner` line:

```js
// ---- Breakout ----
add('Breakout above active channel → BUY (capped conviction)', () => {
  const raw = { channel: { top: 100, bottom: 90, active: true } };
  const s = deriveSignal('BREAKOUT', raw, { price: 105, candles: [] });
  assert.strictEqual(s.side, SIDE.BUY);
  assert.ok(Math.abs(s.conviction - 0.9) < 1e-9, `conviction ${s.conviction}`);
  assert.strictEqual(s.invalidation, 90);
});

add('Breakout inactive channel → HOLD', () => {
  const raw = { channel: { top: null, bottom: null, active: false } };
  const s = deriveSignal('BREAKOUT', raw, { price: 105, candles: [] });
  assert.strictEqual(s.side, SIDE.HOLD);
});

add('Breakout price inside channel → HOLD', () => {
  const raw = { channel: { top: 100, bottom: 90, active: true } };
  const s = deriveSignal('BREAKOUT', raw, { price: 95, candles: [] });
  assert.strictEqual(s.side, SIDE.HOLD);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_signal_adapter.js`
Expected: FAIL — `Unsupported logicType: BREAKOUT`.

- [ ] **Step 3: Write minimal implementation**

In `src/core/SignalAdapter.js`, add above `deriveSignal`:

```js
/** Breakout: needs the latest price to decide direction relative to the channel. */
function fromBreakout(raw, ctx) {
  const ch = raw?.channel;
  if (!ch || !ch.active) return hold('Breakout: channel inactive');
  const price = ctx.price;
  let side = SIDE.HOLD;
  if (price > ch.top) side = SIDE.BUY;
  else if (price < ch.bottom) side = SIDE.SELL;
  if (side === SIDE.HOLD) return hold('Breakout: price inside channel');
  const width = ch.top - ch.bottom;
  const dist = side === SIDE.BUY ? price - ch.top : ch.bottom - price;
  const conviction = clamp(0.55 + (width > 0 ? dist / width : 0), 0, 0.9);
  const invalidation = side === SIDE.BUY ? ch.bottom : ch.top;
  return { side, conviction, reason: `Breakout ${side}`, invalidation };
}
```

Then add the dispatch case above `default:` in `deriveSignal`:

```js
    case 'BREAKOUT': return fromBreakout(raw, ctx);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_signal_adapter.js`
Expected: PASS — including the three Breakout cases.

- [ ] **Step 5: Commit**

```bash
git add src/core/SignalAdapter.js tests/test_signal_adapter.js
git commit -m "feat(core): SignalAdapter Breakout mapping"
```

---

## Task 5: SignalAdapter — Reversal mapper

**Files:**
- Modify: `src/core/SignalAdapter.js`
- Modify: `tests/test_signal_adapter.js`

- [ ] **Step 1: Write the failing test**

In `tests/test_signal_adapter.js`, insert above the `// ===== runner` line:

```js
// ---- Reversal ----
add('Reversal bullish rejection + aligned FVG → BUY', () => {
  const raw = { structure: { trend: 0 }, recentFVG: { type: 'bullish' }, rejection: { type: 'bullish', high: 100, low: 90 } };
  const s = deriveSignal('REVERSAL', raw, { price: 95, candles: [] });
  assert.strictEqual(s.side, SIDE.BUY);
  assert.ok(Math.abs(s.conviction - 0.9) < 1e-9, `conviction ${s.conviction}`);
  assert.strictEqual(s.invalidation, 90);
});

add('Reversal bearish rejection, no FVG → SELL', () => {
  const raw = { structure: { trend: 0 }, recentFVG: null, rejection: { type: 'bearish', high: 100, low: 90 } };
  const s = deriveSignal('REVERSAL', raw, { price: 99, candles: [] });
  assert.strictEqual(s.side, SIDE.SELL);
  assert.ok(Math.abs(s.conviction - 0.65) < 1e-9, `conviction ${s.conviction}`);
  assert.strictEqual(s.invalidation, 100);
});

add('Reversal no rejection → HOLD', () => {
  const raw = { structure: { trend: 1 }, recentFVG: { type: 'bullish' }, rejection: null };
  const s = deriveSignal('REVERSAL', raw, { price: 100, candles: [] });
  assert.strictEqual(s.side, SIDE.HOLD);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_signal_adapter.js`
Expected: FAIL — `Unsupported logicType: REVERSAL`.

- [ ] **Step 3: Write minimal implementation**

In `src/core/SignalAdapter.js`, add above `deriveSignal`:

```js
/** Reversal: rejection (pin bar) drives side; aligned recent FVG adds conviction. */
function fromReversal(raw) {
  const rej = raw?.rejection;
  const side = rej?.type === 'bullish' ? SIDE.BUY : rej?.type === 'bearish' ? SIDE.SELL : SIDE.HOLD;
  if (side === SIDE.HOLD) return hold('Reversal: no rejection');
  let conviction = 0.5;
  const fvg = raw?.recentFVG;
  if (fvg && ((side === SIDE.BUY && fvg.type === 'bullish') || (side === SIDE.SELL && fvg.type === 'bearish'))) {
    conviction += 0.25;
  }
  conviction += 0.15; // rejection already passed the wick>2*body filter upstream
  const invalidation = side === SIDE.BUY ? rej.low : rej.high;
  return { side, conviction: clamp(conviction), reason: `Reversal ${side}`, invalidation };
}
```

Then add the dispatch case above `default:` in `deriveSignal`:

```js
    case 'REVERSAL': return fromReversal(raw);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_signal_adapter.js`
Expected: PASS — all SMC + WaveTrend + Breakout + Reversal + unknown cases.

- [ ] **Step 5: Commit**

```bash
git add src/core/SignalAdapter.js tests/test_signal_adapter.js
git commit -m "feat(core): SignalAdapter Reversal mapping"
```

---

## Task 6: Pure pipeline — `evaluateBar`

**Files:**
- Create: `src/core/pipeline.js`
- Create: `tests/test_pipeline.js`

- [ ] **Step 1: Write the failing test**

Create `tests/test_pipeline.js`:

```js
import assert from 'assert';
import { evaluateBar } from '../src/core/pipeline.js';

console.log('Running pipeline tests...');

// 5 candles is far below SMC's pivot window → no structure → trend 0 → HOLD → DENY.
const candles = [];
for (let i = 0; i < 5; i++) {
  candles.push({ time: i, open: 100, high: 101, low: 99, close: 100, volume: 10 });
}
const ctx = { symbol: 'BTCUSDT', timeframe: '1h', config: { logicType: 'SMC', logic: {} }, candles };

const result = evaluateBar(ctx, { guardrails: {}, portfolio: {} });

assert.ok('signal' in result && 'decision' in result, 'returns {signal, decision}');
assert.strictEqual(result.signal.side, 'HOLD', 'flat market → HOLD');
assert.strictEqual(result.decision.decision, 'DENY', 'HOLD signal is denied by RiskPolicy');

console.log('✅ pipeline tests passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_pipeline.js`
Expected: FAIL — cannot find `src/core/pipeline.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/pipeline.js`:

```js
import { IndicatorManager } from '../indicators/index.js';
import { RiskPolicy } from '../agents/RiskPolicy.js';
import { deriveSignal } from './SignalAdapter.js';

/**
 * Pure decision pipeline: candles → indicator → signal → risk decision.
 * No I/O, no Date.now(), deterministic. Shared by backtest and live shells.
 *
 * @param {import('./contracts.js').StrategyContext} ctx
 * @param {{guardrails: object, portfolio: object}} account
 * @returns {{signal: import('./contracts.js').Signal, decision: import('./contracts.js').Decision}}
 */
export function evaluateBar(ctx, account) {
  const price = ctx.candles[ctx.candles.length - 1].close;
  const raw = new IndicatorManager(ctx.config.logic || {}).calculate(ctx.config.logicType, ctx.candles);
  const signal = deriveSignal(ctx.config.logicType, raw, { price, candles: ctx.candles });
  const decision = new RiskPolicy(account.guardrails || {}).evaluate(signal, { entryPrice: price, ...(account.portfolio || {}) });
  return { signal, decision };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_pipeline.js`
Expected: PASS — `✅ pipeline tests passed`.

- [ ] **Step 5: Run the full core test suite**

Run: `node tests/test_contracts.js && node tests/test_signal_adapter.js && node tests/test_pipeline.js`
Expected: all three scripts print their pass lines and exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/core/pipeline.js tests/test_pipeline.js
git commit -m "feat(core): evaluateBar pipeline (indicator → signal → RiskPolicy)"
```

---

## Done criteria

- `src/core/{contracts,SignalAdapter,pipeline}.js` exist and are pure (no DB/network/`Date.now`).
- All four indicators map to the `Signal` contract; WaveTrend side mapping now exists.
- Neutral markets yield `HOLD` (not the legacy `BUY`-on-neutral) — to be locked by characterization tests in a later phase.
- `RiskPolicy` and `IndicatorManager` are imported unchanged (parity preserved).
- No live trading path (`bot_engine.js`, `AgentOrchestrator`) was modified.

## Next plans (not in this one)

- **Phase 2 — Data layer:** `market_data.db`, `MarketDataRepo`, BitGet downloader (candles/funding/specs) + `--verify`.
- **Phase 3 — Backtest shell (spot):** walk-forward engine over `evaluateBar`, fills/fees/slippage at `leverage=1`, metrics + persistence.
- **Phase 4+ —** futures (margin/funding/liquidation), runner matrix, characterization tests + flagged live migration.
