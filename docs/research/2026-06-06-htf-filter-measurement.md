# HTF Filter Measurement — Results (Spec 3, dry-run)

**Date:** 2026-06-06
**Tool:** `scripts/analyze-htf-filter.js` (post-processing of `simulate()`; no change to the decision path)
**Data:** `market_data.db`, 2024-06-01 → 2026-06-04. HTF = 4× aggregation (1H→4H, 15m→1H).
**Guardrails:** backtest CLI defaults (SL 2%, TP 4%, minRR 1.5, fixed-notional).
**Buckets:** each historical trade classified vs the last **fully-closed** HTF bar at its entry
(`open + width <= entryTime` — no look-ahead): `with` (same direction as HTF trend),
`against` (opposite), `neutral` (HTF ranging / insufficient data).

> **Correction note:** the first pass of these numbers used a look-ahead lookup (it keyed
> on the HTF bar's *open* time, so a mid-bucket entry saw that bar's *future* close). That
> inflated the `with`-bucket PnL. The tables below are the corrected, no-look-ahead run
> (fix `83f721b`). The corrected results are notably more sober — see the headline.

## Headline finding (corrected)

Two things hold up, one was an artifact:

1. **The over-filter fear is unfounded.** For the counter-trend strategies (REVERSAL,
   VMC_CIPHERB), the `against` bucket is a large share of trades and a deep loss center.
   Filtering it does not remove profit — those trades lose. The surviving `with`+`neutral`
   set still holds hundreds of trades (never zero). SMC is already HTF-aligned
   (`against` ≈ 0), so a gate is simply inert.

2. **But the gate is a loss-REDUCER, not a profit-maker.** Once the look-ahead bias is
   removed, the `with`-trend buckets for REVERSAL and VMC are roughly **break-even to
   slightly negative** — not the clean positive the biased first pass showed. So an HTF
   gate cuts the worst losses but does **not** by itself turn these strategies profitable.

3. `emaBand` still concentrates the most loss in the *filterable* `against` bucket;
   `adxRegime` leaks losers into the *unfilterable* `neutral` bucket and under-filters.
   **`emaBand` remains the best gate definition.**

## Results (corrected, no look-ahead)

### SMC — already trend-aligned; gate inert

```
SMC BTCUSDT 1H (4403 HTF bars, 132 trades)
  [emaBand]   with 129 +1.82% WR39 | against  0  0.00% | neutral  3 -0.06%
  [emaSlope]  with 106 -0.39% WR36 | against  2 -0.44% | neutral 24 +2.59%
  [adxRegime] with  53 -0.80% WR34 | against  0  0.00% | neutral 79 +2.56%

SMC SOLUSDT 1H (4403 HTF bars, 203 trades)
  [emaBand]   with 197 +3.15% WR39 | against  3 -0.06% | neutral  3 -0.06%
  [emaSlope]  with 182 +1.61% WR38 | against  3 -0.06% | neutral 18 +1.48%
  [adxRegime] with 101 -2.33% WR33 | against  2 +0.17% | neutral 100 +5.20%
```
`against` ≈ 0 on both symbols — SMC `side` follows `structure.trend`, which already agrees
with the 4H EMA. A rigid emaBand gate removes 0–3 trades → **no benefit, no harm**. Note
`adxRegime` wrongly pushes ~half the (profitable) `with` trades into `neutral` and the
remaining `with` turns negative (SOL −2.33% with vs +5.20% neutral) — do **not** apply
adxRegime to SMC.

### REVERSAL — unprofitable across the board; gate cuts the worst but doesn't save it

```
REVERSAL BTCUSDT 1H  (452 trades)
  [emaBand]   with 183 -1.65% WR35 | against 241 -12.68% WR28 | neutral 28 -1.34%
  [emaSlope]  with 159 -1.80% WR35 | against 204 -11.78% WR27 | neutral 89 -2.09%
  [adxRegime] with  98 -1.05% WR35 | against 146  -9.87% WR25 | neutral 208 -4.76%

REVERSAL BTCUSDT 15m (493 trades)
  [emaBand]   with 184 -6.73% WR30 | against 267  -6.90% WR32 | neutral 42 -1.41%
  [emaSlope]  with 155 -2.73% WR34 | against 191  -9.51% WR28 | neutral 147 -2.79%
  [adxRegime] with 131 -4.11% WR31 | against 182  -8.73% WR29 | neutral 180 -2.20%

REVERSAL SOLUSDT 1H (1036 trades)
  [emaBand]   with 423 -12.87% WR31 | against 546 -20.71% WR30 | neutral 67 -2.08%
  [emaSlope]  with 409 -10.98% WR32 | against 502 -22.52% WR29 | neutral 125 -2.16%
  [adxRegime] with 251 -11.25% WR29 | against 312 -16.88% WR28 | neutral 473 -7.54%
```
Every bucket is negative on every dataset — REVERSAL loses with-trend too. On 15m the
`with`/`against` split barely separates (−6.73% vs −6.90%): the whole strategy is bad,
the HTF direction adds little signal. **Conclusion: REVERSAL is unprofitable as-is; an HTF
gate removes the worst slice but does not make it viable. The strategy needs rework or
retirement, not just a filter.**

### VMC_CIPHERB — gate brings it from clearly-losing to roughly break-even

```
VMC_CIPHERB BTCUSDT 1H  (436 trades)
  [emaBand]   with 131 -1.07% WR35 | against 276 -8.29% WR32 | neutral 29 +1.48%
  [emaSlope]  with 147 -0.97% WR35 | against 204 -7.53% WR30 | neutral 85 +0.62%
  [adxRegime] with  83 -0.16% WR36 | against 155 -4.57% WR32 | neutral 198 -3.15%

VMC_CIPHERB BTCUSDT 15m (493 trades)
  [emaBand]   with 115 -3.60% WR31 | against 351 -9.10% WR32 | neutral 27 +1.31%
  [emaSlope]  with 117 -4.66% WR30 | against 253 -6.83% WR32 | neutral 123 +0.10%
  [adxRegime] with  90 -2.32% WR32 | against 244 -9.10% WR30 | neutral 159 +0.02%

VMC_CIPHERB SOLUSDT 1H (1035 trades)
  [emaBand]   with 404 +0.45% WR37 | against 578 -18.08% WR31 | neutral 53 -2.02%
  [emaSlope]  with 440 -2.06% WR36 | against 478 -14.76% WR31 | neutral 117 -2.83%
  [adxRegime] with 259 -2.68% WR35 | against 296  -6.63% WR33 | neutral 480 -10.34%
```
The `against` bucket is the deep loss center (−8% to −18%). Removing it lifts VMC from
clearly-losing to roughly **break-even** (`with` = −1.07% BTC 1H, −3.60% BTC 15m, +0.45%
SOL 1H). This is the best gate candidate — a meaningful loss reduction — but the with-trend
edge alone is not yet positive enough to call profitable. SOL `adxRegime` again shows
leakage: it cuts `against` to −6.63% but dumps −10.34% into the unfilterable `neutral`
bucket — net worse than emaBand.

### BREAKOUT — could not measure

```
BREAKOUT BTCUSDT 1H — 0 trades.
```
The breakout logic produced no trades on this dataset (pre-existing breakout entry issue).
Re-measure after that entry path is fixed.

## Recommended gate definition per strategy (drives the future live-gate spec)

| Strategy     | Recommended | Rationale |
|--------------|-------------|-----------|
| SMC          | **OFF**     | `against` ≈ 0; already HTF-aligned → gate inert. Never use adxRegime (suppresses good trades). |
| VMC_CIPHERB  | **emaBand** | Best candidate: gating removes the −8%…−18% `against` loss, lifting the strategy to ~break-even. Needs additional edge to be net profitable. |
| REVERSAL     | **emaBand (low priority)** | Gate cuts the worst slice, but all buckets lose — the strategy is unprofitable as-is. Rework/retire before relying on a gate. |
| BREAKOUT     | **TBD**     | 0 trades; fix the breakout entry path, then re-measure. |

## Implications for the live-gate spec (Spec 4)

1. The gate should default to **emaBand** semantics and be **per-strategy opt-in** (off by
   default), exactly like `minRiskRewardRatio`. SMC opts out (inert anyway).
2. `adxRegime` did **not** earn its complexity on this data — it under-filters by leaking
   losers into `neutral`. Ship the gate with `emaBand` only; keep `classifyHTFTrend`'s
   other definitions for research but do not wire them into the live gate yet (YAGNI).
3. **Temper expectations:** the honest (no-look-ahead) result is that the gate is a
   loss-reducer, not a profit engine. It is worth enabling on VMC to stop the bleeding,
   but the strategies still need a genuine entry edge. Do not over-claim the gate's value.
4. The over-filter fear is unfounded: even with a rigid emaBand gate, every strategy
   retains a large `with`+`neutral` trade set. No "zero trades" risk on this data.
5. `aggregateHTF` + `classifyHTFTrend` (Spec 3) are the reusable building blocks the gate
   will consume — no new market-data plumbing needed.

## Caveats

- Single venue, two symbols (BTC, SOL), one 2-year window, default guardrails. The
  with/against separation and the sign of the `against` losses are robust; absolute
  magnitudes should be confirmed on more symbols and a walk-forward split.
- PnL here is the *historical* trade PnL bucketed post-hoc; it is not a re-simulation with
  the gate active. A gated re-run (the live-gate spec) may differ because removing early
  trades changes which later positions are eligible (position-locking). The direction of
  the conclusions is the robust signal, not the exact percentages.
- These tables are the corrected, no-look-ahead run. The earlier (biased) first pass
  over-stated the `with`-bucket PnL; do not cite pre-correction figures.
