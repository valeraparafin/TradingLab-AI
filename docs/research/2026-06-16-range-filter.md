# RangeFilter (VMC Swing) — Backtest Validation

**Date:** 2026-06-16
**Branch:** `feat/trading-agent-ai-flow`
**Plan:** [docs/plans/2026-06-16-range-filter-strategy.md](../plans/2026-06-16-range-filter-strategy.md) — Task 9
**Tooling:** `backtest/run-backtest.js` against `market_data.db`; runs persisted to `backtest.db` under group `rf_validation`.

---

## TL;DR

The RangeFilter logic type is correctly wired into the backtest pipeline (`--logic RangeFilter`
dispatches, generates signals, and trades). On BTCUSDT it is roughly break-even-to-slightly-positive
after costs: best observed was **+2.70% over ~2 years on 1H** (PF 1.09) — not a strong edge.

**Critical scope caveat:** the backtest **does not exercise the signal-exit (stop-and-reverse)
behavior** that the strategy ships with (`exit_mode: "signal"`). The pure backtest pipeline closes
positions only on fixed SL/TP (and optional breakeven/channel/time exit policies). The
"no profit cap on trends" hypothesis therefore **could not be validated here** — it lives only in the
live engine (`bot_engine.js`, Task 7) and needs a follow-up to wire `exit_mode` into the backtest shell.

---

## What the backtest engine actually honors re: `exit_mode`

Verified by reading the code, not assumed:

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

**Inconclusive for the strategy as designed.** The RangeFilter indicator + flip-entry mechanics are
wired correctly and trade as expected, but every result above is a **fixed SL/TP** variant. The
core hypothesis the strategy was built around — stop-and-reverse with no profit cap letting trends run
— is **not represented** in any of these numbers. On the fixed-TP variants the edge is marginal
(PF ≤ 1.25, best net +2.70% / 2yr on BTC), i.e. not compelling on its own.

## Next steps

1. **(Primary follow-up) Wire `exit_mode` into the backtest shell** so the simulator can honor
   signal-flip exits + state re-entry. This means threading the logic template's `exit_mode` through
   `run-backtest.js` → `simulate`, and adding a stop-and-reverse exit branch (mirroring the live
   `resolveSignalExit` / `signalStateSide` helpers) to `src/backtest/simulator.js`. Only then can the
   "no profit cap on trends" thesis be validated offline.
2. **Until then, the live engine (Task 7) is the only place the signal-exit behavior runs.** Validate
   it via paper trading rather than relying on these backtest numbers.
3. If a backtest-shell follow-up lands, re-run a matrix across trending symbols/TFs and compare
   signal-exit vs the fixed-TP baselines recorded here (group `rf_validation`).
