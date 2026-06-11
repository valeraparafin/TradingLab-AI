# Backtesting runbook

How to run backtests in this repo without re-reading the source. Two entry points,
both pure/deterministic (no network, no `Date.now()`), both read candles from
`market_data.db` and write runs/trades/equity to `backtest.db`.

| Script | Use it for | Sizing source |
|---|---|---|
| `backtest/run-backtest.js` | **one** cell, fully controlled by CLI flags | CLI flags (`--equity`, `--riskPerTrade`, `--sl`, …) |
| `backtest/run-matrix.js` | **cross-product** sweep over risk × logic × symbol × tf | file risk templates in `templates/risk/*.json` |

> The two scripts source guardrails differently. `run-backtest.js` builds them from
> CLI flags (`buildGuardrails`). `run-matrix.js` loads a named risk template per cell
> (`riskProfileToGuardrails`) — to change balance/SL/TP in the matrix you edit or add a
> template, **not** a CLI flag.

## Quick start

```powershell
# Single cell: SMC on BTC 1H, $200 account, 10% per trade, SL3/TP6, HTF gate on
node backtest/run-backtest.js --symbol XRPUSDT --tf 1H --logic SMC `
  --equity 200 --riskPerTrade 0.10 --sl 0.03 --tp 0.06 --leverage 10 --htf

# Matrix sweep: 2 risk profiles × SMC × 6 symbols × 1H, HTF on, one report
node backtest/run-matrix.js --risks exp200_mid,exp200_tight --logics SMC `
  --symbols BTCUSDT,ETHUSDT,SOLUSDT,LTCUSDT,XLMUSDT,XRPUSDT --tfs 1H `
  --leverage 10 --htf --group my_sweep
```

CLI parsing (`parseArgs` in `download-data.js`): `--flag value` sets the value;
a **bare** `--flag` (end of args or followed by another `--flag`) sets it to `true`
(that's how `--htf` switches the gate on).

## Logic types (`--logic` / `--logics`)

`SMC`, `Breakout`, `VMC_CipherB`, `Reversal` (case-insensitive). Anything else throws.
Defined in `src/indicators/index.js`. Empirically SMC on 1H is the strongest;
VMC_CipherB/Reversal over-trade and bleed to fees on this data.

## What market data exists

Don't assume — query it:

```powershell
node -e "import('./src/data/marketDataSchema.js').then(async ({openMarketDb})=>{const db=await openMarketDb('market_data.db');for(const r of await db.all('SELECT symbol,timeframe,COUNT(*) n,MIN(time) a,MAX(time) b FROM candles GROUP BY symbol,timeframe ORDER BY symbol,timeframe'))console.log(r.symbol,r.timeframe,r.n,new Date(r.a).toISOString().slice(0,10),'->',new Date(r.b).toISOString().slice(0,10));await db.close();})"
```

As of 2026-06: BTC/ETH/SOL/LTC/XLM/XRP-USDT, timeframes `5m/15m/1H/4H`, ~2024-06→2026-06.
Every symbol has a `contract_specs` row (mmr 0.005), so futures (`--leverage > 1`) works.
If a cell errors with "Not enough candles", download more via `backtest/download-data.js`.

## CRITICAL: how sizing & leverage actually behave

Read `src/agents/RiskPolicy.js` + `src/backtest/simulator.js` if you doubt this:

- **Position notional `sizeUSD = portfolioValue × riskPerTrade`** (a USD notional, capped by
  `maxTradeSizeUSD`). It is **NOT** risk-based off the stop distance.
- **No compounding.** Sizing always uses the *starting* `portfolioValue`; the running
  equity does not feed back into size. So absolute PnL is roughly linear in trade count,
  not geometric. `netPnl%` = netPnl / startEquity.
- **Leverage does NOT amplify PnL.** `--leverage` only lowers required margin
  (`marginUSD = sizeUSD / leverage`) and sets the liquidation price. With a stop tighter
  than ~`1/leverage`, the SL fires before liquidation (Liq stays 0) and 1× vs 10× give
  identical returns. The real PnL lever is `riskPerTrade` (position fraction).
- Futures (`leverage > 1`) requires an MMR (from the contract spec or `--mmr`) or it throws.

## HTF gate flags (backtest-only, opt-in)

Wired into both runners. Bare `--htf` turns it on; it filters entries by a higher-timeframe
EMA-band trend (`src/backtest/htfGate.js`). In the matrix it's built once and applied to every cell.

| Flag | Default | Meaning |
|---|---|---|
| `--htf` | off | enable the gate |
| `--htfRatio` | 4 | HTF = ratio × base tf (e.g. 1H → 4H) |
| `--htfEma` | 50 | EMA period on the HTF |
| `--htfBand` | 0.005 | flat-zone band (±0.5%) around the EMA where entries are blocked |

Observed: a mild refinement on SMC, not a primary edge; widening the band barely changes trade counts.

## `run-backtest.js` flags (single cell)

`--symbol --tf --logic --label --group`
`--leverage --mmr --fundingMode (real-mean|tile|constant) --fundingRate --liqFee`
`--lookback (250) --from <ISO> --to <ISO>`
Guardrails: `--equity (10000) --riskPerTrade (0.1) --maxTradeSizeUSD --sl (0.02) --tp (0.04)`
`--minRR (1.5) --maxOpen (1) --maxHeat (100) --dailyLoss (1) --maxTrades`
Costs: `--takerFee --makerFee --slippageBps (5)`
**Guardrail flags here are FRACTIONS** (`--sl 0.03` = 3%, `--riskPerTrade 0.1` = 10%).

## `run-matrix.js` flags (sweep)

Comma-separated lists: `--risks --logics --symbols --tfs`.
Shared: `--leverage --mmr --fundingMode --fundingRate --lookback --from --to --group`
HTF: `--htf --htfRatio --htfEma --htfBand`.
There is **no** `--equity`/`--sl`/`--tp` here — those live in the risk template.

### Risk templates (`templates/risk/<id>.json`)

`--risks <id>` loads `templates/risk/<id>.json`. Schema is **whole-percent** (the single ÷100
boundary is `riskProfileToGuardrails`): `riskPerTradePercent: 10` means 10%, not 0.10.
Accepted shapes: `{settings:{…}}`, `{content:{settings:{…}}}`, or a bare settings object.

```json
{
  "id": "exp200_mid",
  "name": "Exp $200 mid (SL3/TP6)",
  "settings": {
    "riskPerTradePercent": 10,
    "portfolioValue": 200,
    "maxTradeSizeUSD": 100000,
    "stopLossPercent": 3,
    "takeProfitPercent": 6,
    "minRiskRewardRatio": 1.2,
    "maxTradesPerDay": 100
  }
}
```

Other keys (all whole-percent / counts): `maxOpenPositions`, `maxPortfolioHeatPercent`,
`dailyLossLimitPercent`, `dailyProfitTargetPercent`. To sweep SL/TP, create one template per
variant and list them in `--risks` (that's exactly what `exp200_tight/mid/wide/rr25/rr3.json` are).

## Output

- **stdout**: per-cell log lines, then (matrix) a `MATRIX COMPARISON` table sorted by NetPnl%
  with columns Trades, WinRate, PF (profit factor), NetPnl%, MaxDD%, Sharpe, Funding, Liq.
- **`backtest.db`**: every run persisted (`saveRun`/`saveTrades`/`saveEquityCurve`),
  tagged with `--group` for later querying (`BacktestRepo.listRunsByGroup`).
- **`backtest/reports/<group>.json`**: matrix only — machine-readable rows for the dashboard.

## Tests

`node tests/test_matrix.js` (unit: `expandMatrix`, `loadRiskProfile`, `buildHtfDecide`),
`node tests/test_matrix_integration.js` (runs a real 2-cell sweep against `market_data.db`).
