# Signal Core + Backtesting Module — Design Spec

- **Date:** 2026-06-02
- **Branch:** `feat/signal-core` (based on `feat/trading-agent-ai-flow`)
- **Status:** Approved design, pending implementation plan

## 1. Problem

The project cannot faithfully backtest its strategies because the decision logic
("indicator output → trade side → risk → order") is fragmented across two
divergent live paths, and partly missing or simulated:

| Path | Indicator → side | Risk / SL/TP |
|---|---|---|
| **Legacy `bot_engine.js`** (manual strategies, `trading_lab.db`) | Real, but only Breakout + structure (SMC/Reversal); **defaults to BUY on neutral** (bug) | Inline percent math, **bypasses `RiskPolicy`** |
| **AI agent** (`AgentOrchestrator`, `ai_trading.db`) | **Simulated** heuristic in `AnalystAgent` — does not use real indicators | `RiskPolicy` (fractions via `paramResolver`) |

Specific gaps:
- No uniform "signal contract"; each indicator emits a different shape.
- `WaveTrend` (`wtCrossUp/Down`) has **no** side mapping anywhere → VMC_CipherB has no honest side decision in live.
- `bot_engine` trades `BUY` on neutral signals (no-signal → trade).
- The AI agent's "analysis" is simulated, not driven by indicators.
- Two different risk behaviors for the "same" trade.
- No historical candle/funding storage; no execution simulator; no metrics.

Carrying this fragmentation forward makes every future strategy/UI more expensive to fix. The cost of correction grows non-linearly — fix it now.

## 2. Approach: incremental strangler with a shared pure core

Chosen over (A) backtest-only adapter — does not fix the root — and (C)
big-bang rewrite — unacceptable risk on money-handling code.

Engineering principles:
1. **Contract first, code second.** A small stable signal contract is the
   "narrow waist" all indicators converge into and all execution diverges from.
2. **Pure core / imperative shell.** The decision pipeline is a pure function
   (no I/O, no `Date.now()`, no DB, no network, deterministic). Backtest and live
   differ only in the *data source* and the *execution sink*. Parity is therefore
   structural, not maintained by hand.
3. **Strangler, not bulldozer.** Build the new core alongside the old; migrate one
   path/strategy at a time; never delete the old path until the new one is proven.
4. **Safety net before touching live.** Characterization (golden-master) tests lock
   current live behavior before any live code switches over. Live switches are
   behind a feature flag that defaults OFF, with instant rollback.
5. **Close gaps in the right place.** e.g. the missing WaveTrend→side mapping is
   added inside the new contract, not patched into legacy `bot_engine`.

## 3. Architecture & contracts

```
        ┌──────────── PURE CORE (no I/O, deterministic) ─────────────┐
candles→│ IndicatorManager → SignalAdapter → Signal → RiskPolicy → Decision │
        └────────────────────────────────────────────────────────────┘
              ▲                                              │
   ┌──────────┴──────────┐                       ┌───────────┴───────────┐
   │  BACKTEST shell      │                       │     LIVE shell         │
   │ history bar-by-bar   │                       │ latest candle + BitGet │
   │ fill/fee/funding sim │                       │ real order             │
   └─────────────────────┘                       └────────────────────────┘
```

Contracts (JSDoc typedefs in `src/core/contracts.js`):

| Contract | Shape | Note |
|---|---|---|
| `Candle` | `{time, open, high, low, close, volume}` | exists today |
| `StrategyContext` | `{candles[], config, symbol, timeframe}` | adapter input |
| `Signal` | `{side: BUY\|SELL\|HOLD, conviction: 0..1, reason, invalidation?}` | == existing `QualitativeProposal` shape from `AnalystAgent` |
| `AccountState` | `{equity, openPositions, heatPct, dailyPnlPct, tradesToday, leverage}` | RiskPolicy input |
| `Decision` | `{decision: PERMIT\|DENY, reason?, order?}` | RiskPolicy output |
| `Order` | `{side, sizeUSD, marginUSD, entryPrice, slPrice, tpPrice, leverage}` | `marginUSD`/`leverage` for futures |

Because `Signal` equals the shape `AnalystAgent` already emits, migrating the live
AI agent is a swap of its simulated heuristic for `SignalAdapter` output — the
orchestrator/RiskPolicy/executor are untouched.

**Responsibility boundary:** leverage / margin / SL/TP / gates → `RiskPolicy`.
Liquidation trigger / funding / fees / slippage / fill → execution shell.

Proposed module layout (paths finalized in the implementation plan):
- `src/core/contracts.js` — typedefs
- `src/core/SignalAdapter.js` — per-indicator mapping
- `src/core/pipeline.js` — `evaluateBar(ctx, account) → {signal, decision}`
- `src/agents/RiskPolicy.js` — extended in place (leverage path)
- `backtest/` — execution shell, downloader, runner, reporting
- `market_data.db` — candles + funding + contract specs (via a repository interface)

## 4. SignalAdapter — each indicator → `Signal`

One pure mapper per logic type, dispatched by `logicType` (mirrors
`IndicatorManager.calculate`). The mapper consumes the indicator's existing output;
it does not recompute indicators.

| Indicator | Side rule | conviction (transparent v1 scheme) | invalidation |
|---|---|---|---|
| **SMC** | `structure.trend` 1→BUY, -1→SELL, 0→HOLD | 0.6 base; +0.2 if BOS/CHoCH event; +0.1 order-block confluence | structure break price |
| **WaveTrend** (new) | `wtCrossUp`→BUY, `wtCrossDown`→SELL, else HOLD | 0.5 base; +0.2 MFI aligned; +0.15 StochRSI not against; +0.15 STC | wt1/wt2 cross back |
| **Breakout** | only if `channel.active`: close>top→BUY, close<bottom→SELL, inside→HOLD | 0.55 base; + breakout distance / channel width (cap 0.9) | opposite channel edge |
| **Reversal** | `rejection` bullish→BUY, bearish→SELL, else HOLD (reversal logic) | 0.5 base; +0.25 if `recentFVG` aligns; +0.15 wick strength | pin-bar low/high |

Intentional behavior changes (asserted explicitly in characterization tests):
1. Neutral → `HOLD` (not `BUY`) — fixes the legacy no-signal-trades-BUY bug.
2. WaveTrend gains a real side mapping (was absent).
3. Reversal uses `rejection` logic (not naive `last>prev`).

`conviction` weighting is deliberately simple in v1 (so characterization tests stay
meaningful); calibration is deferred and will be informed by backtest results.

## 5. Pure pipeline & RiskPolicy futures extension

```js
// pure, deterministic
function evaluateBar(ctx /*StrategyContext*/, account /*AccountState*/) {
  const price  = ctx.candles.at(-1).close;
  const raw    = IndicatorManager.calculate(ctx.config.logicType, ctx.candles); // untouched
  const signal = SignalAdapter.derive(ctx.config.logicType, raw, { price, candles: ctx.candles });
  const decision = RiskPolicy.evaluate(signal, { entryPrice: price, ...account });
  return { signal, decision };
}
```

RiskPolicy additions, active **only when `leverage > 1`**:
- accept `leverage`; compute `marginUSD = sizeUSD / leverage` into `Order`.
- **margin gate:** `marginUSD ≤ free equity` else DENY.
- **margin-based heat** when leveraged (`Σ margin / equity`), so a 5x position does
  not trip a notional-based heat cap falsely.
- **"SL inside liquidation" gate:** estimate liquidation price from `leverage` + MMR;
  DENY/warn if SL would sit beyond liquidation.

**Parity guarantee:** the `leverage = 1` (spot) path is byte-for-byte identical to
today — same notional sizing, same heat, no new gates. Futures additions are dormant
at `leverage = 1`, so characterization tests on current AI-agent spot behavior stay green.

RiskPolicy returns SL/TP as **absolute price levels** off the reference (close) price.
Slippage in the shell affects the *entry fill* cost, not the decided SL/TP levels.

`riskPerTrade` keeps its current semantics (fraction of equity as notional) for
parity; true risk-based sizing (size from SL distance) is a deliberate later step.

## 6. Execution shell — BitGet futures model

**Fills (bar-by-bar, no look-ahead):**
- Entry: decided on close of bar `i`, filled at **open of bar `i+1`**, with slippage.
- Exits per bar, priority **SL → TP → liquidation**, after first checking a **gap on
  the open** (if open is already beyond a level, exit at open). The "SL inside
  liquidation" gate ensures SL triggers before liquidation on the way adverse;
  liquidation triggers only if no SL / SL beyond liquidation.

**Costs:**
| Cost | v1 model | Source |
|---|---|---|
| Fee | taker/maker on notional, per side (bot = market = taker ~0.06%; configurable) | BitGet constants |
| Slippage | fixed bps on market fills (entry/SL/liquidation); none/optional on TP (limit); default ~5 bps | config; volatility mode later |
| Funding | every 8h (00/08/16 UTC): `notional × rate`, signed by side; accrues on equity while open | BitGet historical funding; constant fallback |

**Liquidation (isolated margin):**
- `margin = notional / leverage` reserved at entry.
- liq price from entry, leverage, side, MMR (long ≈ `entry × (1 − 1/leverage + MMR)`).
- on trigger: closed at liq price, **loss = full margin** (+ liq fee); isolated, so loss is capped at margin.

**Equity accounting (isolated):** entry moves margin out of free equity; PnL accrues on
notional; on close `realized = side·(exit−entry)/entry·notional − fees − funding`,
margin + PnL returned; on liquidation margin is lost.

**Position exits:** SL, TP, liquidation; close-on-opposite-signal is a config flag
(default on); reversal is optional/later.

**Spot mode** = degenerate futures with `leverage = 1`, no funding, no liquidation.

**Explicit v1 approximations (labeled; all conservative or neutral):**
1. Isolated margin only (cross-margin later).
2. One position per instance, single entry (DCA/pyramiding later).
3. Single-tier MMR per symbol (BitGet tiered MMR later).
4. Liquidation on candle (last) price, not mark price (small divergence, noted).

## 7. Strategy model — container vs execution unit

Resolves the engineering/UX tension by separating two levels:

- **Execution unit = one-symbol Strategy instance.** Maps 1:1 onto the pure core
  (single-symbol candles). Isolated risk, clean P&L, faithfully backtestable.
- **User-facing Strategy = a container:** logic template + **watchlist** of symbols +
  shared risk config. It owns N instances (one per symbol).

The UI **rolls up** instances under the parent Strategy: aggregate equity/P&L, all
open positions across symbols, all trades in one list — the unified view the user
manages. Per-symbol drill-down is available (more insight, e.g. "SMC scalp works on
BTC, not LTC").

This already exists in embryo: `ai_strategies.watchlist` + `symbolsToWatch` + the
orchestrator's per-symbol loop. We formalize each symbol-iteration as an instance on
the shared core; the roll-up is the aggregation.

The parent Strategy is the natural home for the **portfolio-level risk layer**
(shared heat across correlated instances) — deferred to a later phase, but this is
where it belongs.

## 8. Data layer

Three datasets, all from BitGet (we backtest on the venue we trade):

| Dataset | What | Source |
|---|---|---|
| Candles OHLCV | per symbol × timeframe | BitGet futures klines (Binance fallback / cross-check) |
| Funding history | rate every 8h per symbol | BitGet historical funding |
| Contract specs | MMR, max leverage, tick/step, precision | BitGet contract config |

**Storage:** dedicated `market_data.db` (SQLite), separate from `trading_lab.db` /
`ai_trading.db`. Market data is large, append-only, analytical; keeping it out of the
operational DBs keeps them lean and backups simple. Access via a **repository
interface** (`MarketDataRepo`) so the backend is swappable.

```sql
candles(symbol, timeframe, time INTEGER, open, high, low, close, volume,
        PRIMARY KEY(symbol, timeframe, time));
funding_rates(symbol, time INTEGER, rate REAL, PRIMARY KEY(symbol, time));
contract_specs(symbol PRIMARY KEY, mmr, max_leverage, tick_size, qty_step,
               price_precision, qty_precision, updated_at);
```

**Downloader CLI** (modeled on freqtrade `download-data` — the one decoupled idea we
borrow):
`node backtest/download-data.js --symbol BTCUSDT,ETHUSDT,... --tf 1h --from 2024-01-01`
- incremental + idempotent (`INSERT OR IGNORE`), paginated, multi-symbol;
- pagination logic graduates from the spike, on BitGet via existing `BitGetService` +
  `node-fetch` (no new deps);
- `--verify`: gap detection, dedup, validation (no zero/negative prices). Honest
  backtests require clean data.

`ccxt` as a multi-exchange source is a future option, not in v1.

## 9. Metrics & reporting

Per-run metrics:
| Group | Metrics |
|---|---|
| Return | net PnL (USD + %), final equity, CAGR |
| Risk | max drawdown %, drawdown duration, Sharpe, Sortino, Calmar |
| Trades | count, win rate, profit factor, expectancy (avg R), avg win/loss, avg hold time, exposure % |
| **Costs** | total fees, total funding (+/−), liquidation count, slippage cost |
| Breakdown | long vs short separately |

The Costs group is mandatory: on leveraged futures, fees + funding + liquidations eat
the edge and must be visible, or results lie.

**Persistence (via the repository interface):** `backtest_runs` (metadata: strategy,
symbol, tf, period, params, leverage, cost config, timestamp) + `backtest_trades`
(per-trade log) + computed metrics; equity curve persisted for dashboard charting
(conceptually like `ai_equity_snapshots`). CLI prints a summary; optional JSON export.

**Matrix runs:** the runner sweeps `{logic templates} × {symbols} × {timeframes}` →
N one-symbol instances → N runs → a comparison matrix (the robustness test the user wants).

**Deferred (explicit later phases):** portfolio shared-capital backtest; Monte
Carlo / bootstrap significance; parameter optimization (grid/hyperopt) and
walk-forward.

## 10. Migration plan (phased; each phase = green checkpoint = commit)

| Phase | Work | Touches live? |
|---|---|---|
| 0. Contracts | JSDoc typedefs; no behavior | no |
| 1. Pure core | SignalAdapter (4 indicators) + `evaluateBar`, unit tests on candle fixtures; RiskPolicy as-is (leverage=1) | no |
| 2. Data layer | `market_data.db` + `MarketDataRepo` + BitGet downloader + `--verify`; backfill BTC/ETH/LTC/BNB | no |
| 3. Backtest shell (spot) | walk-forward engine over the core, fills/fees/slippage at leverage=1; reproduce the spike's SMC result through the real pipeline; metrics + persistence | no |
| 4. Futures | RiskPolicy leverage path + shell margin/funding/liquidation; scenario tests | no |
| 5. Runner + reporting | `logic × symbol × tf` matrix, equity curves, dashboard-readable results | no |
| 6. Characterization + live migration | golden-master tests; wire AI agent (and then manual `bot_engine`) to the core behind a flag | **yes, flagged** |

**Characterization tests:** record what the OLD code decides on fixed candle windows;
assert the NEW core matches **except** the three documented intentional changes
(neutral→HOLD, WaveTrend mapping, Reversal logic).

**Feature flags:** `USE_SIGNAL_CORE` for the AI agent (default OFF); a parallel flag
for the manual `bot_engine` path. OFF = current behavior, instant rollback. Existing
manual strategy configs (e.g. SMC + Aggressive) keep accumulating stats as today
until the flag is flipped.

**Manual path:** unified onto the core (it is actively traded and must be faithfully
backtestable → backtest and live must decide identically). Done in/after Phase 6,
flagged, under its own characterization tests.

**Merge gate:** `feat/signal-core` → `feat/trading-agent-ai-flow` only when all unit +
characterization tests are green, the futures sim is validated, and flags default OFF
(merging does not change live behavior until explicitly enabled).

**Testing layers:** unit (adapters, RiskPolicy futures math, shell scenarios, metrics)
· characterization (old↔new with documented diffs) · integration (full run on real
data, reproducible) · determinism (same input → same output; no `Date.now`/random in core).

## 11. Database strategy (out of scope for this refactor)

SQLite is retained. The pure core touches no DB; new data access sits behind a
repository interface, making a future SQLite→Postgres swap a single-adapter change.
Postgres is justified only by (a) ephemeral cloud FS, (b) many concurrent writer
processes, or (c) multi-instance scaling — none decided yet (`railway.json` is
inherited from the upstream public repo, not a committed deployment choice). 24/7
operation needs an always-on host with a persistent disk, **not** necessarily
Postgres. Postgres migration, if needed, is a separate sequenced project; `market_data`
stays SQLite (or TimescaleDB at large scale) regardless.

## 12. Non-goals (v1)

Cross-margin; DCA/pyramiding; tiered MMR; mark-price liquidation; portfolio
shared-capital backtest; Monte Carlo / significance testing; parameter optimization /
walk-forward; Postgres migration; true risk-based (SL-distance) sizing; `ccxt`
multi-exchange data.
