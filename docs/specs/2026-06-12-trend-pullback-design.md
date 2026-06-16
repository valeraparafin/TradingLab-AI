# TrendPullback Strategy — Design Spec

**Date:** 2026-06-12
**Status:** Design approved, pending spec review → plan.
**Scope:** New backtest-first trading logic `TrendPullback`. Live path (`bot_engine.js`)
untouched until the edge is validated out-of-sample. All new behavior is opt-in.

## Goal

Build an intraday (1H working TF) **trend-continuation** strategy whose per-trade edge
**survives the blind test year**, where the prior SMC attempt did not (test-year −2.1%,
PF ≈ 0.99). The differentiator vs SMC is an explicit **regime gate** (ADX) plus an optional
higher-timeframe bias — the missing filter that let SMC trade trends and chop identically.

Success is defined by **risk-adjusted, out-of-sample** metrics (below), not a raw PnL number.
If a genuine edge exists, the already-built compound sizing scales the % on its own; if it
does not, no number target can manufacture it (the lesson of the PnL campaign).

## Edge thesis (Approach A — classic trend stack)

Four orthogonal layers; **every** layer must agree or the bar is HOLD. Few free parameters
by design — parameter count is the main enemy of out-of-sample robustness.

| Layer | TF | Implementation | LONG condition (SHORT mirrored) |
|---|---|---|---|
| 1. Bias | HTF (ratio×working) | EMA + its regression slope | close > EMA_bias AND slope > 0 |
| 2. Regime gate | HTF (ratio×working) | Wilder ADX | ADX > adxMin (else HOLD — chop) |
| 3. Trigger | working (1H) | pullback to fast EMA + RSI turn | price tags/crosses EMA_fast on a pullback AND RSI crosses up through rsiPullback |
| 4. Exit/risk | working (1H) | structural/ATR stop + breakeven + trail | invalidation = last swing low |

**Single-TF vs dual-TF is a toggle, not a baked decision.** `htfRatio = 1` computes bias and
regime on the working TF (one-TF version); `htfRatio = 4` aggregates the working candles to
4H via the existing `aggregateHTF` (two-TF version). The trigger is always on the working TF.
The measurement phase A/B-tests both on the train year and lets the data decide.

Symmetric long/short — the engine supports SELL; trend logic is naturally symmetric, no extra
parameters.

### Default parameters

| Param | Default | Meaning |
|---|---|---|
| `emaBias` | 200 | EMA period for the bias layer |
| `slopeLen` | 20 | bars used for the regression slope of EMA_bias |
| `adxPeriod` | 14 | Wilder ADX period |
| `adxMin` | 22 | regime gate threshold; ADX below = no trade |
| `emaFast` | 20 | fast EMA the pullback retraces to |
| `rsiPeriod` | 14 | Wilder RSI period |
| `rsiPullback` | 45 | RSI level the trigger must cross up through (LONG) |
| `htfRatio` | 4 | bias/regime TF = ratio × working TF; 1 = single-TF |

`conviction` encodes confluence: base 0.5, +0.2 when ADX > 30, +0.15 on a clean RSI turn.
Consumed by RiskPolicy / future sizing.

## Architecture & integration

Follows the existing pluggable-logic pattern exactly (new `logicType` = indicator module +
SignalAdapter mapper producing `{side, conviction, reason, invalidation}`).

- **`src/indicators/technical.js`** — add three pure helpers, each unit-tested against
  reference values, mirroring the existing `atr`:
  - `adx(candles, period)` — Wilder DMI/ADX, returns ascending series.
  - `rsi(values, period)` — Wilder RSI, returns ascending series.
  - `slope(values, period)` — least-squares slope over the last `period` values, normalized
    by price (so it is unit-free / comparable across symbols).
- **`src/indicators/trendPullback.js`** (new) — `execute(candles, config)` computes all four
  layers and returns a raw object exposing the intermediate values (bias direction, slope,
  adx, rsi, fast-EMA touch, swing low/high) plus the resolved side. Reads params from
  `config.indicators` with the tolerant camelCase→snake_case→default lookup used by `smc.js`.
  Honors `htfRatio` via `aggregateHTF` for layers 1–2.
- **`src/core/SignalAdapter.js`** — add `fromTrendPullback(raw, ctx)` collapsing the layers to
  the `Signal` contract; `invalidation` = last swing low (LONG) / swing high (SHORT) for the
  structural stop already supported by RiskPolicy. Register in the `deriveSignal` switch.
- **`src/indicators/index.js`** — register `TRENDPULLBACK` in `IndicatorManager.calculate`.
- **`backtest/run-backtest.js` & `run-matrix.js`** — allow the new logic name (lift the
  4-name validation) and plumb `--htfRatio` and the threshold flags into the indicator config.
- **Live untouched:** `bot_engine.js` never calls `simulate`; the shared `pipeline.js` /
  `RiskPolicy` paths stay byte-identical, consistent with every opt-in feature this campaign
  shipped.

## Validation methodology (the discipline)

- **Train:** 2024-06 → 2025-06. **Test (blind):** 2025-06 → 2026-06. Optimize on train only.
- **Parameter grids** (`adxMin`, `rsiPullback`, `htfRatio`, `stopMode`) swept via the matrix
  runner on the train year. Accept a value **only on a plateau** — neighboring values must
  also be good. "Plateau, not pick."
- **Symbol robustness:** the criterion is "works on ≥4 of 6 symbols," NOT "best symbol."
  The SOL cherry-pick of the prior campaign was itself a train-fit; the symbol is not chosen
  to fit train.
- **≤2 frozen candidates** before the test window is touched. No re-optimization after seeing
  test results.

### Success criterion (pro bar — all on the blind test year)

- Test-year PnL > 0 (where SMC failed: −2.1%).
- Profit Factor > 1.2 out of sample.
- MAR (CAGR / MaxDD) > 0.5.
- Holds on ≥4 of 6 symbols.

`≥100%/2y` is explicitly **not** a gate — it is a downstream consequence of a real edge under
compounding, not a target to chase.

## File structure & tasks

| File | Responsibility |
|---|---|
| `src/indicators/technical.js` | +`adx`, +`rsi`, +`slope` |
| `src/indicators/trendPullback.js` | new — `execute()` 4-layer logic + htfRatio toggle |
| `src/core/SignalAdapter.js` | +`fromTrendPullback` + register in `deriveSignal` |
| `src/indicators/index.js` | register `TRENDPULLBACK` in `IndicatorManager` |
| `backtest/run-backtest.js`, `run-matrix.js` | allow logic name + plumb thresholds |
| `tests/test_adx.mjs`, `test_rsi.mjs`, `test_slope.mjs` | reference-value unit tests |
| `tests/test_trend_pullback.mjs` | synthetic uptrend→BUY, chop→HOLD, downtrend→SELL, ratio 1 vs 4 |

### Task order (TDD, one at a time)

1. `Technicals.adx` + test
2. `Technicals.rsi` + test
3. `Technicals.slope` + test
4. `trendPullback.execute` (4 layers, htfRatio toggle) + test
5. `fromTrendPullback` + registration in both switches + test
6. Runners: allow new logic + plumb thresholds
7. Measurement phase: train matrix (1-TF vs 2-TF, threshold grids) → freeze ≤2 → blind test →
   research note

Steps 1–6 are mechanical (pure functions, clear contract). Step 7 is the controller-run
experiment.

## Testing

- New helpers: unit-tested against known reference series (same style as `test_atr.mjs`).
- `trendPullback`: synthetic-candle behavior tests covering each layer and the htfRatio toggle.
- All existing suites stay green (live path untouched).
