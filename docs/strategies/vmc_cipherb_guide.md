# VMC Cipher B Strategy Guide: Comprehensive Application Matrix

This guide provides the theoretical and practical framework for implementing the VMC Cipher B strategy within the Trading Lab bot. It transforms a complex visual indicator into a set of logical rules for automated execution.

## 1. Theoretical Basis & Indicator Psychology

### WaveTrend Oscillator (The Pulse)
- **What it is:** A smoothed momentum oscillator that identifies market "breathing" patterns (waves).
- **Psychology:** Represents the exhaustion of a move. When the WaveTrend is deeply oversold, the "selling panic" is peaking and a reversal is likely.
- **Vulnerability:** In "Parabolic" trends (strong moon-shots or crashes), WaveTrend can stay in the extreme zones for a long time, leading to "premature" reversal trades.
- **Bot Role:** Primary Trigger (Entry/Exit signal).

### Money Flow Index (MFI) (The Truth)
- **What it is:** A volume-weighted RSI. It measures if price movements are backed by actual money flow.
- **Psychology:** Detects "Smart Money" activity. Price can rise on low volume (retail trap), but MFI only rises when significant capital enters.
- **Vulnerability:** Can be erratic on low-liquidity "shitcoins" where a single large order skews the volume.
- **Bot Role:** Primary Filter (Confirmation).

### Stochastic RSI (The Precision)
- **What it is:** An oscillator of an oscillator. It measures the momentum of the RSI itself.
- **Psychology:** Identifies the exact moment of momentum shift. It is the "trigger finger" of the strategy.
- **Vulnerability:** Extremely noisy. Produces many false signals if used without a trend filter.
- **Bot Role:** Timing Optimizer (Precision Entry).

### Schaff Trend Cycle (STC) (The Phase)
- **What it is:** A double-smoothed stochastic of the MACD.
- **Psychology:** Identifies the current market phase (Accumulation $\rightarrow$ Markup $\rightarrow$ Distribution $\rightarrow$ Markdown).
- **Vulnerability:** Lagging compared to WaveTrend, though faster than MACD.
- **Bot Role:** Context Filter (Cycle Direction).

### Sommi-Signals (The High Conviction)
- **Flags:** Alignment of Momentum $\rightarrow$ Money Flow $\rightarrow$ Trend.
- **Diamonds:** Multi-Timeframe (MTF) Alignment. Confirms that the current signal is supported by the "Big Picture" (higher timeframes).
- **Bot Role:** Conviction Multiplier (Increase position size or decrease risk).

---

## 2. Application Matrix by Trading Style

Use this matrix to determine which indicators to activate in your `templates/logic/vmc_cipherb.json`.

| Style | Timeframes | Priority Indicators | Logic Flow | Goal |
| :--- | :--- | :--- | :--- | :--- |
| **Scalping** | 1m, 5m, 15m | `WaveTrend` $\rightarrow$ `Stoch RSI` $\rightarrow$ `MFI` | WT Cross $\rightarrow$ Stoch RSI Oversold $\rightarrow$ MFI Green $\rightarrow$ **BUY** | Quick Impulse (1-3% move) |
| **Day Trading** | 15m, 1h, 4h | `WaveTrend` $\rightarrow$ `MFI` $\rightarrow$ `STC` | WT Cross $\rightarrow$ MFI Confirmation $\rightarrow$ STC Bullish $\rightarrow$ **BUY** | Intraday Trend (5-15% move) |
| **Swing Trading** | 4h, 1D, 1W | `Sommi Diamonds` $\rightarrow$ `STC` $\rightarrow$ `WaveTrend` | Sommi Diamond (MTF) $\rightarrow$ STC Cycle Shift $\rightarrow$ WT Cross $\rightarrow$ **BUY** | Major Move (20%+ move) |

---

## 3. "Ideal Storm" Scenarios (High-Probability Setups)

### Setup A: "The Sniper" (Bottom Fishing)
*Best for: Finding the exact bottom of a correction.*
1. **WaveTrend:** Bullish Divergence detected (Price Lower Low, WT Higher Low).
2. **MFI:** Area turns from Red to Green (Money starts flowing back in).
3. **Stoch RSI:** Crosses above 20 from the bottom.
4. **Result:** High-probability reversal entry.

### Setup B: "The Tank" (Trend Following)
*Best for: Riding a powerful bull run.*
1. **STC:** Line is firmly above 50 (Bullish Cycle).
2. **Sommi Diamond:** Blue Diamond appears (Higher Timeframes are Bullish).
3. **WaveTrend:** Small pullback into the -50 zone followed by a Bullish Cross.
4. **Result:** High-conviction "Dip Buy" in a strong uptrend.

### Setup C: "The Trap" (Top Detection)
*Best for: Exiting longs or entering shorts.*
1. **Price:** Reaches a major resistance level.
2. **WaveTrend:** Bearish Divergence (Price Higher High, WT Lower High).
3. **MFI:** Turns Red while price is still rising (Hidden Distribution).
4. **STC:** Crosses below 75.
5. **Result:** High-probability top. Exit immediately.

---

## 4. JSON Template Configuration Guide

When building your `logic` template, map the scenarios above to `safety_checks`:

### For Scalping Template:
- `wt_cross_up`: Required
- `wt_oversold`: Required
- `stoch_rsi_oversold`: Required
- `mfi_bullish`: Required

### For Swing Template:
- `sommi_diamond_bullish`: Required (Highest Priority)
- `stc_bullish`: Required
- `wt_cross_up`: Required
- `mfi_bullish`: Optional (Confirmation)

## 5. Risk Management Alignment
- **Aggressive:** Use "Scalping" logic with a wider Stop Loss (2-3%) to allow for volatility.
- **Conservative:** Use "Swing" logic with a tight Stop Loss based on the last WaveTrend pivot.
