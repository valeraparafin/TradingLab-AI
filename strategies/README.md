# Strategies — RangeFilter (VMC Swing)

Canonical, validated RangeFilter strategy definitions. Each `*.json` is a `createStrategy` payload
that combines the logic + risk templates with per-strategy overrides.

## What's here

| File | TF | ADX gate | Universe | Status |
|------|----|----------|----------|--------|
| `range_filter_1h_majors.json` | 1H | ≥ 30 | 6 majors | **primary, validated** (OOS PF ~1.19) |
| `range_filter_15m_alts.json` | 15m | ≥ 40 | 8 liquid alts | experimental, **paper-only** (slippage-fragile) |

Both use the shared templates:
- **Logic:** `templates/logic/range_filter.json` — signal mode (stop-and-reverse), multiplier 6,
  source `close`, period 20, with `adx_min` and two safety checks: `rf_trend_align` and
  `rf_regime_adx` (the ADX regime gate — the proven core lever, now enforced live).
- **Risk:** `templates/risk/range_filter.json` — wide 12% protective SL, no TP in signal mode.

## How the edge works (read before running)

- The edge is a **trend-regime** story. The ADX gate prunes low-ADX chop flips; without it the strategy
  is a net loser (PF < 1). The gate is the lever — it is now wired into the live engine via the
  `rf_regime_adx` safety check, so a manual bot built from these definitions carries the validated edge.
- **Win rate is ~33%.** The profit is in a few uncapped trend winners, not a high hit rate. Expect long
  flat stretches and several small losses between captures. Every winner-capping exit (trailing/partial/
  fixed TP) was tested and *hurt* — the only exit is the opposite signal flip.
- **1H is the sweet spot.** 4H and 1D fail out-of-sample; 5m/15m need the higher ADX bar and are slippage-
  fragile. See `docs/research/2026-06-16-range-filter.md` for the full campaign (incl. rejected ideas:
  HTF gate, RSI confluence, SMC structural gate, meta-labeling).

## Create + launch (manual bots)

```bash
# 1. start the orchestrator server (provides the DB + full-config endpoint)
npm run server

# 2. seed both strategies into the DB (idempotent — safe to re-run)
node scripts/seed-range-filter-strategies.mjs

# 3. launch from the dashboard (Start), or directly by id:
node bot_engine.js <strategyId>
```

Keep `paper_trading: 1` until forward results confirm the offline numbers — especially for the 15m
variant, whose backtest edge does not survive realistic slippage on thin books.
