# Post-Pump-Dump Swing — Result

**Date:** 2026-06-14
**Status:** COMPLETE. **Verdict: 🟡 AMBER (near-breakeven, marginally negative).** The
candle-backtestable post-pump-dump short is not a clean edge; it hovers at zero and the losers
are coins shorted mid-pump that kept ripping up. The control is clean (majors barely trade).
**Local-only** — not committed (research note).

---

## Frozen protocol (pre-registered, no tuning)

- **Detector (`isPumpDumpShort`):** over a trailing `pumpWindow`, a peak in the past, run-up from
  the pre-peak base ≥ `pumpPct`, pullback from the peak ≥ `dumpPct`.
- **Entry:** Donchian lower-channel breakdown → SELL (`donchianTrend`, `entryLookback=96`).
- **Exit:** channel trailing hold — `stopMode:'channel'` (2×ATR initial stop, no TP) +
  `exitPolicy.channelExit=192` (≈2 days on 15m). Short only.
- **Universe:** 30 alt perps + 6 majors (control, **same detector gate** — majors should rarely
  qualify). Detector performs the selection.
- **Timeframes:** 15m primary, 5m robustness. **Costs:** taker 0.06% + 5 bps/side. **Leverage 1.**
- **Parameter sets:** P1 `pumpPct=0.50, dumpPct=0.15`; P2 (strict) `pumpPct=1.00, dumpPct=0.20`;
  both `pumpWindow=480, entryLookback=96, channelExit=192`.
- **Windows:** train 2024-06-01→2025-06-01 (descriptive); **test 2025-06-01→2026-06-08 (blind)**.

## Test-year result (blind window)

| tf | set | alts traded | alts net-positive | alts avg PnL | beat-BH | alts worst MaxDD | majors avg (traded) |
|----|-----|:--:|:--:|:--:|:--:|:--:|:--:|
| 15m | P1 | 22 | 36% | −0.5% | 11/22 | 6.4% | +0.1% (1) |
| 15m | P2 | 14 | **50%** | −0.5% | 6/14 | 4.8% | −0.1% (1) |
| 5m  | P1 | 13 | 23% | −0.6% | 6/13 | 5.0% | −0.0% (1) |
| 5m  | P2 | 12 | 33% | −0.3% | 6/12 | 3.7% | 0.0% (0) |

### Four-part gate verdict — FAIL (marginal) in every cell

1. **PnL > 0 — FAIL,** but only marginally (−0.3% to −0.6% average per symbol per year).
2. **Breadth ≥ 50% — borderline.** P2/15m hits exactly 50%; the others are 23–36%.
3. **Beats buy-and-hold — ~half** (≈50% of traded alts). As in B+, this is partly because half
   the alts crashed in the test year, so a near-flat short "beats" holding them.
4. **MaxDD ≤ 30% — PASS** (worst 6.4%), but exposure is small (few trades), so this is not skill.

**Control is clean:** majors fire at most 1 trade across all configs and net ≈ 0. The detector
genuinely isolates a pump-specific regime — there is no false major-driven edge (unlike a worry
the control was designed to catch).

## What the numbers actually say

- **Near-breakeven, not a decisive loss.** Unlike the B+ scalp (where PnL scaled monotonically
  negative with trade count — pure cost bleed), here trades are rare (1–16 per symbol/year) and
  the average sits just below zero. The regime filter helps: P2 (only strong pumps) lifts 15m
  breadth to 50%. But it never crosses into positive.
- **The losers are "shorted a coin still pumping."** The average is dragged down by a few coins
  the detector flagged after a 15–20% pullback that turned out to be a *pause in a parabola*, not
  a top: LABUSDT −4.7% (buy-and-hold +3633% — it kept ripping up), SKYAIUSDT −2.0% (B&H +399%),
  ZEC/SIREN small losses (B&H +778%/+765%). At candle close you cannot distinguish a
  pullback-then-continue from a pullback-then-dump.
- **This is the SAME root cause as the B+ scalp.** Both the scalp ("which breakout has impulse?")
  and the swing ("has this pump actually topped?") reduce to a timing question that the candle
  close cannot answer and that the trader resolves with the **order book and tape** (the wall
  being eaten / defended, the print rolling over). The order book is the timing oracle for both
  setups. This is a convergent finding: across his two distinct strategies, the backtestable
  candle skeleton is ≈ 0, and the edge lives in the order flow we cannot see historically.

## Interpretation (traffic light)

- **🟡 amber.** Not 🟢 (never positive). Not a clean 🔴 (the thesis is not decisively refuted — it
  hovers at zero, with the negative average concentrated in a handful of still-pumping coins the
  detector mistimed). The candle-only post-pump-dump short is a marginal, near-breakeven signal.
- The realistic path to make it positive is the part B+ also pointed to: an **order-book / tape
  filter** that confirms the pump is exhausted before shorting (wall above being eaten, no fresh
  bids), testable only live/forward.

### Caveats

- **Small sample:** 12–22 alts traded, few trades each — a single regime year. Treat the level as
  indicative, not precise.
- **Possible (untested, would be tuning):** a stricter "confirmed top" precondition (larger
  `dumpPct`, or price below a long MA) might drop the still-pumping losers — deliberately NOT done
  here to avoid fitting the blind window.
- **Survivorship:** universe drawn from coins alive today → mild optimistic bias → a non-positive
  result is more conclusive, not less.

## Reproduce

```
node backtest/run-ppd-scout.mjs > backtest/ppd-out.txt
```
Frozen configs in `backtest/run-ppd-scout.mjs` (`PSETS`, `WINDOWS`, `COSTS`). Data already in
`market_data.db` (the B+ 36-symbol download). `ppd-out.txt` is scratch (not committed).
