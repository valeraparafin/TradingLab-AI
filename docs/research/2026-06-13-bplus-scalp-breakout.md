# B+ Scalp-Breakout Concept-Proof — Result

**Date:** 2026-06-13
**Status:** COMPLETE. **Verdict: 🟡 AMBER** — the candle-only breakout has no positive
after-cost edge on volatile alts. The entire edge (if any) must live in the order book,
testable only forward.
**Type:** measurement scout (same discipline as SMC / HTF / TrendPullback / Donchian).
**Local-only** — not committed (research note).

---

## Frozen protocol (pre-registered, no tuning)

- **Universe:** top-30 alt USDⓈ-M perps by fapi 24h quote volume (ex-stablecoins, ex-majors)
  + 6 majors (BTC/ETH/LTC/SOL/XLM/XRP) as a control group.
- **Rolling daily selection, NO look-ahead:** day D's tradeable shortlist is scored
  (`score.js` rank composite: 0.5·vol + 0.3·mom + 0.2·liq, liquidity floor $20M, top-15)
  from each symbol's **D−1** daily stats. Majors trade ungated (control).
- **Setup (`scalpBreakout`, candle-only):** tested level (≥2 touches within 0.15%), pinch
  consolidation, breakout close beyond level+margin; stop = the broken level (structural).
- **Timeframes:** 5m + 15m.
- **Exit arms:** A = structural stop + TP 2R + no-impulse time-stop (6 bars); B = structural
  stop + channel trailing (10 bars).
- **Costs:** taker 0.06% + slippage 5 bps per side. **Leverage 1.**
- **Windows:** train 2024-06-01→2025-06-01 (descriptive); **test 2025-06-01→2026-06-08 (blind)**.
- **Gate (test year, after costs), per (tf × arm):** (1) PnL > 0; (2) ≥50% of traded alts
  net-positive; (3) beats buy-and-hold; (4) MaxDD ≤ 30%. Control: alts must beat majors.

## Test-year result (blind window)

| tf | arm | alts net-positive | alts avg PnL | beat-BH | alts worst MaxDD | majors avg PnL |
|----|-----|:--:|:--:|:--:|:--:|:--:|
| 5m  | A | **0%**  | **−1.7%** | 18/30 | 4.6% | −4.0% |
| 5m  | B | **10%** | **−1.6%** | 18/30 | 4.9% | −3.7% |
| 15m | A | **17%** | **−0.5%** | 18/30 | 1.6% | −1.2% |
| 15m | B | **20%** | **−0.4%** | 18/30 | 1.4% | −1.0% |

### Four-part gate verdict — FAIL in every cell

1. **PnL > 0 — FAIL.** Every cell's average is negative; at best 20% of alts end positive.
2. **Breadth ≥ 50% — FAIL.** Positive share ranges 0–20%.
3. **Beats buy-and-hold — PASS, but hollow.** 18/30 alts "beat" B&H only because half the
   alt universe crashed in the test year (TRUMP −85%, SUI −76%, 1000PEPE −76%, ADA −76%,
   FIL −70%, ENA −70%) while the breakout sat near-flat. It "won" by not participating —
   and it equally **missed every pump** (BEAT +1356%, LAB +4528%, HU +1615%, VVV +480%
   buy-and-hold, all booked by the strategy as ≈ −0.5%). Not edge — non-participation.
4. **MaxDD ≤ 30% — PASS, but hollow.** Drawdowns are 0–5% only because exposure is tiny and
   trades bleed slowly; it is not a sign of skill.

## What the numbers actually say

- **Zero-edge signal bled by costs.** PnL scales monotonically *negative* with trade count:
  VELVET (4 trades) ≈ −0.0%, SPCX (5) ≈ −0.0% → NEAR (916) −4.6%, SUI (946) −4.1%,
  TAO (870) −4.1%, WLD (874) −3.7%. More breakouts taken = more cost paid, with no
  compensating gross edge. This is the exact signature seen in the earlier SMC-5min finding:
  the candle signal's gross expectancy is ≈ 0, and the round-trip cost turns it negative.
- **Control behaves as the thesis predicts — directionally only.** Alts (−0.4% to −1.7%) are
  consistently *less* negative than majors (−1.0% to −4.0%), and 15m (slower, fewer trades)
  beats 5m. So pump-volatility and a slower clock both help *relative* to majors/scalping —
  but neither lifts the absolute result above zero. The ordering is right; the level is wrong.

## Interpretation (asymmetric, as pre-registered)

- No clean **🔴 red**: the order book — the core of the real ProScalping setup (the "плита")
  — was never tested. A negative candle result cannot disprove the order-book hypothesis.
- This is **🟡 amber**: the candle-observable part of the setup (level + pinch + breakout +
  tight structural stop) is **a lower bound, and that lower bound is ≤ 0 after costs.** So
  whatever edge the manual strategy has, it lives in the part B+ could not see: the order-book
  wall that tells the trader *which* breakouts to take and *which* to skip, and that confirms
  the impulse. On its own the breakout trigger is noise.

### Consequence for the build

- The candle-only path does **not** earn a green light to a candle-only live bot — it would
  lose slowly to fees, exactly as measured.
- The order-book hypothesis is **untested, not refuted.** The only way to test it is a
  **live forward harness** that ingests L2 depth (no free historical depth exists), wraps the
  same `scalpBreakout` setup, and adds an order-book gate (`withOrderBookGate`, mirroring
  `withUniverseGate`/`withHtfGate`) that skips/confirms breakouts by the wall. That is the
  high-risk, forward-only Path A — to be entered with eyes open, on paper first.

## Caveats (restated)

- **Fidelity gap:** B+ takes ALL qualifying breakouts; the trader used the book to skip dense-book
  breakouts and confirm wall-backed ones. B+ therefore has both lower win-rate selection and no
  confirmation — a genuine lower bound, not the full strategy.
- **Survivorship:** the universe is drawn from coins liquid/alive today → mild optimistic bias →
  a non-positive result is therefore *more* conclusive, not less.

## Reproduce

```
node backtest/download-futures-universe.mjs --n 30 --from 2024-06-01 --tfs 5m,15m
node backtest/run-bplus-scout.mjs > backtest/bplus-out.txt
```
Raw per-cell TSV in `backtest/bplus-out.txt` (scratch; not committed). Frozen configs in
`backtest/run-bplus-scout.mjs` (`ARMS`, `WINDOWS`, `COSTS`, `SCORE_OPTS`).
