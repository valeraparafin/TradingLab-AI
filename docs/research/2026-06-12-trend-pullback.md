# TrendPullback Strategy — Measurement Results

**Date:** 2026-06-12
**Spec:** docs/specs/2026-06-12-trend-pullback-design.md
**Goal:** an intraday trend-continuation logic with an explicit ADX regime gate (the filter
SMC lacked), validated train(2024-06→2025-06)/test(2025-06→2026-06). Pro bar: test-year > 0,
PF > 1.2 out of sample, MAR > 0.5, holds on ≥4/6 symbols.

**Verdict: FAIL at the train stage. No config produced a robust train-year edge, so nothing
qualified to advance to the blind test. Best train config is BTC-only (PF 1.06, +3.1%); the
other five symbols are negative. This is the same thin-edge (~PF 1.0) result as SMC.**

## What shipped (engine — all tested, live untouched)

New backtest logic `TrendPullback` on branch `feat/trend-pullback`:
- `Technicals.rsi`, `.adx`, `.slope` (Wilder; unit-tested 4+3+5 checks).
- `src/indicators/trendPullback.js` — 4 agreement layers (HTF bias EMA+slope, HTF ADX regime
  gate, working-TF pullback-to-EMA + RSI-turn trigger, swing invalidation) with an `htfRatio`
  single/dual-TF toggle (6 checks).
- `fromTrendPullback` SignalAdapter mapper + `TRENDPULLBACK` registered in both switches.
- `buildLogicConfig` threads indicator params from CLI into `config.logic.indicators`.
- Full regression green (27 suites). Live path (`bot_engine.js`) byte-identical — never
  simulates. The code is sound and reusable regardless of the empirical result below.

## Phase 2 — train-year A/B: single-TF vs dual-TF (default params, template percent 3/6 stops, rpt 0.5 compound)

Single-TF (`htfRatio=1`): 0/6 symbols positive. BTC PF 0.78, best XLM PF 0.97. All negative.

Dual-TF (`htfRatio=4`): better but still no edge — 1/6 positive.

| Symbol | PF | NetPnl% | MaxDD% |
|---|---|---|---|
| BTCUSDT | 1.09 | +4.00% | 11.82 |
| XLMUSDT | 0.91 | -5.76% | 16.79 |
| ETHUSDT | 0.89 | -7.40% | 19.01 |
| SOLUSDT | 0.80 | -16.93% | 18.45 |
| LTCUSDT | 0.66 | -21.19% | 22.83 |
| XRPUSDT | 0.66 | -26.86% | 29.99 |

**A/B answer: the HTF bias helps (dual-TF > single-TF on every symbol), but the default config
has no edge.** Dual-TF adopted for the rest of the sweep.

## Phase 3 — train-year parameter sweep (BTC, the strongest symbol)

Stop mode × emaBias × adxMin on BTC train year (dual-TF, rpt 0.5 compound):

| emaBias | adxMin | stop | PF | NetPnl% |
|---|---|---|---|---|
| 100 | 22 | percent | **1.06** | +3.14% |
| 50 | 22 | percent | 1.06 | +2.55% |
| 50 | 22 | structural | 1.05 | +2.09% |
| 100 | 15 | percent | 1.04 | +2.98% |
| 200 | 15 | percent | 1.04 | +1.81% |
| 200 | 22 | percent | 1.03 | +0.68% |
| 100 | 22 | structural | 0.99 | -0.49% |
| 200 | 22 | structural | 0.99 | -0.25% |
| 50 | 15 | structural | 0.92 | -3.33% |
| 200 | 15 | structural | 0.90 | -5.59% |

Observations:
- **The whole surface tops out at PF ~1.06** — a plateau of *break-even*, not of profitability.
  Even the best cell is +3.1% in-sample on the easiest symbol.
- Mild, consistent pattern: percent stops > structural (structural RR=2's wide swing targets
  drop win rate to ~30%); adxMin 22 ≥ 15. But none of this manufactures an edge.
- The earlier one-off "smoke" (BTC PF 1.36, emaBias 50/adxMin 15/structural) was over the FULL
  two years (including the 2025 test-year bull) on a single symbol/config — it does not survive
  disciplined train-year scanning. Classic single-point artifact.

## Phase 4 — breadth of the best train config (NOT a blind test)

Best train config (emaBias 100, adxMin 22, percent 3/6, dual-TF) across all six, train year:

| Symbol | PF | NetPnl% |
|---|---|---|
| BTCUSDT | 1.06 | +3.14% |
| ETHUSDT | 0.93 | -5.39% |
| XRPUSDT | 0.80 | -19.05% |
| SOLUSDT | 0.80 | -19.42% |
| XLMUSDT | 0.74 | -20.19% |
| LTCUSDT | 0.55 | -33.44% |

**1/6 positive on the train year.** Breadth fails decisively, and it fails on the *training*
data — so there is no honest candidate to freeze and carry into the blind test. Running the
test year on BTC alone would be cherry-picking the single symbol that printed +3%, against the
explicit ≥4/6 breadth rule. Stopped here.

### Verdict against the criterion (§ spec)
- Holds on ≥4/6 symbols? **NO** — 1/6 on the train year.
- Train-year edge worth blind-testing? **NO** — best PF 1.06 (~break-even).
- Test-year / PF>1.2 / MAR>0.5 → **not evaluated**; no candidate qualified.

## Why it failed (the finding)

1. **The regime gate fixed the right problem but the entry has no edge.** ADX did cut chop
   trades and dual-TF bias did help (every symbol improved single→dual). But filtering a
   zero-expectancy entry more cleanly still leaves zero expectancy — it just trades less.
2. **The pullback-to-EMA + RSI-turn trigger is not predictive on 1H crypto across symbols.**
   Win rate sits ~30–38%; with a ~2R target that is sub-break-even. BTC squeaks over 1.0 on the
   train bull; the higher-beta alts (LTC/SOL/XLM/XRP) bleed — the trigger catches falling knives
   on their sharper retraces.
3. **Same lesson as SMC and the HTF measurement:** mechanical TA confluence on this data tops
   out near PF 1.0 out of (and even in) sample. The edge is not in the indicator stack.

## Recommendation

Two mechanical-TA strategies (SMC, TrendPullback) and one filter study (HTF) have now all
landed at PF ≈ 1.0. The consistent signal: **a genuine edge on this data is unlikely to come
from another indicator combination.** Do not sweep TrendPullback further to find a lucky
symbol/config — that re-fits noise. If the ≥100%/2y ambition is still live, the next honest
swing is a *different kind* of signal (e.g. cross-sectional momentum ranking across the 6
coins, or a non-price feature like funding/basis), each as its own spec → measure → blind-test
cycle. Otherwise, accept that the current toolset is a ~PF-1.0 / low-double-digit instrument
and stop spending on entry-indicator search.
