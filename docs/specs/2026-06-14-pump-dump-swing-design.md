# Post-Pump-Dump Swing — Design Spec

**Date:** 2026-06-14
**Status:** DESIGN — pending user review → writing-plans → implementation.
**Type:** measurement scout (same discipline as SMC / HTF / TrendPullback / Donchian / B+).

## Goal

Measure whether shorting the breakdown of a coin that pumped massively and then rolled over —
and HOLDING the downtrend — has a positive, broad, after-cost edge. This is the ProScalper
trader's biggest weekly winner (a held post-pump-dump short, +$2000, vs +$40–260 scalps). Unlike
the order-book scalp, this hypothesis is **fully backtestable** with existing machinery — no L2
depth required. A clean 🔴 red verdict is therefore possible (and meaningful).

## Why this is a new question (not a repeat of the Donchian scout)

The Donchian scout traded breakouts in BOTH directions on majors with no regime precondition,
and found PF ≈ 1.0. This scout adds the **post-pump-dump precondition** (a coin that ran up then
turned down) and restricts to **shorts only**, on **pumped alts** — a specific regime the prior
scout never isolated. Different precondition, different universe, new question.

---

## Section 1 — Scientific frame

- **What we measure:** does a post-pump-dump short (Donchian breakdown entry + channel trailing
  hold), gated to coins in a post-pump-dump state, have positive after-cost edge on volatile alts.
- **Universe:** the 36 already-downloaded futures symbols (30 alt perps + 6 majors as control).
  The detector itself performs selection — only coins currently in a post-pump-dump state trade.
  Majors are the control, gated by the **identical** detector (unlike B+, the detector here IS the
  whole strategy, so the fair control applies the same gate): majors rarely pump 50%+ then dump, so
  they should rarely trade and net ≈ 0. If majors trade and profit under the same gate, the "edge"
  is an artifact, not a pump effect.
- **Timeframe:** 15m primary; 5m robustness check. Both already in `market_data.db` (no download).
- **Entry:** Donchian lower-channel breakdown → SELL (existing `donchianTrend`). The gate vetoes
  any non-SELL side and any bar not in a post-pump-dump state.
- **Exit:** Donchian channel trailing stop (existing `channelTrailStop` / `stopMode:'channel'`),
  with a **wide** window so a multi-day hold survives 15m noise (default `channelExit=192` ≈ 2 days).
  Stop sits behind the entry structure; no fixed take-profit (let the trend run).
- **Direction:** short only (the trader's thesis: post-pump coins bleed down for a long time).
- **Frozen parameters (pre-registered, NO tuning on test):** `pumpWindow`, `pumpPct`, `dumpPct`,
  Donchian `entryLookback`, `channelExit`. 1–2 sets only (see Section 3), chosen from the
  transcript's logic. A small descriptive sanity-check on TRAIN may inform the freeze; the test
  window is evaluated once.
- **Windows:** train 2024-06-01→2025-06-01 (descriptive); **test 2025-06-01→2026-06-08 (blind)**.
- **Costs:** futures taker 0.06% + slippage 5 bps per side; **leverage 1**.
- **Gate (test year, after costs), per (timeframe × parameter-set):**
  1. PnL > 0
  2. Breadth — ≥ 50% of the alts that actually traded end net-positive
  3. Beats buy-and-hold
  4. MaxDD ≤ 30%
  - **Control:** alts must be stronger than majors.
- **Interpretation:** standard traffic light — 🟢 green (positive & beats majors) → candidate for
  a live forward/paper deployment; 🟡 amber (flat or ≈ majors); **🔴 red is possible and clean**
  here, because the hypothesis is fully backtestable and needs no order book.
- **Survivorship caveat:** the universe is drawn from coins liquid/alive today → mild optimistic
  bias → a negative result is therefore more conclusive.

## Section 2 — Components

| File | Responsibility | New/reuse |
|------|----------------|:--:|
| `src/backtest/pumpDump.js` | **PURE** `isPumpDumpShort(candles, opts)` → `{eligible, peak, preLow, pumpRet, drawdown}`. The only new logic. | new |
| `src/backtest/pumpDumpGate.js` | `withPumpDumpGate(decide, opts)` — veto entry when side ≠ SELL or the current bar is not post-pump-dump eligible. Same pattern as `withHtfGate`. | new (thin) |
| `backtest/run-ppd-scout.mjs` | Sweep: 36 symbols × {15m,5m} × parameter-sets × {train,test}. Per symbol `simulate` with the gate + costs, then 4-part gate + majors control. TSV + summary. | new |
| `tests/test_pump_dump.mjs`, `tests/test_pump_dump_gate.mjs` | Pure-unit tests on fixtures. | new |

**Reused unchanged:** `donchianTrend` (SELL entry), `channelTrailStop` / `stopMode:'channel'`
(trailing hold), `simulator`, `evaluateBar`, `MarketDataRepo`, the 36-symbol dataset.

**Discipline boundary:** detector and gate are pure functions of `ctx.candles` up to the current
bar (no look-ahead, no network). Only the driver touches the DB. All detection/gate logic is
tested deterministically on fixtures.

## Section 3 — `isPumpDumpShort` detector (pure)

Computed on the candles up to the current bar's close, over a trailing window of `pumpWindow`
bars ending at the current bar.

1. **peak** = max high in the window; `peakIdx` = its index.
2. **preLow** = min low over [windowStart … peakIdx] (the base before the peak).
3. **pumpRet** = (peak − preLow) / preLow. **Pump** requires `pumpRet ≥ pumpPct`.
4. **rolledOver** = `peakIdx < currentIdx` — the peak is in the past; price has turned down.
5. **drawdown** = (peak − close) / peak. **Pullback** requires `drawdown ≥ dumpPct`.
6. **eligible** = pumped && rolledOver && pulledBack.

Returns `{ eligible, peak, preLow, pumpRet, drawdown }`. Pure, timeframe-agnostic, uses only
data up to the current bar. Guards: window shorter than `pumpWindow` → `eligible:false`;
`preLow <= 0` or `peak <= 0` → `eligible:false`.

`withPumpDumpGate(decide, opts)` wraps a decide fn: runs the inner decision; if it is a PERMIT
with an order, the gate keeps it only when `result.signal.side === SELL` AND
`isPumpDumpShort(ctx.candles, opts).eligible`; otherwise returns DENY with a reason. Inner DENY /
HOLD pass through unchanged. Mirrors `withHtfGate` / `withUniverseGate`.

### Frozen parameter sets (pre-registered)

- **P1 (base):** `pumpWindow=480` (≈5 days on 15m), `pumpPct=0.50`, `dumpPct=0.15`,
  Donchian `entryLookback=96` (≈1 day), `channelExit=192` (≈2 days).
- **P2 (strict):** `pumpPct=1.00`, `dumpPct=0.20` (only strong pumps); same `pumpWindow`,
  `entryLookback`, `channelExit` as P1.

On 5m the same bar-counts are used (windows are then ~1/3 the wall-clock duration); this is the
robustness check, intentionally not re-tuned.

---

## Out of scope (v1)

Order book / DOM, long side (post-dump bounce), leverage > 1, round numbers, partial entries /
scaling, intraday universe refresh, the discretionary tape-read exit.
