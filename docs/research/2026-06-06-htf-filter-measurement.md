# HTF Filter Measurement — Results (Spec 3, dry-run)

**Date:** 2026-06-06
**Tool:** `scripts/analyze-htf-filter.js` (post-processing of `simulate()`; no change to the decision path)
**Data:** `market_data.db`, 2024-06-01 → 2026-06-04. HTF = 4× aggregation (1H→4H, 15m→1H).
**Guardrails:** backtest CLI defaults (SL 2%, TP 4%, minRR 1.5, fixed-notional).
**Buckets:** each historical trade classified vs the last *closed* HTF bar at its entry:
`with` (same direction as HTF trend), `against` (opposite), `neutral` (HTF ranging/insufficient).

## Headline finding (answers the over-filter fear directly)

The concern was: *a HTF gate might filter a counter-trend / scalp strategy down to zero,
or remove its winning trades.* **The data shows the opposite.** For the counter-trend
strategies (REVERSAL, VMC_CIPHERB), the `against` bucket is BOTH the largest share of
trades AND the dominant loss center. Filtering it **removes losses**, and the surviving
`with`+`neutral` set still holds a large number of trades (never zero). The trend-following
strategy (SMC) is already HTF-aligned (`against` ≈ 0), so a gate is simply inert — no
trades to lose.

`emaBand` consistently concentrates the most loss in the *filterable* `against` bucket.
`emaSlope` and especially `adxRegime` leak losers into the *unfilterable* `neutral`
bucket, so they remove **less** of the damage. The regime-aware idea (suppress only in
trending regimes) under-filters here because these counter-trend trades lose in ranging
regimes too. **`emaBand` is the best gate definition across the board.**

## Results

### SMC — already trend-aligned; gate inert

```
SMC BTCUSDT 1H (4403 HTF bars, 132 trades)
  [emaBand]   with 130 +2.20% WR39 | against   0  0.00% | neutral  2 -0.44%
  [emaSlope]  with 117 +2.65% WR40 | against   0  0.00% | neutral 15 -0.89%
  [adxRegime] with  57 +0.13% WR37 | against   0  0.00% | neutral 75 +1.62%

SMC SOLUSDT 1H (4403 HTF bars, 203 trades)
  [emaBand]   with 200 +3.10% WR39 | against   2 -0.44% | neutral  1 +0.39%
  [emaSlope]  with 192 +3.66% WR40 | against   1 -0.22% | neutral 10 -0.39%
  [adxRegime] with 111 -1.51% WR34 | against   2 -0.44% | neutral 90 +4.99%
```
`against` is ~0 on both symbols — SMC `side` follows `structure.trend`, which already
agrees with the 4H EMA. A rigid emaBand gate would remove 0–2 trades → **no benefit, no
harm**. Note `adxRegime` wrongly pushes ~half the (profitable) `with` trades into
`neutral` and the remaining `with` turns negative (SOL −1.51%) — so do **not** apply
adxRegime to SMC.

### REVERSAL — counter-trend trades are the big losers

```
REVERSAL BTCUSDT 1H  (452 trades)
  [emaBand]   with 178 +0.68% WR37 | against 244 -14.57% WR27 | neutral 30 -1.79%
  [emaSlope]  with 164 -0.48% WR36 | against 208 -11.45% WR27 | neutral 80 -3.75%
  [adxRegime] with  99 -0.05% WR36 | against 155 -11.26% WR25 | neutral 198 -4.37%

REVERSAL BTCUSDT 15m (493 trades)
  [emaBand]   with 185 -3.30% WR34 | against 275  -9.28% WR31 | neutral 33 -2.45%
  [emaSlope]  with 161 -6.50% WR30 | against 213  -8.31% WR30 | neutral 119 -0.23%
  [adxRegime] with 142 -1.68% WR35 | against 201  -9.90% WR28 | neutral 150 -3.46%

REVERSAL SOLUSDT 1H (1036 trades)
  [emaBand]   with 427 -2.80% WR35 | against 549 -31.72% WR27 | neutral 60 -1.14%
  [emaSlope]  with 405 -7.05% WR34 | against 506 -23.41% WR29 | neutral 125 -5.21%
  [adxRegime] with 246 -8.92% WR30 | against 322 -23.36% WR25 | neutral 468 -3.39%
```
`against` is the dominant loss on every dataset (BTC 1H −14.57%, SOL 1H −31.72%). An
emaBand gate removes it. BUT: even the `with` bucket is weak/negative on 15m and SOL 1H —
REVERSAL is a marginal-to-bad strategy overall; the gate removes its worst trades but does
not make it good. **Gate helps (emaBand); strategy itself needs separate work.**

### VMC_CIPHERB — clearest win for the gate

```
VMC_CIPHERB BTCUSDT 1H  (436 trades)
  [emaBand]   with 153 +2.57% WR39 | against 253 -11.71% WR29 | neutral 30 +1.25%
  [emaSlope]  with 144 +0.91% WR38 | against 208  -6.59% WR31 | neutral 84 -2.20%
  [adxRegime] with  95 +1.44% WR39 | against 154  -7.39% WR29 | neutral 187 -1.93%

VMC_CIPHERB BTCUSDT 15m (493 trades)
  [emaBand]   with 122 -2.11% WR34 | against 340 -10.31% WR31 | neutral 31 +1.03%
  [emaSlope]  with 113 -3.77% WR31 | against 293  -9.01% WR31 | neutral 87 +1.39%
  [adxRegime] with 103 -2.77% WR32 | against 253  -8.66% WR31 | neutral 137 +0.03%

VMC_CIPHERB SOLUSDT 1H (1035 trades)
  [emaBand]   with 432 +7.02% WR39 | against 542 -27.75% WR28 | neutral 61 +1.07%
  [emaSlope]  with 431 +1.76% WR37 | against 486 -16.53% WR31 | neutral 118 -4.89%
  [adxRegime] with 273 +5.17% WR40 | against 288  -9.73% WR31 | neutral 474 -15.10%
```
On 1H the `with` bucket is clearly positive (+2.57% BTC, +7.02% SOL) while `against` is
deeply negative. An emaBand gate flips the strategy from net-negative to net-positive on
both symbols. SOL `adxRegime` is a cautionary example of leakage: it cuts `against` to
−9.73% but dumps −15.10% into the unfilterable `neutral` bucket — net worse than emaBand.

### BREAKOUT — could not measure

```
BREAKOUT BTCUSDT 1H — 0 trades.
```
The breakout logic produced no trades on this dataset (pre-existing breakout entry issue,
noted previously). Re-measure after that entry path is fixed; HTF data is irrelevant until
the strategy trades.

## Recommended gate definition per strategy (drives the future live-gate spec)

| Strategy     | Recommended | Rationale |
|--------------|-------------|-----------|
| SMC          | **OFF**     | `against` ≈ 0; already HTF-aligned → gate inert. Never use adxRegime (suppresses good trades). |
| VMC_CIPHERB  | **emaBand** | `with` positive, `against` deeply negative on 1H both symbols; gate flips net positive. |
| REVERSAL     | **emaBand** | `against` is the biggest loss center; gate removes it. Strategy still marginal — needs more work beyond the gate. |
| BREAKOUT     | **TBD**     | 0 trades; fix the breakout entry path, then re-measure. |

## Implications for the live-gate spec (Spec 4)

1. The gate should default to **emaBand** semantics and be **per-strategy opt-in** (off by
   default) — exactly as `minRiskRewardRatio` is. SMC opts out (inert anyway); VMC and
   REVERSAL opt in.
2. `adxRegime` did **not** earn its complexity on this data — it under-filters by leaking
   losers into `neutral`. Ship the gate with `emaBand` only; keep `classifyHTFTrend`'s
   other definitions for future research but do not wire them into the live gate yet (YAGNI).
3. The over-filter fear is unfounded here: even with a rigid emaBand gate, every strategy
   retains a large `with`+`neutral` trade set. No "zero trades" risk on this data.
4. `aggregateHTF` + `classifyHTFTrend` (Spec 3) are already the reusable building blocks
   the gate will consume — no new market-data plumbing needed (HTF is aggregated from the
   same LTF candles).

## Caveats

- Single venue, two symbols (BTC, SOL), one 2-year window, default guardrails. Directionally
  strong and consistent, but confirm on more symbols / a walk-forward split before relying
  on absolute magnitudes.
- PnL here is the *historical* trade PnL bucketed post-hoc; it is not a re-simulation with
  the gate active. A gated re-run (the live-gate spec) may differ slightly because removing
  early trades changes which later positions are eligible (position-locking). Magnitudes are
  indicative, the sign and the with/against separation are the robust signal.
