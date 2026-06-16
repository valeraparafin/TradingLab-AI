# RangeFilter (VMC Swing) — Backtest Validation

**Date:** 2026-06-16
**Branch:** `feat/trading-agent-ai-flow`
**Plan:** [docs/plans/2026-06-16-range-filter-strategy.md](../plans/2026-06-16-range-filter-strategy.md) — Task 9
**Tooling:** `backtest/run-backtest.js` against `market_data.db`; runs persisted to `backtest.db` under group `rf_validation`.

---

## TL;DR

The RangeFilter logic type is correctly wired into the backtest pipeline (`--logic RangeFilter`
dispatches, generates signals, and trades). On BTCUSDT the **fixed-TP** variant is roughly
break-even-to-slightly-positive after costs: best observed was **+2.70% over ~2 years on 1H**
(PF 1.09) — not a strong edge.

**UPDATE 2026-06-16 (signal-exit wired into the backtest shell):** `exit_mode` is now threaded
from the logic template through `run-backtest.js` → `simulate` → `src/backtest/simulator.js`, which
has a stop-and-reverse branch mirroring the live engine (`resolveSignalExit`/`signalStateSide`):
close on opposite state flip, no take-profit, SL as a protective floor, re-enter on the current
state. **The "no profit cap on trends" hypothesis is now testable — and it does NOT hold on BTC.**
Stop-and-reverse performs strictly *worse* than the fixed-TP baseline on both 1H (−10.93% vs +2.70%)
and 4H (−2.75% vs +1.51%): the always-in-market reversal bleeds through whipsaw, and the fixed TP
was actually *helping* by banking winners before mean-reversion. See "Signal-exit runs" below.

**UPDATE 2026-06-16 (ADX regime gate — the whipsaw *was* the problem, and it's filterable):**
The signal-exit refutation above used `multiplier 3.5` (the TradingView default, a known dead zone)
and *no entry filter*. Re-running at `multiplier 5` with an **ADX entry gate** (only enter when ADX
on the decision window clears a threshold) flips the conclusion: the RangeFilter signal edge is a
**trend-regime phenomenon**. Gating out low-ADX (chop) flips converts a break-even/negative
stop-and-reverse into a modestly positive one. On **36 symbols / 15m** the gate lifts avg return
from +0.4% (no gate) to **+5.9% at ADX≥40**, median PF 0.96→1.05, halves drawdown (19%→10%), and
raises the share of profitable symbols 47%→64% — over a 6–13k-trade pool (the small-sample worry is
resolved). On **6 symbols / 1H** the gate lifts PF 1.11→**1.25** and profitable-symbol share 67%→83%
at ADX≥30. The optimal threshold is timeframe-dependent (lower TF ⇒ higher ADX bar). See "ADX regime
gate" below. **This is the first standalone after-cost edge found for RangeFilter signal mode** — still
modest (PF ~1.05–1.3) and in-sample on one 2024–2026 window, but robust across a plateau of thresholds
and the whole symbol universe.

---

## ADX regime gate (2026-06-16 update — the trend-regime filter)

Hypothesis: RangeFilter flips cluster in two regimes — whipsaw chop (low ADX, negative expectancy
after costs) and genuine trends (high ADX, where the uncapped winner lives). An ADX entry gate should
prune the chop and keep the trend. Implemented as `simulate({ regimeGate: { adxMin, adxPeriod } })`
(opt-in; in signal mode only, an entry is admitted only when `Technicals.adx` on the same decision
window the indicator state used clears `adxMin`). CLI: `--adxGate <n> [--adxPeriod 14]`. Tested in
[tests/test_simulator_regime_gate.js](../../tests/test_simulator_regime_gate.js). Sweeps run via
[backtest/sweep-adx-gate.js](../../backtest/sweep-adx-gate.js) (in-process; signal mode, multiplier 5,
period 20, sl 0.08, default costs taker 0.06% / slippage 5bps).

**15m — all 36 symbols** (large pool; the small-sample concern):

| adxMin | symbols | avg net% | median PF | win% | avg DD% | trades | % positive |
|--------|---------|----------|-----------|------|---------|--------|------------|
| 0 (none) | 36 | +0.36 | 0.96 | 33.8 | 19.2 | 23344 | 47% |
| 20 | 36 | −0.45 | 0.94 | 33.5 | 19.0 | 22726 | 39% |
| 25 | 36 | +1.17 | 0.93 | 32.6 | 17.8 | 20613 | 42% |
| 30 | 36 | +3.04 | 0.99 | 32.3 | 15.3 | 16949 | 53% |
| 35 | 36 | +4.20 | 1.02 | 32.4 | 12.8 | 12835 | 58% |
| **40** | 36 | **+5.86** | 1.05 | 34.2 | 9.6 | 9113 | 64% |
| 45 | 36 | +4.76 | 1.08 | 33.9 | 8.5 | 6147 | 67% |
| 50 | 36 | +2.11 | 1.04 | 32.3 | 7.5 | 3926 | 58% |

**1H — 6 symbols** (where a fixed-TP edge already existed):

| adxMin | symbols | avg net% | median PF | win% | avg DD% | trades | % positive |
|--------|---------|----------|-----------|------|---------|--------|------------|
| 0 (none) | 6 | +9.32 | 1.11 | 37.3 | 11.0 | 1403 | 67% |
| 25 | 6 | +10.79 | 1.12 | 36.5 | 9.9 | 1251 | 67% |
| **30** | 6 | **+11.09** | 1.25 | 37.3 | 8.4 | 1044 | 83% |
| 40 | 6 | +4.83 | 1.19 | 35.4 | 8.4 | 616 | 83% |
| 50 | 6 | +4.53 | 1.30 | 36.7 | 6.7 | 260 | 67% |

**Reading:**
- **Monotonic, plateau-shaped, not a spike.** On 15m, net% rises smoothly 20→40 then decays
  (over-filtering past the peak starves trade count); PF and %-positive keep climbing monotonically
  through 45. The whole 35–45 band is consistently positive — a robust plateau, which de-risks the
  parameter-overfit worry.
- **Win rate barely moves (~33%).** The gain is entirely in cutting loser frequency/size: drawdown
  roughly halves and PF crosses 1.0. Consistent with a trend follower that takes many small losses
  and a few large wins — the gate removes the small losses born in chop.
- **Optimal threshold is timeframe-dependent** (15m→40, 1H→30): lower timeframes carry more noise, so
  they need a higher ADX bar to isolate a real trend.
- **The dip at adxMin=20** (below the no-gate row) shows a *weak* gate slightly hurts — it trims a few
  decent trades without removing enough chop. The signal is real only at strong thresholds (≥30).

### Out-of-sample check (temporal split — is the gate curve-fit?)

The single-window sweeps above pick a threshold using all of 2024–2026, so they cannot rule out
*temporal* overfit. Split each symbol's history by time (train = first 60%, test = last 40%), run the
threshold on both, and compare. Harness: [backtest/oos-adx-gate.js](../../backtest/oos-adx-gate.js).

**15m — 36 symbols** (TRAIN net% / PF / %pos / trades  ||  TEST net% / PF / %pos / trades):

| adxMin | TRAIN | TEST |
|--------|-------|------|
| 0 (none) | −2.49 / 0.94 / 39% / 13627 | +3.00 / 0.93 / 47% / 9614 |
| 30 | +0.32 / 0.95 / 36% / 9841 | +2.80 / 0.94 / 50% / 7024 |
| **40** | +2.37 / 1.04 / 53% / 5271 | +3.53 / 1.04 / 56% / 3793 |
| 45 | +1.44 / 1.04 / 56% / 3575 | +3.43 / 1.15 / 74% / 2542 |

**1H — 6 symbols:**

| adxMin | TRAIN | TEST |
|--------|-------|------|
| 0 (none) | +8.80 / 1.15 / 83% / 826 | +0.31 / 1.04 / 67% / 558 |
| 25 | +9.72 / 1.14 / 67% / 745 | +0.96 / 1.06 / 83% / 488 |
| **30** | +9.36 / 1.24 / 83% / 617 | +2.00 / 1.19 / 67% / 407 |
| 40 | +4.88 / 1.35 / 67% / 370 | +0.12 / 1.00 / 50% / 234 |

**The gate generalizes — it is not a temporal curve-fit:**
- On 15m the train-best threshold (ADX≥40, PF 1.04) reproduces *exactly* on the held-out test (PF
  1.04), and the 40–45 band stays PF>1 in both segments. The ungated baseline is PF<1 in **both** train
  (0.94) and test (0.93) — ungated RangeFilter signal mode is a loser on 15m regardless of window; the
  gate is what crosses break-even, and that holds out-of-sample.
- On 1H the train-best by PF (ADX≥30, PF 1.24) is also the test winner (PF 1.19, +2.0%), and clearly
  beats the ungated test row (PF 1.04, +0.31%). Without the gate the 1H edge largely evaporates on test
  (net 8.80%→0.31%); with it, it persists.
- **PF, not raw net%, is the stable cross-window signal.** Absolute returns differ a lot between
  segments (the test window happened to be friendlier on 15m, harsher on 1H) — expected, since net% is
  regime-dependent and the windows are unequal length. PF and %-positive carry across; net% does not.

**Bottom line:** the ADX regime gate is a *real, generalizing, but modest* edge (PF ~1.04–1.19 OOS).
It is suitable as an entry **filter/component** for RangeFilter signal mode — not a standalone money
printer. At PF ~1.04 on 15m it is thin enough to be sensitive to the cost model; the 1H/ADX≥30 cell
(PF 1.19 OOS) is the more comfortable operating point.

### Stacking the HTF trend gate (does direction-alignment add to the ADX regime gate?)

The simulator also supports an opt-in HTF emaBand gate on signal entries (`simulate({ htfGate: {ratio,
emaPeriod, band} })`, same against-trend-denied semantics as
[src/backtest/htfGate.js](../../src/backtest/htfGate.js); tested in
[tests/test_simulator_htf_gate.js](../../tests/test_simulator_htf_gate.js)). Compared four stacks on
the train/test split via [backtest/stack-filters.js](../../backtest/stack-filters.js) (htf ratio 4,
emaPeriod 50, band 0.005):

**1H — 6 symbols** (adx≥30):

| filter | TRAIN net/PF/%pos | TEST net/PF/%pos |
|--------|-------------------|------------------|
| none | +8.80 / 1.15 / 83% | +0.31 / 1.04 / 67% |
| **adx≥30** | +9.36 / 1.24 / 83% | **+2.00 / 1.19 / 67%** |
| htf only | +7.89 / 1.12 / 67% | −0.89 / 0.95 / 33% |
| adx+htf | +7.93 / 1.23 / 67% | +0.60 / 1.02 / 67% |

**15m — 36 symbols** (adx≥40):

| filter | TRAIN net/PF/%pos | TEST net/PF/%pos |
|--------|-------------------|------------------|
| none | −2.49 / 0.94 / 39% | +3.00 / 0.93 / 47% |
| **adx≥40** | +2.37 / 1.04 / 53% | +3.53 / 1.04 / 56% |
| htf only | −0.69 / 0.99 / 44% | +2.90 / 0.91 / 47% |
| adx+htf | +2.62 / 1.07 / 61% | +3.34 / 1.06 / 53% |

**The HTF direction gate is the wrong filter for this strategy — ADX alone wins:**
- **HTF-only hurts.** It is PF<1 out-of-sample on both timeframes (1H 0.95, 15m 0.91), worse than even
  the ungated baseline. It blocks exactly the counter-trend flips (longs as a downtrend exhausts) that
  become the strategy's biggest winners on the reversal.
- **Stacking HTF onto ADX does not reliably help.** On 1H it drags the ADX edge down (test PF 1.19→1.02);
  on 15m it is a wash (1.04→1.06, within noise, and %-positive/net are mixed). No consistent additive
  benefit across timeframes.
- **Trend *strength* (ADX), not trend *direction* (HTF), is what isolates the edge.** ADX keeps the
  high-conviction moves regardless of higher-timeframe direction; the directional gate throws away the
  reversal-catching half of the signal. **Recommended config stays ADX-only (1H / ADX≥30).**

### Universe selection (hypothesis #3 — does the edge live in a selectable subset?)

ADX-only (mult 5, 15m, 36 symbols), train/test split. For each symbol: train-measured liquidity
(median daily quote volume) and volatility (median daily range), train PF, and test PF. Harness:
[backtest/universe-select.js](../../backtest/universe-select.js). Correlations with **test** PF:

| predictor (train-measured) | corr → test PF |
|----------------------------|----------------|
| train PF (edge persistence) | +0.32 |
| liquidity | **−0.31** |
| volatility | +0.25 |

Bucketed test performance (split by train characteristic, ~18 symbols/bucket):

| split by | high half (test) | low half (test) |
|----------|------------------|-----------------|
| liquidity | medPF 0.99 / +0.6% / 44% pos | **medPF 1.22 / +6.5% / 67% pos** |
| volatility | **medPF 1.22 / +5.5% / 61% pos** | medPF 1.02 / +1.6% / 50% pos |
| train PF | medPF 1.02 / +1.6% / 56% pos | medPF 1.14 / +5.4% / 56% pos |

Selecting symbols by *train profitability* and measuring test:

| selected on train | test result |
|-------------------|-------------|
| PF > 1 (n=19) | medPF 0.99 / +1.5% / 53% pos |
| PF ≤ 1 (n=17) | medPF 1.18 / +5.8% / 59% pos |

**Two findings:**
- **Performance-chasing backfires.** Train PF predicts test PF only weakly (+0.32), and the
  train-profitable bucket actually *underperforms* the train-losing bucket out-of-sample (test medPF
  0.99 vs 1.18). Edge mean-reverts at the symbol level — picking last period's winners is worse than
  useless here. No symbol allow-list based on past returns.
- **A structural characteristic does separate the edge: it lives in the *less liquid, more volatile*
  names, not the majors.** Low-liquidity half test medPF 1.22 / 67% positive vs high-liquidity 0.99 /
  44%; high-volatility half 1.22 / 61% vs low 1.02. RangeFilter is a trend catcher, and smaller alts
  trend more cleanly while majors mean-revert efficiently enough to erase the edge. A liquidity/vol
  *band* filter is a viable ex-ante universe gate (lifts portfolio PF ~1.04 → ~1.22 on test).

**Caveat that matters:** the edge concentrates exactly where execution is most expensive — in illiquid
alts, real slippage far exceeds the 5 bps modeled, so the low-liquidity bucket's PF is *overstated*.

**Slippage stress test (25 bps, 5× base):** the structural direction is *robust to costs and actually
sharpens* — liquidity→testPF −0.31→−0.44, volatility→testPF +0.25→+0.39. Low-liquidity (medPF 1.04 vs
high 0.73) and high-volatility (1.07 vs low 0.68) buckets still separate cleanly. **But the absolute
edge is thin and cost-sensitive:** at 25 bps even the best bucket is only PF ~1.05 (near break-even),
and the full universe goes negative. The liquidity vs volatility selectors pull in opposite execution
directions — low-liquidity has the strongest edge but the worst fills, so it is a trap to trade
directly. **Volatility is the safer ex-ante selector:** it captures the same trending-names edge
(test PF 1.07 even at 25 bps) without selecting purely for bad execution, since a name can be
high-volatility *and* adequately liquid. **Refined recommendation: universe-gate by volatility with a
liquidity floor** (exclude the truly illiquid to keep fills sane), not by liquidity directly.

## What the backtest engine actually honors re: `exit_mode`

> **Superseded by the 2026-06-16 update.** The three bullets below described the state *before*
> `exit_mode` was wired into the backtest shell. They are kept for context. As of the update:
> `run-backtest.js` resolves `exit_mode` from the matching logic template (`resolveExitMode`, or a
> `--exitMode` override) and threads it via `config.logic.exit_mode`; `simulator.js` recomputes the
> indicator's persistent state per bar and, in signal mode, closes on an opposite flip, suppresses
> TP, keeps SL as a protective floor, and re-enters on the current state (stop-and-reverse).

Verified by reading the code, not assumed (pre-update state):

- **`src/core/pipeline.js` `evaluateBar`** is a pure per-bar decision function:
  candles → `IndicatorManager.calculate` → `deriveSignal` → `RiskPolicy.evaluate`. It produces an
  entry signal + a risk decision per bar. It has **no position state and never reads `exit_mode`**.
- **`backtest/run-backtest.js`** passes `--logic` straight through as `logicType` (uppercased in
  `IndicatorManager.calculate`), so `--logic RangeFilter` dispatches correctly. It builds guardrails
  from CLI flags (`buildGuardrails`) — `stopLossPct`, `takeProfitPct`, etc. It does **not** read the
  logic template's `exit_mode` at all.
- **`src/backtest/simulator.js`** manages exits via fixed SL/TP from the guardrails, plus an optional
  `exitPolicy` object (`breakevenR`, `channelExit`, `timeStopBars`). There is **no `exit_mode` /
  stop-and-reverse / signal-flip exit branch** in the simulator.

**Conclusion:** the backtest exercises **flip-entry + fixed SL/TP exits only**. The stop-and-reverse
signal exit (close on opposite RangeFilter state flip, no profit cap) is implemented exclusively in the
live engine and is **not** reproducible in the current backtest shell.

---

## Runs

All runs: BTCUSDT, equity $200, riskPerTrade 0.10 (fixed-notional sizing — absolute PnL is roughly
linear in trade count; see `backtest/README.md` sizing caveat), spot (leverage 1x), default costs
(taker ~0.06%, slippage 5 bps). RangeFilter indicator defaults (period 20, multiplier 3.5).

| # | run id | tf | SL | TP | minRR | Trades (W/L) | Win% | PF | Net PnL | Net % | MaxDD | Sharpe |
|---|--------|----|----|----|-------|--------------|------|----|---------|-------|-------|--------|
| 1 | 579 | 4H | 0.08 | 0.16 | 1.5 (def) | 21 (7/14) | 33.3% | 0.96 | -0.81 | **-0.40%** | 6.21% | -0.03 |
| 2 | 580 | 4H | 0.03 | 0.06 | 1.5 | 32 (13/19) | 40.6% | 1.25 | +3.02 | **+1.51%** | 1.78% | 0.46 |
| 3 | 581 | 1H | 0.03 | 0.06 | 1.5 | 139 (52/87) | 37.4% | 1.09 | +5.40 | **+2.70%** | 4.74% | 0.41 |

Commands:

```powershell
# Run 1 — wide SL/TP (closest available proxy to "let trends run"; still a fixed 2:1 TP cap)
node backtest/run-backtest.js --symbol BTCUSDT --tf 4H --logic RangeFilter `
  --equity 200 --riskPerTrade 0.10 --sl 0.08 --tp 0.16 --group rf_validation

# Run 2 — fixed 1:2 control, 4H
node backtest/run-backtest.js --symbol BTCUSDT --tf 4H --logic RangeFilter `
  --equity 200 --riskPerTrade 0.10 --sl 0.03 --tp 0.06 --minRR 1.5 --group rf_validation

# Run 3 — fixed 1:2 control, 1H (more samples)
node backtest/run-backtest.js --symbol BTCUSDT --tf 1H --logic RangeFilter `
  --equity 200 --riskPerTrade 0.10 --sl 0.03 --tp 0.06 --minRR 1.5 --group rf_validation
```

> Note on the "primary" run (#1): the plan envisioned an SL-only, no-fixed-TP run to approximate the
> signal-exit "no profit cap" idea. The pipeline always applies a TP (default 0.04), so a true no-TP
> run is not possible without backtest-shell changes. Run #1 uses a wide SL (8%) with a wide 2:1 TP
> (16%) as the closest available proxy. It is **not** a faithful signal-exit test — it still caps
> winners at +16% and never reverses on a state flip.

---

## Signal-exit runs (2026-06-16 update — stop-and-reverse, no profit cap)

Same account/cost setup (BTCUSDT, equity $200, riskPerTrade 0.10, spot, default costs, indicator
defaults period 20 / multiplier 3.5). Signal-exit runs use `exit_mode=signal` (resolved from
`templates/logic/range_filter.json`) with `--sl 0.08` as the protective floor and **no TP**. The
fixed-TP controls (runs 7–8) re-run the prior `sl_tp` cells under the new code — they reproduce
runs 2–3 **exactly**, confirming the `sl_tp` path is byte-identical (no regression).

| # | run id | mode | tf | SL | TP | Trades (W/L) | Win% | PF | Net PnL | Net % | MaxDD | Sharpe |
|---|--------|------|----|----|----|--------------|------|----|---------|-------|-------|--------|
| 4 | 583 | **signal** | 1H | 0.08 | — | 415 (140/275) | 33.7% | 0.79 | -21.86 | **-10.93%** | 15.20% | -1.14 |
| 5 | 584 | **signal** | 4H | 0.08 | — | 103 (40/63) | 38.8% | 0.82 | -5.49 | **-2.75%** | 9.52% | -0.29 |
| 7 | 585 | sl_tp | 1H | 0.03 | 0.06 | 139 (52/87) | 37.4% | 1.09 | +5.40 | **+2.70%** | 4.74% | 0.41 |
| 8 | 586 | sl_tp | 4H | 0.03 | 0.06 | 32 (13/19) | 40.6% | 1.25 | +3.02 | **+1.51%** | 1.78% | 0.46 |

Commands:

```powershell
# Signal-exit (stop-and-reverse, no TP). exit_mode resolved from the logic template.
node backtest/run-backtest.js --symbol BTCUSDT --tf 1H --logic RangeFilter `
  --equity 200 --riskPerTrade 0.10 --sl 0.08 --group rf_signal_exit
node backtest/run-backtest.js --symbol BTCUSDT --tf 4H --logic RangeFilter `
  --equity 200 --riskPerTrade 0.10 --sl 0.08 --group rf_signal_exit

# Fixed-TP control under the new code (forces sl_tp via --exitMode; reproduces runs 2-3 exactly).
node backtest/run-backtest.js --symbol BTCUSDT --tf 1H --logic RangeFilter `
  --equity 200 --riskPerTrade 0.10 --sl 0.03 --tp 0.06 --exitMode sl_tp --group rf_control
node backtest/run-backtest.js --symbol BTCUSDT --tf 4H --logic RangeFilter `
  --equity 200 --riskPerTrade 0.10 --sl 0.03 --tp 0.06 --exitMode sl_tp --group rf_control
```

**Signal-exit vs fixed-TP (apples-to-apples, same symbol/tf):**

| tf | signal Net% / PF / MaxDD | fixed-TP Net% / PF / MaxDD | winner |
|----|--------------------------|----------------------------|--------|
| 1H | -10.93% / 0.79 / 15.2% | +2.70% / 1.09 / 4.7% | **fixed-TP** |
| 4H | -2.75% / 0.82 / 9.5% | +1.51% / 1.25 / 1.8% | **fixed-TP** |

The signal-exit count (~415 on 1H) matches the ~416 RangeFilter state flips over the window — i.e.
the strategy is essentially always in the market, reversing on every flip. That is exactly the
behavior the live engine ships with, now faithfully reproduced offline.

## Reading the results

- **No strong after-cost edge on BTC.** PF ranges 0.96–1.25; net return is between -0.4% and +2.7%
  over ~2 years. The tighter fixed-TP configs (runs 2 & 3) edge out the wide-stop config (run 1),
  which is the opposite of what the "let trends run" thesis predicts — but run 1 is a poor proxy
  (capped TP, no reversal), so this comparison is **not** a real test of the signal-exit hypothesis.
- **Low win rate, PF > 1 driven by winner size** (runs 2 & 3) — consistent with a trend-following
  filter that takes many small losses and a few larger wins. This is the shape the signal-exit mode is
  designed to amplify (uncapped winners), which is exactly what the backtest cannot test.
- **Drawdowns are modest** (1.8–6.2%) at this sizing.

## Verdict

> **Amended by the ADX-regime-gate update (see top of doc).** The refutation below stands *only* for
> the naive configuration it tested: `multiplier 3.5` (dead zone), no entry filter, BTC only. With
> `multiplier 5` **plus an ADX regime gate**, signal mode has a real (if modest) after-cost edge
> across 36 symbols — the whipsaw the verdict blames is filterable, not fatal. Read the two together.

**The "no profit cap on trends" hypothesis is refuted on BTC.** With `exit_mode` now wired into the
backtest shell, the stop-and-reverse signal-exit can be tested directly — and it loses to the
fixed-TP baseline on both timeframes (1H: −10.93% vs +2.70%; 4H: −2.75% vs +1.51%), with PF < 1 and
roughly 3× the drawdown. Intuition for *why*: BTC on these TFs mean-reverts often enough that letting
every trade run until the opposite flip gives back the open profit, while the fixed TP banks it. The
RangeFilter flips ~416 times over the window, so signal mode is almost always in the market and pays
the whipsaw in full. The indicator + flip mechanics are sound; the *exit policy* is the problem.

Neither variant shows a compelling standalone edge on BTC (best is the fixed-TP 4H cell at PF 1.25 /
+1.51% over ~2 years). RangeFilter is, at best, a marginal trend filter here — not a strategy on its
own.

## Next steps

1. **Don't ship signal-exit on BTC as-is.** If the live engine is to run `exit_mode: "signal"`, gate
   it to genuinely trending regimes or pair it with a profit-lock (e.g. trailing/breakeven) rather
   than pure stop-and-reverse. A hybrid — signal exit *plus* a trailing stop — is the obvious next
   experiment now that the backtest can model exit policies.
2. **Re-test on strongly trending instruments/regimes.** The hypothesis was about trends; BTC over
   this window is too choppy to be a fair test. Run the signal-exit vs fixed-TP matrix on assets/TFs
   with sustained directional moves before concluding the idea is dead everywhere.
3. **Sweep the protective SL and indicator params.** All signal runs used `--sl 0.08` and defaults
   (period 20 / multiplier 3.5). A higher multiplier (fewer, cleaner flips) may cut the whipsaw cost.
4. Live paper-trading remains the ground truth for the engine path; these offline numbers now agree
   with it on mechanics (always-in-market, ~flip-count trades).
