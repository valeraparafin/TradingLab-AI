# Research Report: SMC Strategy Optimization (June 2026)

## 1. Objective
The primary goal of this experiment is to identify the root causes of losses in Smart Money Concepts (SMC) strategies and implement systematic improvements to increase the WinRate and reduce Maximum Drawdown, specifically on lower timeframes (5m, 15m).

## 2. Scope
- **Target Strategies:** IDs 32, 35, 41, 43.
- **Core Logics:** `smc` (Standard) and `smc_pro` (Professional Scalping).
- **Timeframes Analyzed:** 5m, 15m, 1H, 4H.
- **Metrics:** WinRate, Net PnL, Max Drawdown (MaxDD).

## 3. Initial Observations (Live Analysis)
Initial review of losing trades revealed a pattern of "Entry on Touch" failures. Price often enters a Point of Interest (POI) / Order Block (OB), triggers a trade, but then breaks through the zone (stop-hunt) before reversing or continuing the trend.

## 4. Backtest Matrix Results
A comprehensive matrix sweep was conducted across 30+ symbols to compare the baseline logic against three key hypotheses.

### Summary Comparison Table
| Hypothesis | WinRate | Max Drawdown | PnL | Verdict |
| :--- | :---: | :---: | :---: | :--- |
| **Baseline** | 📉 Low | ⚠️ Medium | 😐 Average | Unstable on LTF (5m/15m) |
| **+ HTF Bias** | 🚀 **High** | ✅ **Reduced** | 📈 **Growth** | **Critical Improvement (Must Have)** |
| **+ Break-Even** | ↗️ Slight Increase | ✅ **Reduced** | ↘️ Decrease | Defensive (Optional, needs tuning) |
| **+ ATR Stop** | ↗️ Slight Increase | ➡️ Stable | ➡️ Stable | Recommended for volatility adaptivity |

### Key Findings:
- **HTF Bias:** The most significant boost. Filtering LTF trades to align with the 1H/4H trend eliminates a vast majority of "counter-trend" losses.
- **ATR Stops:** Reduces "noise-outs" where fixed % stops were too tight for specific asset volatility.
- **Break-Even:** Protects capital but frequently cuts winning trades too early, reducing overall PnL.

## 5. Configuration Audit: Standard vs. Professional
A deep dive into the JSON configurations revealed a critical misunderstanding of the "Professional Scalping" variant.

### Comparison
- **SMC Standard:** `pivot_length: 50`. Slow, stable structure detection.
- **SMC Professional:** `pivot_length: 20`. Fast, aggressive structure detection.

**Conclusion:** The "Professional" config is actually an **Aggressive** config. By reducing the pivot length to 20, the strategy detects "Break of Structure" (BOS) much more frequently, including market noise. On 5m/15m, this leads to a high frequency of false signals, explaining the high failure rate of strategies 35 and 41.

## 6. Final Conclusions & Action Plan
Based on the data, the "Professional" approach is currently too aggressive and lacks confirmation.

### Approved Roadmap:
1. **Phase 1 (Data-Driven):** Implement **HTF Bias** and **ATR Stop Loss** as the new baseline.
2. **Phase 2 (Precision):** Implement **CHoCH (Change of Character)** confirmation. Instead of "Entry on Touch," the engine must wait for a structural break on a lower timeframe within the POI.
3. **Phase 3 (Refinement):** Fine-tune **Break-Even (BE)** coefficients based on asset-specific volatility.

---
**Status:** $\text{In Progress}$
**Date:** 2026-06-14
