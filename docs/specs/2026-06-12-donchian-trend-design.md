# Donchian Trend-Following Scout — Design (Spec 6)

**Date:** 2026-06-12
**Status:** approved, pre-implementation

## Goal

A clean, **unfitted** yes/no on whether classic Donchian channel-breakout trend-following
has any out-of-sample pulse on our 6 coins, in **both bull and bear** regimes. This is the
one price-based class with a documented multi-decade survival record (time-series momentum;
Moskowitz–Ooi–Pedersen, AQR managed-futures literature) — and the only price approach the
four prior scouts (SMC, Structural Risk, HTF filter, TrendPullback) did **not** test. All
four landed at PF ≈ 1.0 because they were pullback / pattern / mean-reversion entries; pure
trend-following is a structurally different bet and deserves one honest measurement.

## Why this, why now

- Prior scouts proved parameter/stop tuning cannot manufacture an edge on a thin signal
  (PnL campaign verdict). The honest lever is a **different signal class**, not more knobs.
- Trend-following answers the user's explicit "bull AND bear" requirement directly: long on
  upper breakout, short on lower breakout — direction is an output, not an assumption.
- Donchian has the smallest parameter surface of the trend family → least room to fool
  ourselves with multiple-testing.

## Non-goals

- No parameter optimization. No grid search. No symbol selection. (All three were the exact
  traps that produced false winners before.)
- No online/self-learning adaptation — deferred until a confirmed edge exists to refresh.
- No change to the live trading path. `bot_engine.js` stays byte-identical; everything is
  opt-in, default-off, exercised only by the backtest runners.

## Signal logic

A new logic type **`DonchianTrend`**, slotted into the engine exactly like `TrendPullback`:
Technicals → logic `execute` → `SignalAdapter` mapper → `IndicatorManager` registration →
`buildLogicConfig` param threading in the runners.

- **Channel:** highest-high / lowest-low over the last **N** bars, computed on bars *prior to*
  the current bar (no look-ahead — the breakout level is known before the current close).
- **Entry:** close breaks above the N-bar high → **long**; close breaks below the N-bar low →
  **short**.
- **Exit (channel):** close crosses back through the opposite **M**-bar channel → close.
- **Stop (2N):** a **2×ATR** hard stop from entry. Whichever fires first — ATR stop or channel
  exit — closes the trade. The stop defines per-trade risk for sizing *and* caps the
  gap/liquidation tail the channel exit cannot.

ATR is already available (`Technicals.atr`, Wilder, shipped in the PnL campaign). The Donchian
high/low channel is the only new indicator primitive.

## Pre-registered runs (frozen before any result is seen)

Two canonical configs × two timeframes × all 6 symbols. Values are the textbook Turtle
parameters, chosen with **zero degrees of freedom**:

| Config      | Entry N | Exit M | Stop  |
|-------------|---------|--------|-------|
| Turtle-fast | 20      | 10     | 2×ATR |
| Turtle-slow | 55      | 20     | 2×ATR |

- **Timeframes:** 1H and 4H (run side by side — tells us whether timeframe itself decides it).
- **Symbols:** BTCUSDT, ETHUSDT, LTCUSDT, SOLUSDT, XLMUSDT, XRPUSDT (full 2y coverage each).
- **Directions:** long and short, both — non-negotiable for the bull/bear test.

## Sizing & costs

Identical to every prior scout — **fixed-fractional** risk per trade, **no compounding**,
stop distance = the 2×ATR. Same fees + slippage + funding the engine already applies. Sizing
is held constant on purpose: we already learned it amplifies but cannot manufacture an edge,
so we freeze it and let the *signal* speak. No `--sizing compound`, no `pnl_rpt*` inflation.

## Measurement protocol

- **Train window:** 2024-06 → 2025-06. **Test window:** 2025-06 → 2026-06. (Same split as all
  prior scouts; data covers 2024-06-01 → 2026-06-08.)
- The **train run is descriptive only** — nothing is tuned on it. It exists to show the
  in-sample picture for contrast. The verdict comes exclusively from the **blind test year**.
- **Benchmark:** buy-and-hold each symbol over the same window. This is the beta we must beat;
  a long-biased number that trails buy-and-hold is not alpha.

## Success gate (stated up front — cannot move)

A PASS requires **all four**, on the test year:

1. **Test-year PnL > 0** (after costs).
2. **Breadth ≥ 4/6 symbols** positive (not one lucky coin).
3. **Beats buy-and-hold** on the same window.
4. **MaxDD ≤ 30%.**

Anything less is an honest **FAIL**, documented exactly like the prior scouts. We do not
re-optimize to chase a prettier number — that just re-fits the train year.

## Deliverables

1. Engine code: new `DonchianTrend` logic + Donchian channel primitive, opt-in / default-off,
   **live `bot_engine.js` byte-identical**.
2. Unit tests per new piece (channel math, entry/exit/stop logic, adapter mapping, param
   threading), all existing suites staying green.
3. Research note `docs/research/2026-06-12-donchian-trend.md` with train / test / benchmark
   tables per (config × timeframe × symbol) and a plain-language verdict against the gate.

## Components (file responsibilities)

- **Donchian channel primitive** — highest-high / lowest-low over a window, no look-ahead.
  Likely a `Technicals.donchian` helper (mirrors the existing `Technicals.atr` shape).
- **`donchianTrend.execute`** — the logic: channel breakout → side, channel-cross / 2×ATR
  stop → exit. One clear responsibility, testable in isolation.
- **`SignalAdapter` mapper** (`fromDonchianTrend`) — maps logic output to the engine's
  side/entry/SL contract; registered alongside the existing switches.
- **`IndicatorManager`** — register `DonchianTrend` so the runners can select it.
- **Runner param threading** (`buildLogicConfig`) — pass N / M / ATR-mult into `config.logic`
  via the established camelCase path (resolveConfig deep-camelCases `indicators`).

## Risks / honest caveats

- **Small per-symbol sample on 4H** (~4.4k bars, fewer trades). Mitigated by the 6-symbol
  breadth gate — we want consistency across coins, not a big number on one.
- **Whipsaw on 1H** in ranging regimes will likely drag 1H below 4H. That's an expected,
  informative result, not a reason to tune.
- **Trend-following pays in drawdown and patience** — long flat/negative stretches in chop are
  inherent. The MaxDD ≤ 30% gate is the discipline check, not a tuning target.
