# Daily Coin Screener — Design Spec

**Date:** 2026-06-13
**Status:** DESIGN APPROVED — **implementation of the live wrapper DEFERRED**.
**Why deferred:** the screener is a component of the "copy ProScalping" live system. Before
building any live infrastructure we must first prove the concept gives a positive edge
(see "Relationship to B+ concept-proof" below). The pure selection core (`score.js`) is NOT
deferred — it is exactly what the B+ concept-proof will build and test on historical data.

---

## Goal

A daily screener that selects a dynamic shortlist of Binance USDⓈ-M Futures symbols worth
trading that day — mirroring how ProScalping picks freshly-pumped, volatile, liquid alts
rather than a static universe.

## Architecture

Pure selection core + thin I/O shell, mirroring the backtest-driver pattern. `bot_engine.js`
untouched — fully standalone module.

```
fapi 24h ticker + exchangeInfo  →  normalize  →  scoreUniverse() [PURE]  →  top-N
                                                       ↓
                                       screener_picks (DB) + screener-latest.json
```

## Components

| File | Responsibility | I/O |
|------|----------------|:--:|
| `src/screener/fetchFutures24h.js` | Binance fapi client: `GET /fapi/v1/ticker/24hr` + `GET /fapi/v1/exchangeInfo` (status TRADING, PERPETUAL, tick/lot filters). Returns normalized rows. | yes |
| `src/screener/score.js` | **PURE** `scoreUniverse(rows, opts)`: metrics → junk filter → liquidity floor → rank composite → top-N. No I/O. **Reused by B+.** | no |
| `src/screener/screenerRepo.js` | Persist `screener_picks` (dated snapshots) + write `screener-latest.json`. | yes |
| `src/screener/run-screener.js` | CLI: fetch → score → persist → print table. | yes |
| `tests/test_screener_score.mjs` | Pure scoring tests on synthetic rows. | no |

**Core boundary:** all selection logic lives in `score.js` as a pure function of an array of
rows. Network and DB are separate, so scoring is tested deterministically without the network
(live 24h snapshot replaced by a fixture).

## Scoring logic (`score.js`, pure)

**Per-row metrics:**
- `volatility = (high - low) / low` — 24h range (impulse potential)
- `momentum = |priceChangePercent| / 100` — pump/dump magnitude (both directions)
- `liquidity = quoteVolume` — USDT turnover

**Pre-filters:** symbol ends with `USDT`; exchangeInfo status `TRADING` + `PERPETUAL`;
stablecoin-base denylist; **liquidity floor** `minQuoteVolume` (default $20M, configurable).

**Rank composite:** percentile-rank each metric across survivors (0..1), then
`score = wVol·rVol + wMom·rMom + wLiq·rLiq`. Default weights `wVol=0.5, wMom=0.3, wLiq=0.2`
(volatility-led; liquidity already gated by the floor, so lower weight). Configurable.
Output top-N (default 15), tie-break by liquidity. Rank composite chosen over z-score because
pumped coins are heavy-tailed outliers — ranks compress them; z-scores explode.

## Persistence

- **`screener_picks`** (in `trading_lab.db`): `snapshot_ts, rank, symbol, score, volatility,
  momentum_pct, quote_volume, last_price`. One row per pick per snapshot (dated history).
- **`screener-latest.json`**: `{ generatedAt, params, picks[] }` for consumers.

## Cadence

Once-daily snapshot (manual/cron for v1). Intraday refresh explicitly out of scope for v1.

## Error handling

- fetch failure → 1 retry → abort without partial write.
- rows missing required fields → skipped.
- fewer than N survivors → take what's available + log warning.

## Testing (pure `score.js`)

Ranking order; liquidity-floor exclusion; denylist exclusion; top-N cap; weight sensitivity;
tie-break by liquidity; empty input. All deterministic on synthetic rows, no network.

---

## Relationship to B+ concept-proof (the actual next priority)

The full ProScalping strategy depends on the live order book ("плита"). **Historical L2 depth
is not freely available** (Binance public archive offers only top-of-book `bookTicker`, stale
since 2024; full depth is paid-only and not the current pump regime). Therefore the full
strategy **cannot be backtested** — only forward-tested live.

Before building any live system, we run **B+**: a backtest of the strategy MINUS the order
book but WITH every candle-observable rule — dynamic alt universe (this `score.js` applied to
**historical** daily stats), round numbers, consolidation/pinch, breakout entry, tight ~2:1
asymmetric exit. Fully backtestable; reuses this pure core + the existing Breakout logic +
simulator.

**Interpretation is asymmetric:**
- skeleton already positive on volatile alts → 🟢 green: build the live forward harness (A).
- skeleton flat → 🟡 amber: the entire edge must come from the order book, testable only
  forward — high risk.
- no clean 🔴 red: a negative candle result does not kill the order-book hypothesis, because
  the order book was never tested.

So: this live screener wrapper is deferred. Its pure `score.js` core is implemented and
validated first inside B+. The live wrapper is built only if B+ does not come back red.
