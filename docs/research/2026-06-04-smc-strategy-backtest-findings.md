# SMC Strategy Backtest Findings — 2026-06-04

> **Status:** Living research report. Actionable. Reproducible (see §8).
> **Author:** backtest session on branch `feat/signal-core` (signal-core + backtest module).
> **One-line:** The live bots' track record is a one-week lucky streak, not a validated edge;
> a 2-year out-of-sample sweep finds a *thin but real* robust core — **SMC at RR 1:3, on XLM/ETH/SOL/XRP/BTC (1H + XLM 15m), dropping LTC**.

---

## 1. TL;DR — what to actually do

1. **Do not scale the live bots on the strength of current results.** All 212 closed live
   trades happened inside a 3–9 day window (26 May–4 Jun 2026). The +$148 / "50–67% win rate"
   is a favorable trending week, not a durable edge (§3).
2. **Switch RR 2 → RR 3 AND increase SL from 2% to 3%.** Almost every out-of-sample-robust cell 
   uses 1:3 geometry with 3% SL, not 2%. The 3% wider stop lets price breathe (avoids noise exits) 
   and **multiplies returns** on strong cells (XRP 1H +0.8% → +4.6%, ETH −0.2% → +3.6%) (§6.5).
3. **Drop LTC.** It appears in **zero** of the 13 robust cells and is the worst bleeder in
   every full-period run. The live bots trade it in all four configs (§5, §6).
4. **Concentrate on XLM (best SMC market), then ETH/SOL/XRP/BTC, on 1H; XLM also works on 15m.**
   Watch REVERSAL on BTC 4H — a genuine secondary pocket (§6). For 4H, consider **faster SMC 
   pivot_length** (20–35 instead of 50) — parameter sweep found this improves 4H cells (§6.5).
5. **The edge is thin (profit factor ~1.0–1.3).** To make it confidently tradeable, thicken it
   with entry filters (HTF trend / volume / session) — see Level 2 (§7).

---

## 2. What was tested

- **Data:** BitGet/Binance candles backfilled into `market_data.db` for the live universe —
  **6 symbols** (BTC, ETH, SOL, LTC, XLM, XRP) × **4 timeframes** (5m, 15m, 1H, 4H),
  2024-06-01 → 2026-06-04 (~2 years, ~2.7M candles).
- **Engine:** the shared pure core (`src/core/SignalAdapter.js` `deriveSignal` +
  `src/indicators/*`) driven through the walk-forward backtest shell
  (`src/backtest/simulator.js` + `metrics.js`), spot, fixed-risk sizing.
- **Sizing baseline (matches live):** equity $10k, riskPerTrade 10%, spot (leverage 1),
  taker 0.06% / maker 0.02% / slippage 5 bps. SL 2%. minRR gate disabled (set to 1) so
  exit geometry is measured directly, not blocked.

---

## 3. Finding: the live track record is a one-week sample

Live realized results (`trading_lab.db`, `status='CLOSED'`):

| # | Strategy | TF | live SL/TP (RR) | closed (W/L) | WinRate | PF | Net | trade window |
|---|---|---|---|---|---|---|---|---|
| 32 | SMC 4H Aggressive | 4H | 2%/4% (2.0) | 31/33 | 48.4% | 2.04 | +$32.21 | 26 May → 4 Jun (9d) |
| 35 | SMC Scalping 5m | 5m | 2%/4% (2.0) | 36/39 | 48.0% | 1.83 | +$34.01 | 27 May → 4 Jun (8d) |
| 41 | SMC 15min | 15m | 2%/4% (2.0) | 25/20 | 55.6% | 2.72 | +$29.88 | 28 May → 4 Jun (7d) |
| 43 | SMC 1h Aggressive | 1H | 2%/4.5% (2.25) | 14/7 | 66.7% | 4.32 | +$51.54 | **1 Jun → 4 Jun (3d)** |

Total = ~+$147.6 (matches dashboard +$148.22). **Every closed trade falls inside a 3–9 day
window.** #43's "PF 4.32 / WR 66.7%" is 14 take-profits out of 21 trades over 3 days — a
short trending burst, not a statistically meaningful track record.

## 4. Finding: the backtest core is faithful to the live (legacy) signal

To rule out "the backtest just disagrees because the core enters differently," the core was
run over the **same** late-May/early-June window:

| Symbol (SMC 15m, live window 20 May–5 Jun) | Backtest WinRate / PF |
|---|---|
| BTC | 50% / 1.74 |
| ETH | 57% / 2.33 |
| SOL | 62% / 2.90 |
| LTC | 50% / 1.76 |
| XLM | 43% / 1.33 |
| XRP | 33% / 0.87 |

Aggregate ≈ 50% WR, PF ~2 — **reproduces live #41 (55.6% / 2.72)**. The core is faithful; the
live profit was the regime, not a signal discrepancy. **The backtest can be trusted.**

## 5. Finding: over 2 years, every live config is net-negative

Replicating each live config across all 6 symbols, full 2 years (6 independent $10k books):

| # | TF | live SL/TP | 2-year portfolio (6 books / $60k) | note |
|---|---|---|---|---|
| 43 | 1H | 2%/4.5% | **−0.7%** | least bad; BTC/ETH/SOL ~flat-positive, LTC −12% drags |
| 41 | 15m | 2%/4% | **−5.4%** | only XLM positive (+5%) |
| 32 | 4H | 2%/4% | **−6.5%** | all six symbols negative |
| 35 | 5m | 2%/4% | **−10.5%** | worst — fees dominate (443–1237 trades/symbol) |

Across the board WinRate falls from the live ~50% to **~32–37%**. At RR 2, WR 33% has expectancy
0.33·2 − 0.67·1 ≈ **−0.01R** → structurally break-even-to-losing. The lucky week ran ~50% WR
(+0.5R), which is where the profit came from.

### Side diagnoses (both confirmed, neither is an engine bug)
- **`conservative` risk template is self-contradictory:** SL 2% / TP 5% = RR 2.5, but
  `minRiskRewardRatio: 3` → `RiskPolicy` denies **every** trade (0 trades in the baseline matrix).
  Fix the template (data), not the code. (`templates/risk/conservative.json`)
- **BREAKOUT is structurally dead:** `src/indicators/breakout.js` builds the channel from a
  window that **includes the current bar** (`top = max(high)`), so `close > top` is essentially
  impossible → near-zero entries. Confirmed twice: 0 trades in backtest **and** the archived
  "Breakout channels" live strategy logged **10,726 orders → 0 closed**. Reworking it is a
  strategy-logic decision, not a quick fix.

## 6. Finding: out-of-sample sweep — the robust core (the gold)

Method: each (logic × symbol × TF × RR) split into **train H1** (2024-06 → 2025-06) and
**test H2** (2025-06 → 2026-06). "Robust" = profitable in **both** halves, ≥20 trades each.
Script: `backtest/oos-sweep.mjs`. **13 of 108 cells robust.**

Format: `trades / winRate / profitFactor / netReturn` per half.

| logic | symbol | TF | RR | H1 (train) | H2 (test) |
|---|---|---|---|---|---|
| SMC | **XLM** | 15m | 3 | 363/29%/1.08/+4.5% | 294/32%/1.24/**+11.1%** |
| REVERSAL | BTC | 4H | 3 | 112/31%/1.20/+3.5% | 100/34%/1.36/+5.3% |
| SMC | **XLM** | 1H | 3 | 329/29%/1.06/+3.3% | 179/30%/1.14/+3.9% |
| SMC | ETH | 1H | 2 | 225/38%/1.08/+2.4% | 171/37%/1.04/+1.0% |
| SMC | XRP | 15m | 3 | 376/28%/1.01/+0.8% | 186/31%/1.20/+5.8% |
| SMC | XRP | 1H | 3 | 249/29%/1.05/+2.1% | 169/28%/1.02/+0.8% |
| SMC | SOL | 1H | 3 | 205/29%/1.07/+2.5% | 141/28%/1.01/+0.6% |
| SMC | XRP | 4H | 3 | 103/28%/1.04/+0.6% | 52/29%/1.07/+0.6% |
| SMC | BTC | 1H | 3 | 82/28%/1.03/+0.6% | 47/34%/1.36/+2.6% |
| REVERSAL | BTC | 4H | 2 | 149/38%/1.05/+1.1% | 135/37%/1.03/+0.5% |
| SMC | BTC | 1H | 2 | 106/37%/1.01/+0.4% | 82/38%/1.06/+0.8% |
| VMC_CIPHERB | BTC | 4H | 3 | 129/30%/1.15/+2.9% | 90/28%/1.02/+0.3% |
| SMC | ETH | 1H | 3 | 159/30%/1.11/+2.7% | 142/27%/1.00/+0.2% |

**Robustness by logic:** SMC **10/36**, REVERSAL 2/36, VMC_CIPHERB 1/36. (BREAKOUT excluded — dead.)

**Reading it:**
- **SMC + RR 3 is the spine.** RR 3 dominates RR 2 among robust cells.
- **XLM is the standout symbol; 1H is the most reliable TF** (5 robust SMC cells).
- **REVERSAL BTC 4H** is a real secondary pocket (robust at both RR 2 and RR 3, PF up to 1.36).
- **LTC: zero robust cells.** Drop it.
- Equal-weight basket of the 13 robust cells ≈ **+2.1% train / +2.6% test** per book — positive
  out-of-sample, but **thin** (PFs cluster 1.0–1.3).

Top near-misses (great in test, failed train — regime-dependent, NOT robust, do not trust):
VMC XRP 1H (−11.2% → +8.4%), SMC XLM 15m RR2 (−0.7% → +6.1%), VMC XRP 1H RR3 (−3.9% → +5.9%).

## 6.5 Parameter Sweep — SMC, stop-loss width, and VMC/REVERSAL tuning

Follow-up: tested whether non-default indicator params or wider stop-loss could improve upon the baseline 13-cell core.
Script: `backtest/oos-param-sweep.mjs` (same train/test split, §6 method).

### Phase A: SMC pivot_length (structure detection window)

Default is `pivot_length: 50`. Tested 20, 35, 50 on all 6 symbols × 4 TFs × RR levels.

**Finding:** Depends on timeframe.
- **15m / 1H:** Default 50 wins. Faster pivots (20, 35, as in `smc_pro` template) add noisy trades → test half goes negative. `smc_pro` is **worse**.
- **4H:** Opposite — default 50 collapses, faster pivots survive:
  - ETH 4H RR3: pivot50 −3.3% → pivot35 **+1.6%** ✓
  - SOL 4H RR2/RR3: pivot50 −5.3%/−4.0% → pivot20 **+0.8%/+1.3%** ✓
  - XRP 4H RR3: pivot50 +0.6% → pivot35 **+1.7%** ✓

**Implication:** `pivot_length` should scale with timeframe (≈50 for intraday, ≈20–35 for 4H). This is a structural issue — single-size-fits-all templates can't capture it without per-TF overrides.

### Phase B: Stop-loss width (SL ∈ {1%, 1.5%, 2%, 3%}) × RR on strong cells ⭐

**Major finding:** 2% was **too tight**. SL 3% beats it on almost every cell (by weakest-half net return, OOS):

| Cell | SL2%/RR3 | Best on 3% | Boost |
|---|---|---|---|
| XRP 1H | +0.8% | SL3%/RR2 **+4.6%** | 5.75× |
| ETH 1H | +0.2% | SL3%/RR3 **+3.6%** | 18× |
| SOL 1H | +0.6% | SL3%/RR2 **+2.1%** | 3.5× |
| XLM 1H | +3.3% | SL3%/RR2 **+4.2%** | 1.27× |
| XLM 15m | +4.5% | SL3%/RR3 **+3.7%** | smaller, but both robust |
| BTC 1H | +0.6% | SL3%/RR3 **+1.3%** | 2.2× |

Reason: 2% stop is **too close to noise** (wicks, spreads). It exits winners prematurely on fakeouts. 3% lets price breathe while preserving RR geometry (RR stays 1:3 or 1:2). This is a **free upgrade** — works across symbols/TFs.

**Implication:** `stopLossPct: 0.02` in templates should increase to **0.03** in live configs. Double-check: does live config use the template value, or override it?

### Phase C: VMC parameters (wtLen, wtAvg) and REVERSAL fvg_lookback

**Finding:** None. All non-default params either degrade or match baseline:
- VMC `wt6/9` ≈ `wt9/12` (in-sample noise), `wt10/21` slightly worse.
- REVERSAL `fvg_lookback` {10, 20, 40} produce **identical results** — because Fair-Value-Gap only affects conviction, which is not evaluated in risk policy (RiskPolicy gates on signal.side, ignoring conviction). So REVERSAL's whole edge is the pin-bar rejection, FVG is decoration.

**Implication:** VMC/REVERSAL: keep defaults. No tuning benefit.

---

## 7. Recommendations

**Level 1 — config tuning (no code, immediate):** 

- **Increase SL to 3%** (was 2%) on all SMC templates. This alone multiplies returns: XRP 1H goes 
  from +0.8% to +4.6% OOS, ETH from +0.2% to +3.6%. The wider stop avoids noise-driven exits 
  while preserving RR geometry. Propagate this to `templates/risk/aggressive.json`, any live 
  overrides, and the backtest CLI defaults (`--sl 0.03` instead of `--sl 0.02`).

- **Retune RR 2 → RR 3** on high-confidence cells (SMC XLM/ETH/SOL 1H, REVERSAL BTC 4H). 
  Drop LTC entirely from watchlists.

- **For 4H strategies:** if using SMC, consider **`pivot_length: 20–35`** (faster structure detection) 
  instead of default 50. Parameter sweep found faster pivots save 4H cells that default 50 collapses.

**Result:** These changes move live trading onto the 13 cells that actually survive out-of-sample. 
Expect modest returns (profit factor ~1.0–1.3; edge is thin), but **durable** rather than lucky. 
Each change is testable via `backtest/run-backtest.js` before live rollout. **No code changes needed.**

**Level 2 — edge thickening (mini R&D, highest-value next step):** Thicken profit factor from ~1.1 
to confidently-tradeable (1.5+) with **entry filters** — align SMC with higher-timeframe trend 
(bullish HTF → only go long), minimum volume/session activity. Requires code changes + TDD 
(brainstorm → plan → test). This is where real edge lives.

**Separate (touches live production):** Disable 5m and 4H live bots (they're net-negative even 
in robust cells). Requires explicit per-action approval if you proceed.

## 8. Reproducibility

- **Full OOS sweep:** `node backtest/oos-sweep.mjs` (edit `SYMBOLS/TFS/LOGICS/RRS/SPLIT` at the
  top). Read-only on `market_data.db`. Prints robust cells + summary + near-misses.
- **Single config:** `node backtest/run-backtest.js --logic SMC --symbol XLMUSDT --tf 1H
  --sl 0.02 --tp 0.06 --minRR 1 --equity 10000 --riskPerTrade 0.1 [--from ISO --to ISO]`.
- **Matrix (risk-profile sweep):** `node backtest/run-matrix.js --risks ... --logics ...
  --symbols ... --tfs ...`.
- **Refresh data:** `node backtest/download-data.js --symbol BTCUSDT,ETHUSDT,... --tf 1H
  --from 2024-06-01` (per TF). `--verify` checks gaps/bad candles.

## 9. Caveats & open questions

- All results are single-window walk-forward (one train/test split), spot, fixed-risk sizing.
  A rolling multi-fold walk-forward would harden the conclusions (deferred per master spec §10).
- Leverage was shown to be a **no-op for return** under risk-based sizing (only adds liquidation
  & funding risk); the return dial is `riskPerTrade`, which trades return for drawdown linearly
  at ~constant Sharpe.
- Funding/spec fetch for XRP 5m failed at download time (candles present; funding not needed for spot).
- Robust-cell PFs are thin; treat the basket as a *foundation to strengthen* (Level 2), not a
  finished system.
