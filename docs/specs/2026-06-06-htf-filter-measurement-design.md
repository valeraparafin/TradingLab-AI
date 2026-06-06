# HTF Filter Measurement (Dry-Run Analyzer) — Design

**Date:** 2026-06-06
**Status:** Approved (brainstorming) — pending plan
**Author:** iparafin + Claude

## Goal

Before building any higher-timeframe (HTF) trend filter into the live decision path,
**measure** — on existing historical data — how many trades each strategy would lose
if such a filter were applied, broken down by HTF-trend agreement and by PnL. This
de-risks the central failure mode: a naive HTF gate that filters a counter-trend /
scalping ("knife-catching") strategy down to zero trades, or filters out its *winning*
trades.

This spec covers **measurement only**. It changes no live or backtest decision behavior.
The real gate is a separate, later spec, informed by these numbers.

## Motivation (research-grounded)

Industry multi-timeframe practice (see research note) is clear on two points:

1. A HTF trend filter **reduces trade count but raises quality** for *trend-following*
   strategies (SMC, Breakout): the filtered subset is disproportionately the losers.
2. For *counter-trend / mean-reversion / scalp* strategies (Reversal), a rigid
   directional filter is dangerous — those entries are against the immediate move by
   design. The correct approach is **regime-aware** (e.g. ADX): only filter when the
   HTF is genuinely trending; in a range, the filter must be inert.

The exact loss is an **empirical** question per strategy, not a theoretical one. So we
measure first, exactly as Spec 2 measured before/after on `market_data.db`.

## Architecture

**Approach: post-processing of backtest results. Zero changes to the decision path.**

`simulate()` (`src/backtest/simulator.js`) already returns `trades[]`, where each trade
carries `side`, `entryTime`, `entryPrice`, `exitTime`, `exitPrice`, `pnl`. We run the
existing backtest unchanged, then independently classify each trade's `entryTime`
against an HTF trend series derived from the same candles. No edits to `pipeline.js`,
`RiskPolicy.js`, or `simulator.js` → no risk to live or current backtest behavior.

### Components

Two pure helpers (reused later by the real gate — **not** throwaway) + one analyzer.

#### 1. `src/core/aggregateHTF.js` — pure

`aggregateHTF(candles, ratioOrHtfMs)` → HTF candle array.

- Resamples LTF candles into HTF candles: `open` = first, `high` = max, `low` = min,
  `close` = last, `volume` = sum, `time` = bucket-start time.
- **Calendar-aligned**: buckets are keyed by `floor(time / htfMs) * htfMs`, not "every N
  from array start" — so an HTF bar matches what a trader sees on TradingView, not a
  phase-shifted window.
- **Closed bars only**: the final, still-forming HTF bucket is excluded from the output
  (no repaint / look-ahead).
- Determines `htfMs` from `ratio * inferredLtfMs`, where `inferredLtfMs` is the modal
  delta between consecutive LTF candle times (robust to occasional gaps).

#### 2. `src/core/classifyHTFTrend.js` — pure

`classifyHTFTrend(htfCandles, opts)` → `'UP' | 'DOWN' | 'NEUTRAL'`.

Implements **three** trend definitions; the analyzer runs all three side by side:

- **`emaBand`** (method 1): `UP` if `close > EMA*(1+band)`, `DOWN` if
  `close < EMA*(1−band)`, else `NEUTRAL`. The band creates the neutral zone.
- **`emaSlope`** (method 2): direction from EMA slope over `slopeLookback` HTF bars;
  `NEUTRAL` when |slope| < `slopeThreshold` (flat EMA = range).
- **`adxRegime`** (method 3): if `ADX < adxThreshold` → `NEUTRAL` (no trend → gate inert,
  protects scalp). If `ADX ≥ adxThreshold` → direction from the `emaBand` rule.

`NEUTRAL` is the over-filter safeguard: in a range, both sides pass.

**Edge cases:** fewer HTF bars than the required lookback (`emaPeriod`, `adxPeriod`,
`slopeLookback`) → `NEUTRAL` (insufficient data, do not filter). A trade whose
`entryTime` precedes the first closed HTF bar → `NEUTRAL`.

#### 3. `scripts/analyze-htf-filter.js` — analyzer (measurement, not a library)

For each (strategy logicType, symbol, timeframe) cell:

1. Load LTF candles from `market_data.db` (reuse `MarketDataRepo`).
2. Run `simulate()` with the same guardrails the backtest CLI uses → `trades[]`.
3. Build the HTF series via `aggregateHTF(candles, ratio)`.
4. For each trade: find the **last fully-closed** HTF bar — the last bar whose CLOSE
   (`open + bucketWidth`) is `<= entryTime`, NOT merely `open <= entryTime` (keying on
   open-time would let a mid-bucket entry see that bar's own future close — look-ahead); for each of
   the three trend definitions, classify `UP/DOWN/NEUTRAL`; bucket the trade as:
   - `with`    — HTF `UP` & `side==BUY`, or HTF `DOWN` & `side==SELL`
   - `against` — HTF `UP` & `side==SELL`, or HTF `DOWN` & `side==BUY`
   - `neutral` — HTF `NEUTRAL`
5. Tally per bucket: trade count, summed `pnl`, win rate. Print a table per definition.

### Output (illustrative shape)

```
SMC BTCUSDT 1H (HTF=4H, emaBand):
  with    28  PnL +4.12%  WR 61%
  against 14  PnL -2.83%  WR 29%
  neutral  7  PnL +0.31%  WR 43%
  → gate would drop 14/49 (29%), almost all losers. CANDIDATE: enable.

Reversal BTCUSDT 15m (HTF=1H, emaBand):
  with    12  PnL +0.4%
  against 71  PnL +5.2%   ← profitable AND counter-trend
  neutral  9
  → rigid gate drops 71/92 (77%) incl. winners. DO NOT rigid-gate; see adxRegime column.
```

The `adxRegime` column for the same Reversal cell is expected to reclassify most
`against` trades as `neutral` (range regime) → far fewer filtered → demonstrates the
regime-aware path empirically.

## Parameters (analyzer CLI, all with defaults)

- `--ratio` LTF→HTF multiple (default 4; 1H→4H, 15m→1H)
- `--emaPeriod` HTF EMA period (default 50)
- `--band` neutral band fraction for `emaBand` (default 0.005 = 0.5%)
- `--slopeLookback` / `--slopeThreshold` for `emaSlope`
- `--adxPeriod` / `--adxThreshold` for `adxRegime` (defaults 14 / 25)
- standard backtest cell args reused from `backtest/run-backtest.js` (symbol, tf, logic,
  lookback, sl, tp, etc.)

## Testing

- `aggregateHTF`: deterministic unit tests on synthetic candles — calendar alignment
  (bucket boundaries land on `time % htfMs == 0`), closed-bar-only (last partial bucket
  excluded), OHLCV correctness, modal-delta inference with a gap.
- `classifyHTFTrend`: deterministic unit tests per definition — UP/DOWN/NEUTRAL band
  edges, flat-EMA → NEUTRAL, ADX below threshold → NEUTRAL, insufficient data → NEUTRAL.
- `analyze-htf-filter.js`: smoke test on a small in-memory candle+trade fixture asserting
  the with/against/neutral tallies and PnL sums are correct.

## Non-Goals

- No change to live or backtest decisions (the gate is a later spec).
- No new market-data fetching (HTF comes from aggregation of existing LTF candles).
- No per-strategy config wiring (that belongs to the gate spec).

## Output Artifact

A research note appended to `docs/research/` recording the measured tables per strategy,
mirroring the Spec 2 research-note convention, to drive the gate-design decision.
