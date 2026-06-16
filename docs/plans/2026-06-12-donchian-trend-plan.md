# Donchian Trend-Following Scout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in, default-off `DonchianTrend` logic (channel breakout entry, 2×ATR initial stop, ratcheting M-bar channel trailing exit, both directions) and measure it blind on the 6-symbol universe at 1H + 4H, against a buy-and-hold benchmark.

**Architecture:** Entry is a new pure logic `donchianTrend.execute` (prior N-bar high/low breakout → BUY/SELL), plumbed like `TrendPullback` (Technicals → execute → SignalAdapter mapper → IndicatorManager → runner param threading). The exit is split: a **2×ATR initial hard stop** via a new `stopMode: 'channel'` in RiskPolicy (SL from `ctx.atr`, `tpPrice = null`), and the **Donchian channel exit** modeled as a ratchet-only trailing stop on the M-bar opposite extreme, applied per-bar in the backtest simulator (same timing as the existing breakeven block — recomputed after the exit check, binds on subsequent bars only). Live `bot_engine.js` is untouched; the trailing exit lives only in `src/backtest/`.

**Tech Stack:** Node.js ESM, the existing backtest engine (`src/backtest/simulator.js`, `src/agents/RiskPolicy.js`, `src/core/pipeline.js`), `Technicals` (`src/indicators/technical.js`), SQLite market data via `MarketDataRepo`. Tests are plain `node:assert` scripts under `tests/` run with `node`.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/indicators/technical.js` | `Technicals.donchian(candles, period)` → latest `{upper, lower}` channel | Modify |
| `src/indicators/donchianTrend.js` | Entry logic: prior-N-bar breakout → side | Create |
| `src/core/SignalAdapter.js` | `fromDonchianTrend` mapper + `deriveSignal` switch case | Modify |
| `src/indicators/index.js` | `IndicatorManager` switch case for `DONCHIANTREND` | Modify |
| `src/core/pipeline.js` | compute `ctx.atr` for `stopMode === 'channel'` too | Modify |
| `src/agents/RiskPolicy.js` | `stopMode === 'channel'` branch: SL from ATR, `tpPrice = null` | Modify |
| `src/backtest/exitPolicy.js` | `channelTrailStop(position, recentCandles)` ratchet-only | Modify |
| `src/backtest/simulator.js` | apply `channelTrailStop` when `exitPolicy.channelExit > 0` | Modify |
| `backtest/run-backtest.js` | `buildLogicConfig` Donchian keys + `exitPolicy.channelExit` CLI wiring | Modify |
| `backtest/run-donchian-scout.mjs` | 48-cell sweep driver (direct `simulate`), prints train/test/benchmark tables | Create |
| `tests/test_donchian.mjs` | channel primitive + execute logic | Create |
| `tests/test_channel_trail.mjs` | trailing stop ratchet | Create |
| `tests/test_donchian_signal.mjs` | adapter mapping + dispatch | Create |
| `docs/research/2026-06-12-donchian-trend.md` | results + verdict (kept local, gitignored) | Create |

---

### Task 1: `Technicals.donchian` channel primitive

**Files:**
- Modify: `src/indicators/technical.js` (add method to the `Technicals` object, next to `atr`)
- Test: `tests/test_donchian.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/test_donchian.mjs
import assert from 'node:assert';
import { Technicals } from '../src/indicators/technical.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };
const mk = (h, l) => ({ time: 0, open: l, high: h, low: l, close: (h + l) / 2, volume: 1 });

// --- donchian: latest highest-high / lowest-low over the last `period` candles ---
{
  const candles = [mk(10, 5), mk(12, 6), mk(11, 4), mk(13, 7)];
  const ch = Technicals.donchian(candles, 3); // last 3: highs 12,11,13 lows 6,4,7
  assert.strictEqual(ch.upper, 13, 'upper = max high of last 3');
  assert.strictEqual(ch.lower, 4, 'lower = min low of last 3');
  ok('donchian latest channel over last period candles');
}

// --- donchian: null when fewer than `period` candles ---
{
  assert.strictEqual(Technicals.donchian([mk(10, 5)], 3), null, 'null below period');
  ok('donchian null when insufficient candles');
}

console.log(`\n${passed} passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_donchian.mjs`
Expected: FAIL — `Technicals.donchian is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/indicators/technical.js`, add this method to the `Technicals` object (place it right after the `atr(candles, period) { ... }` method, keeping the comma-separated object style):

```javascript
  /**
   * Latest Donchian channel: highest high and lowest low over the LAST `period` candles
   * (inclusive of the final candle). Returns { upper, lower } or null if fewer than
   * `period` candles. To get a *prior-bar* breakout level, pass candles.slice(0, -1).
   * Pure; no look-ahead beyond the candles handed in.
   */
  donchian(candles, period) {
    if (!Array.isArray(candles) || candles.length < period) return null;
    const window = candles.slice(candles.length - period);
    let upper = -Infinity, lower = Infinity;
    for (const c of window) {
      if (c.high > upper) upper = c.high;
      if (c.low < lower) lower = c.low;
    }
    return { upper, lower };
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_donchian.mjs`
Expected: PASS — `2 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/indicators/technical.js tests/test_donchian.mjs
git commit -m "feat(indicators): Technicals.donchian latest channel primitive"
```

---

### Task 2: `donchianTrend.execute` breakout entry logic

**Files:**
- Create: `src/indicators/donchianTrend.js`
- Test: `tests/test_donchian.mjs` (extend with execute cases)

- [ ] **Step 1: Write the failing test (append to `tests/test_donchian.mjs` BEFORE the final `console.log`)**

```javascript
import DonchianTrend from '../src/indicators/donchianTrend.js';

const bar = (h, l, c) => ({ time: 0, open: c, high: h, low: l, close: c, volume: 1 });

// --- breakout above prior 20-bar high → BUY ---
{
  const candles = [];
  for (let i = 0; i < 20; i++) candles.push(bar(100, 95, 98)); // prior channel high = 100
  candles.push(bar(102, 99, 101));                              // close 101 > 100 → BUY
  const raw = DonchianTrend.execute(candles, { indicators: { entryLookback: 20 } });
  assert.strictEqual(raw.side, 'BUY', `close above prior high → BUY (got ${raw.side})`);
  ok('donchian breakout up → BUY');
}

// --- breakdown below prior 20-bar low → SELL ---
{
  const candles = [];
  for (let i = 0; i < 20; i++) candles.push(bar(100, 95, 98)); // prior channel low = 95
  candles.push(bar(96, 90, 94));                               // close 94 < 95 → SELL
  const raw = DonchianTrend.execute(candles, { indicators: { entryLookback: 20 } });
  assert.strictEqual(raw.side, 'SELL', `close below prior low → SELL (got ${raw.side})`);
  ok('donchian breakdown → SELL');
}

// --- inside the channel → HOLD ---
{
  const candles = [];
  for (let i = 0; i < 20; i++) candles.push(bar(100, 95, 98));
  candles.push(bar(99, 96, 98));                               // close 98 inside [95,100] → HOLD
  const raw = DonchianTrend.execute(candles, { indicators: { entryLookback: 20 } });
  assert.strictEqual(raw.side, 'HOLD', `close inside channel → HOLD (got ${raw.side})`);
  ok('donchian inside channel → HOLD');
}

// --- not enough candles → HOLD ---
{
  const raw = DonchianTrend.execute([bar(100, 95, 98)], { indicators: { entryLookback: 20 } });
  assert.strictEqual(raw.side, 'HOLD', 'insufficient candles → HOLD');
  ok('donchian insufficient candles → HOLD');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_donchian.mjs`
Expected: FAIL — cannot find module `donchianTrend.js`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/indicators/donchianTrend.js
import { Technicals } from './technical.js';

/**
 * Donchian channel-breakout trend entry. The current close breaking above the prior
 * `entryLookback`-bar high → BUY; below the prior low → SELL; inside → HOLD. The channel
 * is computed on candles EXCLUDING the current bar (slice(0, -1)), so the breakout level is
 * known before the current close — no look-ahead. The exit (2×ATR initial stop + M-bar
 * channel trailing stop) is handled by the backtest engine, not here. Pure/deterministic.
 */
const DonchianTrend = {
  execute(candles, config = {}) {
    const ind = config.indicators || {};
    const pick = (cam, sn, def) => {
      const v = [ind[cam], ind[sn]].find((x) => x !== undefined && x !== null);
      return v ?? def;
    };
    const entryLookback = pick('entryLookback', 'entry_lookback', 20);

    const HOLD = { side: 'HOLD', upper: null, lower: null, price: null, invalidation: null };
    if (!Array.isArray(candles) || candles.length < entryLookback + 1) return HOLD;

    const prior = candles.slice(0, -1);
    const ch = Technicals.donchian(prior, entryLookback);
    if (!ch) return HOLD;

    const price = candles[candles.length - 1].close;
    let side = 'HOLD';
    if (price > ch.upper) side = 'BUY';
    else if (price < ch.lower) side = 'SELL';

    return { side, upper: ch.upper, lower: ch.lower, price, invalidation: null };
  },
};

export default DonchianTrend;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_donchian.mjs`
Expected: PASS — `6 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/indicators/donchianTrend.js tests/test_donchian.mjs
git commit -m "feat(indicators): donchianTrend breakout entry logic"
```

---

### Task 3: SignalAdapter mapper + dispatch registration

**Files:**
- Modify: `src/core/SignalAdapter.js` (add `fromDonchianTrend` + switch case)
- Modify: `src/indicators/index.js` (add `IndicatorManager` switch case)
- Test: `tests/test_donchian_signal.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/test_donchian_signal.mjs
import assert from 'node:assert';
import { deriveSignal } from '../src/core/SignalAdapter.js';
import { IndicatorManager } from '../src/indicators/index.js';
import { SIDE } from '../src/core/contracts.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };
const bar = (h, l, c) => ({ time: 0, open: c, high: h, low: l, close: c, volume: 1 });

// --- mapper: BUY raw → BUY signal, no fixed invalidation (SL is ATR-based) ---
{
  const sig = deriveSignal('DonchianTrend', { side: 'BUY', invalidation: null }, { price: 101, candles: [] });
  assert.strictEqual(sig.side, SIDE.BUY, 'BUY raw maps to BUY signal');
  assert.strictEqual(sig.invalidation, null, 'no structural invalidation (ATR stop)');
  ok('fromDonchianTrend maps BUY');
}

// --- mapper: HOLD raw → HOLD ---
{
  const sig = deriveSignal('DonchianTrend', { side: 'HOLD' }, { price: 100, candles: [] });
  assert.strictEqual(sig.side, SIDE.HOLD, 'HOLD raw maps to HOLD');
  ok('fromDonchianTrend maps HOLD');
}

// --- IndicatorManager dispatches DONCHIANTREND to execute ---
{
  const candles = [];
  for (let i = 0; i < 20; i++) candles.push(bar(100, 95, 98));
  candles.push(bar(102, 99, 101));
  const raw = new IndicatorManager({ indicators: { entryLookback: 20 } }).calculate('DonchianTrend', candles);
  assert.strictEqual(raw.side, 'BUY', 'IndicatorManager routes DonchianTrend → execute');
  ok('IndicatorManager dispatches DonchianTrend');
}

console.log(`\n${passed} passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_donchian_signal.mjs`
Expected: FAIL — `Unsupported logicType: DonchianTrend`.

- [ ] **Step 3: Write minimal implementation**

In `src/core/SignalAdapter.js`, add this mapper right after `fromTrendPullback` (before `deriveSignal`):

```javascript
/** DonchianTrend: execute() already resolved the side; flat conviction (no confidence signal). */
function fromDonchianTrend(raw) {
  const side = raw?.side ?? SIDE.HOLD;
  if (side === SIDE.HOLD) return hold('DonchianTrend: price inside channel');
  return { side, conviction: 0.6, reason: `DonchianTrend ${side}`, invalidation: raw.invalidation ?? null };
}
```

Then add the case to the `deriveSignal` switch (after the `TRENDPULLBACK` case):

```javascript
    case 'DONCHIANTREND': return fromDonchianTrend(raw);
```

In `src/indicators/index.js`, add the import at the top (after the `TrendPullback` import):

```javascript
import DonchianTrend from './donchianTrend.js';
```

And the case to the `calculate` switch (after the `TRENDPULLBACK` case):

```javascript
      case 'DONCHIANTREND':
        return DonchianTrend.execute(candles, this.config);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_donchian_signal.mjs`
Expected: PASS — `3 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/core/SignalAdapter.js src/indicators/index.js tests/test_donchian_signal.mjs
git commit -m "feat(signal): wire DonchianTrend through SignalAdapter and IndicatorManager"
```

---

### Task 4: `stopMode: 'channel'` — 2×ATR stop, no take-profit

**Files:**
- Modify: `src/core/pipeline.js` (compute `ctx.atr` for `channel` mode)
- Modify: `src/agents/RiskPolicy.js` (add `channel` branch)
- Test: `tests/test_risk_policy.mjs` (extend) — verify with a focused new test file to avoid coupling

Create a dedicated test file so the assertion is self-contained:
- Test: `tests/test_channel_stopmode.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/test_channel_stopmode.mjs
import assert from 'node:assert';
import { evaluateBar } from '../src/core/pipeline.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

// Build a clean uptrend so DonchianTrend(entry=20) fires BUY on the last bar.
function uptrend() {
  const candles = [];
  let p = 100;
  for (let i = 0; i < 25; i++) { p += 1; candles.push({ time: i * 3600000, open: p - 1, high: p + 0.5, low: p - 1.5, close: p, volume: 1 }); }
  return candles;
}

// --- channel stopMode: SL = entry - 2*ATR, tpPrice = null ---
{
  const candles = uptrend();
  const ctx = { candles, config: { logicType: 'DonchianTrend', logic: { indicators: { entryLookback: 20 } } }, symbol: 'X', timeframe: '1H' };
  const guardrails = {
    portfolioValue: 10000, riskPerTrade: 0.02, sizingMode: 'fixed',
    stopLossPct: 0.02, takeProfitPct: 0.04, minRiskRewardRatio: 0,
    maxOpenPositions: 1, maxPortfolioHeatPct: 100, dailyLossLimitPct: 1,
    maxTradesPerDay: 999999, leverage: 1, stopMode: 'channel', atrPeriod: 14, atrSL: 2,
  };
  const account = { guardrails, portfolio: { openPositions: 0, portfolioHeatPct: 0, dailyPnlPct: 0, tradesToday: 0 } };
  const { signal, decision } = evaluateBar(ctx, account);
  assert.strictEqual(signal.side, 'BUY', `setup should be BUY (got ${signal.side})`);
  assert.strictEqual(decision.decision, 'PERMIT', `should PERMIT (got ${decision.decision}: ${decision.reason})`);
  const o = decision.order;
  assert.strictEqual(o.tpPrice, null, 'channel mode sets no take-profit');
  assert.ok(o.slPrice < o.entryPrice, 'BUY stop below entry');
  ok('channel stopMode: ATR stop, null TP');
}

console.log(`\n${passed} passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_channel_stopmode.mjs`
Expected: FAIL — `o.tpPrice` is not `null` (falls through to percent TP), and/or `slPrice` not ATR-based because `ctx.atr` is null under `channel` mode.

- [ ] **Step 3: Write minimal implementation**

In `src/core/pipeline.js`, broaden the ATR computation gate. Change:

```javascript
  let atr = null;
  if (g.stopMode === 'atr') {
```

to:

```javascript
  let atr = null;
  if (g.stopMode === 'atr' || g.stopMode === 'channel') {
```

In `src/agents/RiskPolicy.js`, add a `channel` branch in the stop-geometry block, right after the `stopMode === 'structural'` branch (before the closing of that `if/else if` chain, i.e. as a new `else if`):

```javascript
    } else if (g.stopMode === 'channel' && ctx && ctx.atr > 0) {
      // Donchian: 2×ATR initial hard stop; NO fixed take-profit. The M-bar channel
      // trailing stop (applied in the simulator) is the only profit-side exit.
      const kSl = g.atrSL ?? 2;
      slPrice = round(isBuy ? entryPrice - kSl * ctx.atr : entryPrice + kSl * ctx.atr);
      tpPrice = null;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_channel_stopmode.mjs`
Expected: PASS — `1 passed`.

- [ ] **Step 5: Run the existing RiskPolicy + pipeline suites to confirm no regression**

Run: `node tests/test_risk_policy.mjs && node tests/test_pipeline.js`
Expected: PASS (all existing assertions green — the new branch is additive, gated on `stopMode === 'channel'`).

- [ ] **Step 6: Commit**

```bash
git add src/core/pipeline.js src/agents/RiskPolicy.js tests/test_channel_stopmode.mjs
git commit -m "feat(risk): channel stopMode — 2xATR stop, no take-profit"
```

---

### Task 5: Channel trailing stop in the simulator

**Files:**
- Modify: `src/backtest/exitPolicy.js` (add `channelTrailStop`)
- Modify: `src/backtest/simulator.js` (apply it when `exitPolicy.channelExit > 0`)
- Test: `tests/test_channel_trail.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/test_channel_trail.mjs
import assert from 'node:assert';
import { channelTrailStop } from '../src/backtest/exitPolicy.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };
const bar = (h, l) => ({ time: 0, open: l, high: h, low: l, close: (h + l) / 2, volume: 1 });

// --- BUY: ratchet UP to the M-bar lowest low; never lowers ---
{
  const pos = { side: 'BUY', entryPrice: 100, slPrice: 90 }; // initial 2ATR stop at 90
  // recent lows 96, 97, 98 → lowest 96 > 90 → stop ratchets up to 96
  const moved = channelTrailStop(pos, [bar(101, 96), bar(102, 97), bar(103, 98)]);
  assert.strictEqual(moved, 96, 'BUY stop ratchets up to M-bar low');
  ok('channelTrailStop BUY ratchets up');
}

// --- BUY: never lowers below current stop ---
{
  const pos = { side: 'BUY', entryPrice: 100, slPrice: 98 };
  const moved = channelTrailStop(pos, [bar(101, 95), bar(102, 94)]); // lowest 94 < 98 → keep 98
  assert.strictEqual(moved, 98, 'BUY stop never lowers');
  ok('channelTrailStop BUY ratchet-only');
}

// --- SELL: ratchet DOWN to the M-bar highest high; never raises ---
{
  const pos = { side: 'SELL', entryPrice: 100, slPrice: 110 };
  const moved = channelTrailStop(pos, [bar(104, 99), bar(103, 98)]); // highest 104 < 110 → 104
  assert.strictEqual(moved, 104, 'SELL stop ratchets down to M-bar high');
  ok('channelTrailStop SELL ratchets down');
}

// --- empty window → unchanged ---
{
  const pos = { side: 'BUY', entryPrice: 100, slPrice: 90 };
  assert.strictEqual(channelTrailStop(pos, []), 90, 'empty window keeps stop');
  ok('channelTrailStop empty window unchanged');
}

console.log(`\n${passed} passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_channel_trail.mjs`
Expected: FAIL — `channelTrailStop is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/backtest/exitPolicy.js`:

```javascript
/**
 * Donchian channel trailing stop. Ratchets the stop toward price by the opposite M-bar
 * extreme of the supplied window: BUY → up to the lowest low (never lowers); SELL → down to
 * the highest high (never raises). Pure; the caller decides the window and applies it once
 * per bar AFTER the exit check (so it only binds on subsequent bars).
 *
 * @param {{side:'BUY'|'SELL', slPrice:number}} position
 * @param {{high:number, low:number}[]} recentCandles the last M candles
 * @returns {number} the (possibly ratcheted) stop price
 */
export function channelTrailStop(position, recentCandles) {
  if (!Array.isArray(recentCandles) || recentCandles.length === 0) return position.slPrice;
  if (position.side === 'BUY') {
    let lowest = Infinity;
    for (const c of recentCandles) if (c.low < lowest) lowest = c.low;
    return Math.max(position.slPrice, lowest); // ratchet up only
  }
  let highest = -Infinity;
  for (const c of recentCandles) if (c.high > highest) highest = c.high;
  return Math.min(position.slPrice, highest); // ratchet down only
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_channel_trail.mjs`
Expected: PASS — `4 passed`.

- [ ] **Step 5: Wire it into the simulator**

In `src/backtest/simulator.js`, add the import to the existing line:

```javascript
import { breakevenStop } from './exitPolicy.js';
```

becomes:

```javascript
import { breakevenStop, channelTrailStop } from './exitPolicy.js';
```

Then add a new block immediately after the breakeven block (after the `// 3b) Breakeven stop.` block closes, before `// 4) If flat, decide...`):

```javascript
    // 3c) Channel trailing stop (Donchian exit). Recompute the M-bar opposite extreme AFTER
    // this bar's exit check so it binds only on subsequent bars (same timing as breakeven).
    if (position && p.exitPolicy && p.exitPolicy.channelExit > 0) {
      const M = p.exitPolicy.channelExit;
      const w = candles.slice(Math.max(0, i - M + 1), i + 1);
      const moved = channelTrailStop(position, w);
      if (moved !== position.slPrice) position.slPrice = moved;
    }
```

- [ ] **Step 6: Run the simulator integration suite to confirm no regression**

Run: `node tests/test_backtest_integration.js`
Expected: PASS — existing runs are unaffected (the block is gated on `exitPolicy.channelExit > 0`, which no existing run sets).

- [ ] **Step 7: Commit**

```bash
git add src/backtest/exitPolicy.js src/backtest/simulator.js tests/test_channel_trail.mjs
git commit -m "feat(backtest): Donchian channel trailing stop in simulator"
```

---

### Task 6: Runner param threading + CLI wiring

**Files:**
- Modify: `backtest/run-backtest.js` (`buildLogicConfig` keys + `exitPolicy.channelExit`)
- Test: `tests/test_build_logic_config.mjs` (extend)

- [ ] **Step 1: Write the failing test (append to `tests/test_build_logic_config.mjs` before any final summary line)**

```javascript
// --- Donchian: entryLookback threads into indicators ---
{
  const cfg = buildLogicConfig({ entryLookback: 55 });
  assert.strictEqual(cfg.indicators.entryLookback, 55, 'entryLookback threaded as Number');
  ok('buildLogicConfig threads Donchian entryLookback');
}
```

(If the file imports `buildLogicConfig` and defines `ok`/`assert` already, reuse them; otherwise mirror the imports at the top of the existing file: `import { buildLogicConfig } from '../backtest/run-backtest.js';`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_build_logic_config.mjs`
Expected: FAIL — `cfg.indicators` is `undefined` (`entryLookback` not in `KEYS`).

- [ ] **Step 3: Write minimal implementation**

In `backtest/run-backtest.js`, extend the `KEYS` array in `buildLogicConfig` to include the Donchian entry param:

```javascript
  const KEYS = ['emaBias', 'slopeLen', 'adxPeriod', 'adxMin', 'emaFast', 'rsiPeriod', 'rsiPullback', 'htfRatio', 'entryLookback'];
```

Then wire the channel-exit into the CLI `exitPolicy`. Replace:

```javascript
  const exitPolicy = args.breakevenR != null ? { breakevenR: Number(args.breakevenR) } : undefined;
```

with:

```javascript
  let exitPolicy;
  if (args.breakevenR != null || args.channelExit != null) {
    exitPolicy = {};
    if (args.breakevenR != null) exitPolicy.breakevenR = Number(args.breakevenR);
    if (args.channelExit != null) exitPolicy.channelExit = Number(args.channelExit);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test_build_logic_config.mjs`
Expected: PASS (new assertion green; existing ones unaffected).

- [ ] **Step 5: Smoke-run one Donchian cell end-to-end via the CLI**

Run:
```bash
node backtest/run-backtest.js --symbol BTCUSDT --tf 4H --logic DonchianTrend \
  --entryLookback 20 --channelExit 10 --stopMode channel --atrSL 2 --atrPeriod 14 \
  --equity 10000 --riskPerTrade 0.02 --minRR 0 --leverage 1 \
  --from 2024-06-01 --to 2025-06-01
```
Expected: completes without error and prints a summary with a non-zero trade count (proves entry + ATR stop + channel trail all fire through the real engine path).

- [ ] **Step 6: Commit**

```bash
git add backtest/run-backtest.js tests/test_build_logic_config.mjs
git commit -m "feat(backtest): thread Donchian entryLookback + channelExit through runner CLI"
```

---

### Task 7: Measurement sweep + research note

**Files:**
- Create: `backtest/run-donchian-scout.mjs`
- Create: `docs/research/2026-06-12-donchian-trend.md` (kept local, gitignored)

This task runs the frozen 2 configs × 2 TFs × 6 symbols × 2 windows = 48 cells via a direct-`simulate` driver (no DB writes), computes PnL% / MaxDD / trade count / buy-and-hold per cell, and records the verdict against the gate. No tuning — the configs are the pre-registered Turtle values from the spec.

- [ ] **Step 1: Write the driver**

```javascript
// backtest/run-donchian-scout.mjs
// Frozen Donchian trend-following sweep. Configs are pre-registered (no tuning).
import { openMarketDb } from '../src/data/marketDataSchema.js';
import { MarketDataRepo } from '../src/data/MarketDataRepo.js';
import { simulate } from '../src/backtest/simulator.js';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'LTCUSDT', 'SOLUSDT', 'XLMUSDT', 'XRPUSDT'];
const TFS = ['1H', '4H'];
const CONFIGS = [
  { name: 'fast', entry: 20, exit: 10 },
  { name: 'slow', entry: 55, exit: 20 },
];
const WINDOWS = {
  train: ['2024-06-01', '2025-06-01'],
  test:  ['2025-06-01', '2026-06-08'],
};
const COSTS = { takerFee: 0.0006, makerFee: 0.0002, slippageBps: 5 };

function guardrails() {
  return {
    portfolioValue: 10000, riskPerTrade: 0.02, sizingMode: 'fixed',
    stopLossPct: 0.02, takeProfitPct: 0.04, minRiskRewardRatio: 0,
    maxOpenPositions: 1, maxPortfolioHeatPct: 100, dailyLossLimitPct: 1,
    maxTradesPerDay: 999999, leverage: 1, stopMode: 'channel', atrPeriod: 14, atrSL: 2,
  };
}

function maxDrawdown(curve) {
  let peak = -Infinity, mdd = 0;
  for (const pt of curve) {
    if (pt.equity > peak) peak = pt.equity;
    if (peak > 0) mdd = Math.max(mdd, (peak - pt.equity) / peak);
  }
  return mdd;
}

async function main() {
  const db = await openMarketDb('market_data.db');
  const repo = new MarketDataRepo(db);
  const rows = [];

  for (const [win, [fromS, toS]] of Object.entries(WINDOWS)) {
    const from = Date.parse(fromS), to = Date.parse(toS);
    for (const cfg of CONFIGS) {
      for (const tf of TFS) {
        for (const symbol of SYMBOLS) {
          const candles = await repo.getCandles(symbol, tf, from, to);
          if (!candles || candles.length < 260) { rows.push({ win, cfg: cfg.name, tf, symbol, skip: candles?.length ?? 0 }); continue; }
          const config = { logicType: 'DonchianTrend', logic: { indicators: { entryLookback: cfg.entry } } };
          const res = simulate({
            candles, config, guardrails: guardrails(), costs: COSTS, symbol, timeframe: tf,
            lookback: 250, exitPolicy: { channelExit: cfg.exit },
          });
          const pnlPct = res.finalEquity / 10000 - 1;
          const bh = candles[candles.length - 1].close / candles[0].close - 1;
          rows.push({ win, cfg: cfg.name, tf, symbol, pnlPct, mdd: maxDrawdown(res.equityCurve), trades: res.trades.length, bh });
        }
      }
    }
  }

  // Print as TSV for easy tabulation into the research note.
  const pct = (x) => (x * 100).toFixed(1) + '%';
  console.log('window\tcfg\ttf\tsymbol\tpnl\tmaxdd\ttrades\tbuyhold\tbeatBH');
  for (const r of rows) {
    if (r.skip != null) { console.log(`${r.win}\t${r.cfg}\t${r.tf}\t${r.symbol}\tSKIP(${r.skip})`); continue; }
    console.log(`${r.win}\t${r.cfg}\t${r.tf}\t${r.symbol}\t${pct(r.pnlPct)}\t${pct(r.mdd)}\t${r.trades}\t${pct(r.bh)}\t${r.pnlPct > r.bh ? 'Y' : 'n'}`);
  }

  // Test-year breadth summary per (cfg, tf): how many of 6 symbols are positive AND beat buy-hold.
  console.log('\n-- test-year breadth (positive / beat-BH out of 6) --');
  for (const cfg of CONFIGS) for (const tf of TFS) {
    const cells = rows.filter((r) => r.win === 'test' && r.cfg === cfg.name && r.tf === tf && r.skip == null);
    const pos = cells.filter((r) => r.pnlPct > 0).length;
    const beat = cells.filter((r) => r.pnlPct > r.bh).length;
    const mddMax = cells.length ? Math.max(...cells.map((r) => r.mdd)) : 0;
    console.log(`${cfg.name}\t${tf}\tpositive ${pos}/6\tbeatBH ${beat}/6\tworstDD ${pct(mddMax)}`);
  }

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run the sweep**

Run: `node backtest/run-donchian-scout.mjs`
Expected: prints 48 data rows (train + test) plus the test-year breadth summary. No errors. Confirm trade counts are non-zero for most cells (a sanity check that entries fire).

- [ ] **Step 3: Write the research note**

Create `docs/research/2026-06-12-donchian-trend.md` capturing, in the same style as `docs/research/2026-06-12-trend-pullback.md`:
- The frozen configs and protocol (1-line restatement: 20/10 + 55/20, 2×ATR, channel trail, spot, fixed 2%, train descriptive / test blind).
- The **test-year** table per (config × tf × symbol): PnL%, MaxDD, trades, buy-and-hold, beat-BH (Y/n).
- The **breadth summary** (positive /6, beat-BH /6, worst DD) per (config × tf).
- A short train-vs-test contrast (did the test year hold up, or was it train-only like SMC?).
- A plain **verdict against the four-part gate** (test PnL > 0, breadth ≥ 4/6, beats buy-and-hold, MaxDD ≤ 30%): PASS or honest FAIL, no goalpost-moving.

- [ ] **Step 4: Run the full regression to confirm the whole scout is green and the live path is untouched**

Run (PowerShell, from repo root):
```powershell
Get-ChildItem tests -Filter 'test_*' | ForEach-Object { node $_.FullName }
git diff --stat HEAD~7 -- bot_engine.js
```
Expected: every test script prints its `N passed` with no failures; `git diff` shows **no changes to `bot_engine.js`** (live path byte-identical).

- [ ] **Step 5: Commit**

```bash
git add backtest/run-donchian-scout.mjs
git commit -m "feat(backtest): Donchian trend-following measurement sweep driver"
```

(The research note under `docs/` is gitignored and stays local — do not commit it.)

---

## Self-Review

**Spec coverage:**
- Signal logic (channel breakout, both directions) → Tasks 1–3. ✓
- 2×ATR initial stop + no fixed TP → Task 4 (`stopMode: 'channel'`). ✓
- Channel exit (M-bar opposite extreme) → Task 5 (ratchet-only trailing stop). ✓
- Pre-registered 20/10 + 55/20 × 1H + 4H × 6 symbols, frozen → Task 7 driver constants. ✓
- Fixed-fractional sizing, no compounding, spot → Task 7 `guardrails()` (`sizingMode: 'fixed'`, `leverage: 1`). ✓
- Train descriptive / test blind, buy-and-hold benchmark → Task 7 windows + `bh` column. ✓
- Four-part success gate → Task 7 Step 3 verdict + breadth summary. ✓
- Live `bot_engine.js` byte-identical → Task 7 Step 4 `git diff` check; all engine changes are backtest-side or gated on new opt-in flags. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; the research-note step lists exact required contents (mirrors the existing trend-pullback note). ✓

**Type consistency:** `entryLookback` (logic param, Task 2 + 6), `channelExit` (exitPolicy field, Tasks 5 + 6 + 7), `stopMode: 'channel'` (Tasks 4 + 7), `channelTrailStop(position, recentCandles)` (defined Task 5, called in simulator Task 5 and nowhere else) — names match across tasks. `Technicals.donchian` returns `{upper, lower}` (Task 1) consumed in Task 2. ✓

**Note on the ratchet-only simplification:** modeling the Donchian channel exit as a ratchet-only trailing stop is a deliberate, conservative fidelity choice (a stop never widens). It differs marginally from "exit on any new M-bar low" when the channel low is descending; for a trend-following system this is immaterial and is the standard "Donchian = trailing stop" formulation. Record this one-liner in the research note so the result is interpreted correctly.
