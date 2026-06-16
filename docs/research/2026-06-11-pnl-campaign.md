# PnL Campaign — Results (Spec 5)

**Date:** 2026-06-11
**Goal:** push the best SMC backtest from +10.13%/2y toward ≥+100%/2y, validated on a
train(2024-06→2025-06)/test(2025-06→2026-06) split. MaxDD ≤ 30%, test year > 0.
**Verdict: FAIL on all three axes. The ≥100% target is not reachable by sizing or stop
tuning on this strategy — the per-trade edge does not survive out of sample.**

## What shipped (engine, all opt-in, default-off, live untouched)

- Compound sizing (`--sizing compound`) — RiskPolicy sizes off live equity.
- Wilder `Technicals.atr`; ATR & structural stop modes (`--stopMode atr|structural`).
- Breakeven exit (`--breakevenR`).
- Risk templates `pnl_rpt{025,050,075,100}`.

All tested (4+3+6+3 unit checks), all existing suites green, live path byte-identical.
These are sound and reusable regardless of the empirical result below.

## Phase 2 — exposure calibration (train, compound)

| Symbol | rpt=1.0 train PnL | DD | note |
|---|---|---|---|
| BTCUSDT | −6.4% | 33.5% | SMC negative on BTC 1H — dropped |
| **SOLUSDT** | **+86.1%** | **19.2%** | best; HTF inert (against≈0) |
| XRPUSDT | +56.3% (no HTF) / +67% (HTF) | 24% / 21.5% | HTF helps slightly; DD over budget |

Chosen base: **SOLUSDT 1H SMC, rpt=1.0, compound, SL 3%/TP 6%, HTF off.**

## Phase 3 — edge levers on the SOL base (train). None robustly beat the base.

- **ATR stops:** every grid point far worse (best +14.9% @ DD 32% vs base +86.1% @ 19%),
  scattered, no plateau. (ATR *helped* XRP in a smoke test — symbol-specific, not a real edge.)
- **Structural stops:** all ~0/negative, DD 36–42%.
- **Breakeven:** only be=1.5R edged the base (+89.8% vs +86.1%, same DD), but be=1.0 and
  be=0.5 were worse → a lone pick, not a plateau; at 1.5R on a 2R TP the stop ≈ off
  (degenerate limit). Rejected as noise.

Conclusion: the calibrated base is the strongest, simplest config. Mechanical stop/exit
tweaks add no robust edge — same sober lesson as the HTF measurement.

## Phase 4 — frozen candidates, blind test

Two pure-base candidates (no edges), frozen before touching the test window.

| Candidate | Train PnL | Full-2y PnL | **Test-yr PnL** | Full DD | PF (full) |
|---|---|---|---|---|---|
| A: SOL rpt=1.0 | +86.1% | +76.2% | **−2.1%** | 38.3% | 1.17 |
| B: SOL rpt=0.75 | +61.7% | +56.9% | **−0.6%** | 29.9% | 1.19 |

(Train single-run reproduced the matrix +86.1% — engine consistency confirmed.)

### Verdict against the criterion (§2)
- Full ≥ +100%? **NO** (best +76.2%).
- Test year > 0? **NO** (−2.1% / −0.6%, profit factor ≈ 0.99 = coin-flip after costs).
- MaxDD ≤ 30%? **NO for A** (38.3%); B scrapes under at 29.9% but fails the other two.

## Why it failed (the real finding)

1. **The whole full-period gain came from the train year.** Year 2 added ~nothing
   (test PF ≈ 0.99). The +10.13% baseline was not small because of timid sizing — it was
   small because **SMC's per-trade edge is thin** (WR ~40%, PF barely above 1 in-sample,
   ≈1.0 out-of-sample after fees+slippage).
2. **Sizing/compounding amplifies a real edge; it cannot manufacture one.** Applied to a
   thin/zero out-of-sample edge, rpt=1.0 compounding just amplified variance — full DD
   ballooned to 38% (the deep drawdown landed in year 2), while net return did not clear 100%.
3. **Symbol selection (SOL) was itself a train-fit.** SOL won on train; out of sample its
   edge evaporated like the others. This is exactly what the train/test split exists to expose.

## Recommendation

The ≥100%/2y target is **not achievable by sizing or stop tuning on the current SMC logic**
without ruinous, out-of-sample-fragile risk. The honest lever is a **genuine entry edge** —
better signal quality (higher PF per trade), not more leverage on a coin-flip. That means new
or materially improved strategy *logic*, which was explicitly out of scope here (§7) and
belongs in its own spec → measure → validate cycle, held to the same blind-test bar.

Do **not** re-optimize parameters to chase a prettier full-period number — that just
re-fits the train year and the test will keep failing.
