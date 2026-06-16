# RangeFilter Strategy (VMC Swing) — Design Spec

**Date:** 2026-06-16
**Status:** Draft for review
**Source:** `strategy/VMC Swing.txt` — DonovanWall "Range Filter — Buy & Sell Signals" (Pine `@version=4`)

## 1. Goal

Port the TradingView "Range Filter — B&S Signals" indicator into the bot as a
first-class logic type (`RangeFilter`) so the user can build **both AI agents and
manual bots** from logic + risk templates. Maximize fidelity to the Pine logic and
add a **signal-driven exit mode** ("stop-and-reverse") so long trending moves on
higher timeframes are not capped by a fixed take-profit.

> Naming note: the file is called "VMC Swing" but the Pine is the Range Filter
> indicator, unrelated to the existing `vmc_cipherb*` family (WaveTrend/MFI). We
> name the new logic type `RangeFilter` to avoid confusion.

## 2. Indicator: `src/indicators/rangeFilter.js`

Pure, deterministic port of the Pine. Signal is computed on the last **closed**
candle (no look-ahead). Output contract mirrors `donchianTrend.js`:

```js
{
  side: 'BUY' | 'SELL' | 'HOLD',  // fresh-flip side, or HOLD between flips
  state: 1 | -1 | 0,              // persistent CondIni state (long/short phase)
  dir: 1 | -1 | 0,                // filter direction (fdir): rising / falling
  freshFlip: boolean,             // true on the bar where state flips (= Pine label)
  filter: number,                 // range filter line value
  hiBand: number, loBand: number, // filter ± range (used for ATR-free structural SL option)
  price: number                   // last close
}
```

### Configurable parameters (read from `config.indicators`, camelCase **and** snake_case)

Per repo casing policy (`resolveConfig` deep-camelCases `indicators`; snake_case
reads silently hit defaults — see project memory). Use the dual-read `pick()`
helper exactly as `donchianTrend.js` does.

| Param        | Pine name        | Default | Notes |
|--------------|------------------|---------|-------|
| `source`     | Swing Source     | `close` | one of `close,open,high,low,hl2,hlc3,ohlc4` |
| `period`     | Swing Period     | `20`    | `rng_per` |
| `multiplier` | Swing Multiplier | `3.5`   | `rng_qty` |

### Logic (1:1 with Pine)

1. `src = resolveSource(candle, source)`
2. `rngSize = EMA(EMA(|src - src₁|, period), 2*period - 1) * multiplier`
3. Range filter (stepwise): `rfilt` only moves when `src` exits the `±rngSize` band
   around the previous `rfilt` (Pine `rng_filt`).
4. `dir` (fdir): `filter > filter₁ → 1`, `filter < filter₁ → -1`, else carry forward.
5. `longCond` / `shortCond`: price vs filter + direction (Pine lines 67-68).
6. `state` (CondIni): persists long/short phase; flips on the first opposing cond.
7. `freshFlip`: `longCondition`/`shortCondition` — the bar where `state` flips.
8. `side`: `BUY`/`SELL` on a fresh flip in `sl_tp` mode; in `signal` mode the engine
   also uses `state` for re-entry (see §4).

## 3. Integration points (5 files — same path as DonchianTrend/ScalpBreakout)

1. **`src/indicators/index.js`** — `case 'RANGEFILTER': results = RangeFilter.execute(candles, this.config); break;`
2. **`src/core/SignalAdapter.js`** — `fromRangeFilter(raw)`: `side` from `raw.side`;
   conviction `0.6`, `+0.1` if `raw.freshFlip`; invalidation = opposing band
   (`loBand` for BUY, `hiBand` for SELL). Add `case 'RANGEFILTER'` to `deriveSignal`.
3. **`src/manual/legacyManualSide.js`** — add a `RangeFilter` branch that returns
   `strategyData.side` (defaulting to BUY on HOLD, preserving legacy contract).
4. **`src/agents/deriveAgentProposal.js`** — add `'RANGEFILTER'` to `CORE_LOGIC_TYPES`
   so AI agents can select it. (Also update the "four logic types" comment.)
5. **`src/validators/safety-rules.js`** — new rule `rf_trend_align`: passes when the
   filter direction (`dir`) matches the resolved side. Wire it into
   `src/validators/index.js` (weight + id mapping, same as `htf_trend_filter`).

## 4. Signal-driven exit mode (the core ask)

### Problem
Today, when an active position exists, the engine only checks SL/TP
(`bot_engine.js:299-327`) — the indicator is never recomputed. A fixed R:R 1:2 TP
caps long trend moves.

### Design: `exit_mode` (lives in the **logic template**)
- `exit_mode: "sl_tp"` (default / absent) — current behavior, unchanged for every
  existing strategy.
- `exit_mode: "signal"` — when an active position exists, recompute the indicator
  on current candles and:
  - **Opposite flip → close** the position by signal (record as a normal close).
  - **Protective stop still honored** (see §5) as a catastrophe floor.
  - Take-profit is **ignored** in this mode.

### Re-entry / stop-and-reverse
- When flat **and** `exit_mode === "signal"`, entry uses the persistent `state`
  (current filter direction), not just a fresh flip. So the cycle after a
  signal-close re-enters the opposite side → effective stop-and-reverse with a
  ≤1-cycle gap (negligible on 1H/4H; cycle interval default 5 min).
- When flat **and** `exit_mode === "sl_tp"`, entry requires `freshFlip` (clean
  flip entry for good R:R), exactly as Pine plots the label.

This keeps the engine's branch structure intact (no in-place reversal refactor):
the active-position branch closes; the next cycle's flat branch re-enters.

## 5. Risk: uniform protective stop across ALL risk templates

Redefine the meaning of the existing risk fields uniformly (no new per-strategy
mechanism, no change to existing templates' behavior):

- **`stop_loss_percent`** → the **protective / structural stop**, honored in *every*
  exit mode. This is the "стоп-кран". The engine already checks SL for both sides.
- **`take_profit_percent`** → profit target, honored **only** when `exit_mode: "sl_tp"`.

### Protective stop value for `range_filter` risk template
- **Default:** wide fixed `stop_loss_percent: 8` — fires only on black-swan moves,
  not on normal trend noise, so the flip exit does the real work.
- **Optional:** ATR stop via the engine's existing `stop_mode: "atr"` + `atr_period`
  (e.g. `3 × ATR`). More adaptive across assets/TFs; available, not the default, to
  keep the percent-based baseline uniform across all risk templates.

## 6. Templates (data)

### `templates/logic/range_filter.json`
```json
{
  "name": "Range Filter (VMC Swing)",
  "type": "RangeFilter",
  "exit_mode": "signal",
  "indicators": { "source": "close", "period": 20, "multiplier": 3.5 },
  "safety_checks": [
    { "id": "rf_trend_align", "description": "Filter direction must match the trade side" }
  ]
}
```

### `templates/risk/range_filter.json`
```json
{
  "name": "Range Filter Risk",
  "risk_per_trade_percent": 1,
  "stop_loss_percent": 8,
  "take_profit_percent": null,
  "max_open_positions": 3,
  "min_risk_reward_ratio": 0
}
```
(Exact risk numbers to be sanity-checked against an existing risk template's shape
during implementation.)

## 7. AI vs manual wiring (already supported)

Both templates appear automatically in the dropdowns of `AIAgentConfigForm.tsx`
and `StrategyConfigForm.tsx` (they read the logic/risk template lists). No frontend
changes required. `source/period/multiplier` are editable via `logicOverrides`.

## 8. Incidental fix (separate commit)

`src/agents/deriveAgentProposal.js:44` calls `IndicatorManager.calculate(...)`
**without `await`**, but that method became `async` in the just-landed HTF feature
(`44665fc`). The AI proposal path currently receives a Promise → broken for *all*
logic types. Add `await` (and make the surrounding function async) as part of this
work, since we touch the same AI path.

## 9. Testing & verification

- New unit test for `rangeFilter.js`: verify range-size/filter/flip against a few
  hand-computed bars derived from the Pine formulas (no look-ahead).
- `node test_indicators.js` — existing indicator validation passes.
- Signal-exit: a focused test that, given a sequence producing BUY-flip then
  SELL-flip, the resolver closes the long and re-enters short.
- Default execution stays **paper trading** (`paperTrading: true`) — no live orders.
- Backtest sanity: run `range_filter` on a trending symbol/TF and confirm signal
  exits ride trends longer than the sl_tp baseline.

## 10. Out of scope

- True same-cycle in-place reversal (the ≤1-cycle gap re-entry is sufficient).
- Multi-timeframe Sommi-style confirmation.
- Frontend UI beyond the existing template dropdowns.
