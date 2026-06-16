# Donchian Trend Strategy — Measurement Results

**Date:** 2026-06-12
**Spec:** docs/specs/2026-06-12-donchian-trend-design.md
**Goal:** measure whether a classical Donchian channel breakout (Turtle system) generates a
positive, broad test-year edge on the 6-symbol crypto basket, validated against a
pre-registered four-part gate evaluated on a blind test window (2025-06-01 → 2026-06-08).

**Verdict: FAIL on gate (1) test PnL > 0 and gate (2) breadth ≥ 4/6.** All four (config × tf)
combinations produce only 2/6 positive symbols in the test year, and net PnL for the majority
of cells is negative. Gate (4) MaxDD ≤ 30% passes trivially (worst DD ≤ 2.7%); gate (3) beats
buy-and-hold passes 6/6 everywhere — but BH was deeply negative (crypto bear year), so
"beating BH" means losing less, not making money. The configs are reported honestly with NO
goalpost-moving.

---

## Frozen protocol (pre-registered before seeing test data)

- **Configs:** Turtle 20/10 (fast) + 55/20 (slow) — entry/exit channel lookbacks.
- **Sizing:** fixed 2% risk per trade, no compounding; initial stop = 2×ATR (stopMode channel).
- **Exit:** M-bar Donchian channel trailing stop (ratchet-only — stop only moves in your favour,
  never widens). This is a deliberate conservative fidelity choice; it differs marginally from
  "exit on any new M-bar low" only when the channel low is descending, which is immaterial for a
  trend system where you want the trailing floor never to drop.
- **Costs:** taker 0.06%, maker 0.02%, slippage 5 bps.
- **Universe:** leverage 1 (spot equivalent); 6 symbols (BTC, ETH, LTC, SOL, XLM, XRP); 2 TFs
  (1H, 4H).
- **Windows:** train 2024-06-01 → 2025-06-01 (descriptive only); test 2025-06-01 → 2026-06-08
  (blind — gate evaluated here only).
- **Lookback:** 250 bars warm-up per cell.

---

## Test-year results (blind window: 2025-06-01 → 2026-06-08)

### fast config (entry=20, exit=10)

#### 1H timeframe

| Symbol  | PnL%  | MaxDD% | Trades | Buy-and-Hold | Beat BH |
|---------|-------|--------|--------|-------------|---------|
| BTCUSDT | -0.9% | 1.3%   | 311    | -39.1%      | Y       |
| ETHUSDT | -0.4% | 1.2%   | 290    | -32.8%      | Y       |
| LTCUSDT | -1.9% | 2.5%   | 310    | -50.6%      | Y       |
| SOLUSDT | -0.5% | 1.5%   | 321    | -57.3%      | Y       |
| XLMUSDT | +0.4% | 2.7%   | 310    | -22.0%      | Y       |
| XRPUSDT | +0.2% | 1.0%   | 295    | -46.4%      | Y       |

Positive: 2/6. Beat BH: 6/6. Worst DD: 2.7%.

#### 4H timeframe

| Symbol  | PnL%  | MaxDD% | Trades | Buy-and-Hold | Beat BH |
|---------|-------|--------|--------|-------------|---------|
| BTCUSDT | -0.0% | 0.8%   | 67     | -39.5%      | Y       |
| ETHUSDT | +0.9% | 1.1%   | 63     | -33.2%      | Y       |
| LTCUSDT | -1.2% | 2.0%   | 69     | -51.2%      | Y       |
| SOLUSDT | -0.9% | 1.9%   | 75     | -57.1%      | Y       |
| XLMUSDT | +0.1% | 1.2%   | 69     | -24.2%      | Y       |
| XRPUSDT | -0.8% | 1.5%   | 70     | -46.8%      | Y       |

Positive: 2/6. Beat BH: 6/6. Worst DD: 2.0%.

---

### slow config (entry=55, exit=20)

#### 1H timeframe

| Symbol  | PnL%  | MaxDD% | Trades | Buy-and-Hold | Beat BH |
|---------|-------|--------|--------|-------------|---------|
| BTCUSDT | -0.6% | 1.1%   | 155    | -39.1%      | Y       |
| ETHUSDT | +0.2% | 1.2%   | 134    | -32.8%      | Y       |
| LTCUSDT | -1.9% | 2.6%   | 148    | -50.6%      | Y       |
| SOLUSDT | -1.0% | 1.7%   | 153    | -57.3%      | Y       |
| XLMUSDT | +1.1% | 1.7%   | 151    | -22.0%      | Y       |
| XRPUSDT | -0.5% | 1.5%   | 147    | -46.4%      | Y       |

Positive: 2/6. Beat BH: 6/6. Worst DD: 2.6%.

#### 4H timeframe

| Symbol  | PnL%  | MaxDD% | Trades | Buy-and-Hold | Beat BH |
|---------|-------|--------|--------|-------------|---------|
| BTCUSDT | -0.3% | 0.9%   | 36     | -39.5%      | Y       |
| ETHUSDT | -0.6% | 1.6%   | 36     | -33.2%      | Y       |
| LTCUSDT | -0.2% | 1.0%   | 32     | -51.2%      | Y       |
| SOLUSDT | -0.2% | 1.1%   | 33     | -57.1%      | Y       |
| XLMUSDT | +0.1% | 1.0%   | 35     | -24.2%      | Y       |
| XRPUSDT | +0.2% | 1.0%   | 28     | -46.8%      | Y       |

Positive: 2/6. Beat BH: 6/6. Worst DD: 1.6%.

---

## Breadth summary (test year)

| Config | TF | Positive /6 | Beat-BH /6 | Worst DD |
|--------|----|------------|-----------|---------|
| fast   | 1H | 2/6        | 6/6       | 2.7%    |
| fast   | 4H | 2/6        | 6/6       | 2.0%    |
| slow   | 1H | 2/6        | 6/6       | 2.6%    |
| slow   | 4H | 2/6        | 6/6       | 1.6%    |

---

## Train-year results (descriptive only: 2024-06-01 → 2025-06-01)

| Config | TF | Symbol  | PnL%  | MaxDD% | Trades | Buy-and-Hold |
|--------|----|---------|-------|--------|--------|-------------|
| fast   | 1H | BTCUSDT | -1.4% | 1.7%   | 299    | 54.4%       |
| fast   | 1H | ETHUSDT | -1.3% | 1.7%   | 307    | -32.9%      |
| fast   | 1H | LTCUSDT | -2.0% | 2.7%   | 307    | 4.8%        |
| fast   | 1H | SOLUSDT | -1.6% | 2.3%   | 317    | -6.3%       |
| fast   | 1H | XLMUSDT | +1.9% | 2.2%   | 274    | 148.2%      |
| fast   | 1H | XRPUSDT | +0.4% | 1.2%   | 267    | 318.8%      |
| fast   | 4H | BTCUSDT | +0.4% | 0.6%   | 64     | 54.1%       |
| fast   | 4H | ETHUSDT | +0.2% | 0.8%   | 67     | -33.5%      |
| fast   | 4H | LTCUSDT | -0.0% | 1.1%   | 68     | 4.6%        |
| fast   | 4H | SOLUSDT | -0.2% | 1.6%   | 70     | -7.4%       |
| fast   | 4H | XLMUSDT | +7.1% | 3.0%   | 58     | 149.3%      |
| fast   | 4H | XRPUSDT | +2.6% | 1.3%   | 60     | 316.7%      |
| slow   | 1H | BTCUSDT | -0.5% | 0.7%   | 147    | 54.4%       |
| slow   | 1H | ETHUSDT | -0.8% | 1.5%   | 150    | -32.9%      |
| slow   | 1H | LTCUSDT | +0.3% | 1.0%   | 140    | 4.8%        |
| slow   | 1H | SOLUSDT | -0.6% | 1.2%   | 147    | -6.3%       |
| slow   | 1H | XLMUSDT | +1.5% | 1.9%   | 142    | 148.2%      |
| slow   | 1H | XRPUSDT | +2.8% | 1.2%   | 129    | 318.8%      |
| slow   | 4H | BTCUSDT | +0.2% | 0.8%   | 32     | 54.1%       |
| slow   | 4H | ETHUSDT | +0.1% | 1.1%   | 33     | -33.5%      |
| slow   | 4H | LTCUSDT | -1.1% | 1.6%   | 33     | 4.6%        |
| slow   | 4H | SOLUSDT | +0.9% | 0.5%   | 29     | -7.4%       |
| slow   | 4H | XLMUSDT | +6.5% | 3.4%   | 29     | 149.3%      |
| slow   | 4H | XRPUSDT | +4.7% | 3.6%   | 33     | 316.7%      |

---

## Train-vs-test contrast

The train year (2024-06 → 2025-06) was a mixed-to-bullish crypto environment with strong XLM,
XRP, and BTC trending periods. Donchian did capture some of that momentum: XLM 4H fast produced
+7.1% train, XRP 4H slow +4.7%, XLM 4H slow +6.5%. These are real but narrow wins — 4/6 train
symbols are positive for fast-4H and slow-4H, but BTC and others are near-zero or slightly
negative even in-sample. The train surface is not convincing: best breadth 4/6 with the
biggest gainers clustered on two high-beta altcoins during a secular alt-bull.

The test year (2025-06 → 2026-06-08) is a bear/drawdown period for most symbols (BH ranging
from -22% to -57%). Donchian switches from a mixed winner to a consistent near-zero loser — BTC
-0.9% to -0.0%, ETH -0.4% to +0.9%, LTC -1.2% to -1.9%, SOL -0.5% to -1.0%, XLM +0.1% to
+1.1%, XRP -0.8% to +0.2%. The system is now losing money (slightly) on 4 of 6 symbols across
all (config × tf) variants. The train gains do not hold into the blind test window — unlike a
robust trend-follower, there is no out-of-sample preservation. The system is approximately
flat-to-small-loss regardless of config and timeframe, which is exactly the PF ≈ 1.0 signature
observed for SMC and TrendPullback on this same basket.

**Critically:** "beating BH" in the test year is misleading. The market fell 22–57% across
symbols; any system that avoids being long continuously will beat BH. The system is not
generating alpha — it is generating near-zero absolute returns against a falling market, which
looks like outperformance but is not a tradeable edge.

---

## Verdict against the four-part gate (TEST YEAR ONLY)

Gate evaluated per (config × tf):

| Config | TF | (1) PnL > 0 | (2) Breadth ≥ 4/6 | (3) Beats BH | (4) MaxDD ≤ 30% | Verdict |
|--------|----|------------|-----------------|------------|----------------|---------|
| fast   | 1H | FAIL (2/6 positive, net avg negative) | FAIL (2/6) | PASS (6/6) | PASS (2.7%) | **FAIL** |
| fast   | 4H | FAIL (2/6 positive, net avg negative) | FAIL (2/6) | PASS (6/6) | PASS (2.0%) | **FAIL** |
| slow   | 1H | FAIL (2/6 positive, net avg negative) | FAIL (2/6) | PASS (6/6) | PASS (2.6%) | **FAIL** |
| slow   | 4H | FAIL (2/6 positive, net avg negative) | FAIL (2/6) | PASS (6/6) | PASS (1.6%) | **FAIL** |

**Overall verdict: FAIL.** Gates (1) and (2) fail for every (config × tf) combination. Gates (3)
and (4) pass — but gate (3) is a weak signal in a bear year, and gate (4) confirms the system
avoids large drawdowns by being approximately flat (which is cold comfort when the goal is
positive returns).

No goalpost-moving. No re-running with different configs. The pre-registered Turtle values were
the test; they failed it.

---

## What this means

Four strategies (SMC, HTF-gate, TrendPullback, DonchianTrend) have now all landed at PF ≈ 1.0 /
near-zero absolute returns on this 6-symbol basket. The pattern is consistent: mechanical TA on
crypto at 1H/4H produces churn near the fee threshold, no sustained edge. Donchian's distinctive
result is that its drawdowns are tiny (≤ 2.7%) because the 2% fixed sizing + ratchet stop
architecture is very conservative — but tiny drawdowns on near-zero returns is not a business.

The system is not broken; it works mechanically and produces hundreds of trades. There is simply
no detectable edge in Donchian channel breakouts on this basket during this period. The finding
is the finding.
