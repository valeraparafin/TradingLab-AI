# B+ — ProScalping Breakout Concept-Proof (minus order book)

**Date:** 2026-06-13
**Status:** DESIGN — pending user review → writing-plans → implementation.
**Type:** measurement scout (same discipline as SMC / HTF / TrendPullback / Donchian scouts).

## Goal

Prove (or disprove) whether the ProScalping breakout setup — replicated on candles, WITHOUT
the order book but WITH every candle-observable rule — produces a positive, broad, after-cost
edge on volatile alts. This is the cheap gate before committing to the heavy live-forward
order-book build. It CANNOT test the order book (no historical L2 depth); interpretation is
therefore asymmetric (see below).

## Why this is not a repeat of the Donchian/Breakout scouts

Prior scouts traded **6 majors**. Majors do not pump +1000–6000% and rarely produce the clean
impulsive flag-breakouts ProScalping trades. The whole thesis is that the edge lives in the
**volatility of pumped low-cap alts**, which we have never tested. Different universe, new
question.

---

## Section 1 — Scientific frame

- **What we measure:** does `scalpBreakout` (minus order book) have positive after-cost edge on
  volatile alts.
- **Universe:** ~30 alt perps (top by fapi 24h quote volume, ex-stablecoins) + the 6 existing
  majors as a **control group**.
- **Rolling daily selection, NO look-ahead:** `score.js` ranks the universe using daily stats
  computed over a trailing window **up to day D−1**; the resulting shortlist is tradeable on
  day D only.
- **Timeframe:** 5m primary; 15m robustness check.
- **Exit (swept dimension, two arms):**
  - **Arm A** — stop behind level (structural) + TP 2R + fast breakeven/time-stop: if no
    impulse within N bars, flatten at breakeven (models his "вкат" cut).
  - **Arm B** — trailing exit (tests the transcript's recurring "could have taken more").
- **Windows:** train (2024-06-01→2025-06-01, descriptive only) / test
  (2025-06-01→2026-06-08, blind — gate evaluated here only).
- **Costs:** futures taker 0.06% + slippage 5 bps per side; **leverage 1** (edge first).
- **Gate (test year, after costs), per (timeframe × exit-arm):**
  1. PnL > 0
  2. Breadth — ≥ 50% of the alts that actually traded end net-positive
  3. Beats buy-and-hold
  4. MaxDD ≤ cap (30%)
  - **Control:** majors must be weaker than alts; if majors ≈ alts, the "edge" is an artifact,
    not a pump-volatility effect.
- **Asymmetric interpretation:** 🟢 alts positive → build the live forward harness (A, with
  order book); 🟡 flat → the entire edge must come from the order book (forward-only, high
  risk); no clean 🔴 — a negative candle result does not kill the order-book hypothesis.
- **Survivorship caveat:** the universe is drawn from coins liquid/alive today → mild optimistic
  bias → a negative result is therefore even more conclusive.

## Section 2 — Components

| File | Responsibility | New/reuse |
|------|----------------|:--:|
| `src/data/marketParse.js` | Parametrize candle base: spot `api/v3` ↔ futures `fapi/v1`. | edit (reuse) |
| `backtest/download-futures-universe.mjs` | 1 fapi `/ticker/24hr` call → top ~30 alt perps (ex-stables) + 6 majors; download 5m+15m klines via existing `downloadCandles`+`verifyCandles` into `market_data.db`. | new (thin) |
| `src/screener/score.js` | **PURE** rank composite selection. Shared with the screener spec. | new (shared) |
| `src/backtest/historicalUniverse.js` | **PURE**: derive daily stats (range%, %change, quoteVol) from candles; for day D use the window up to D−1; run `score.js` → daily picks. No look-ahead. | new |
| `src/indicators/scalpBreakout.js` | **PURE** setup (see Section 3). Returns `{side, invalidation, level, touches}`. | new |
| `src/backtest/universeGate.js` | `withUniverseGate(evaluateBar, picksByDay)` — veto entry when symbol not in that day's picks. Same pattern as `withHtfGate`. | new (thin) |
| `src/backtest/simulator.js` | Arm A: add time-stop (no impulse within N bars → breakeven exit). Arm B: trailing — reuse `channelTrailStop`. | edit (reuse) |
| `backtest/run-bplus-scout.mjs` | Sweep: universe × {5m,15m} × {arm A, arm B} × {train,test}. Per symbol `simulate` with `universeGate` + costs, then 4-part gate + majors control. TSV + summary. | new |
| `tests/test_historical_universe.mjs`, `test_scalp_breakout.mjs`, `test_universe_gate.mjs`, `test_time_stop.mjs` | Pure-unit tests on fixtures. | new |

**Key reuses:** (1) `universeGate` is a decorator over `evaluateBar`, exactly like `withHtfGate`
— the rolling universe is modeled without rewriting the simulator. (2) `score.js` is the same
pure module for the live screener and historical selection; the screener's core is built here.

**Discipline boundary:** selection, setup, and gate are pure functions; network only in the
downloader. All scoring/setup/gate logic is tested deterministically on fixtures, no network.

## Section 3 — `scalpBreakout` setup (pure)

Computed on the setup-TF candles up to the current bar's close; entry fills next bar open.
All parameters are config with defaults.

1. **Level.** Over `lookback` bars (default 30 on 5m, excluding current):
   - resistance = max high; count bars whose high is within `touchTol` (0.15%) of it.
   - support = min low; same.
   - A level qualifies if touches ≥ `minTouches` (2). This is his "cluster of local highs/lows."
2. **Pinch (consolidation).** Last `pinchBars` (6) bars hug the level: their band ≤ `pinchTol`,
   AND contraction — ATR of last `pinchBars` ≤ `pinchRatio` (0.7) × ATR of the prior window.
   Filters the "too sharp" entries he flags as risky.
3. **Round number (optional confluence).** Level within `roundTol` of a round-number grid.
   Toggle `requireRound` (default off) — confluence, not always mandatory; swept later to keep
   degrees of freedom low.
4. **Breakout trigger.**
   - close > resistance·(1 + `breakoutMargin` 0.05%) → **BUY**;
   - close < support·(1 − `breakoutMargin`) → **SELL**.
5. **Invalidation = the broken level.** For BUY the stop sits just behind resistance
   (entry→level = tight risk) — his "стоп за уровень." Fed into `RiskPolicy` structural mode
   (already exists from Spec 2).

Returns `{ side, invalidation, level, touches }`.

### Fidelity gap (must stay explicit)

Without the order book, `scalpBreakout` takes ALL qualifying breakouts. He used the book to
SKIP some ("dense book above → no impulse") and CONFIRM others (wall below). So B+ takes
breakouts he would skip and lacks the confirmation that raised his win rate. **B+ is therefore
a lower bound** — "what the breakout gives on its own." Positive on alts → the book only adds
(🟢). Flat → the edge is entirely in the book, testable only forward (🟡).

---

## Out of scope (v1)

Order book / DOM, tick data, live execution, leverage > 1, intraday universe refresh,
round-number requirement (toggle off), the discretionary overnight pump-and-dump swing.
