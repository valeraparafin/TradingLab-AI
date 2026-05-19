# Technical Specification: VMC Cipher B Strategy Integration

This document defines the technical implementation of the VMC Cipher B strategy into the Trading Lab bot engine.

## 1. Indicator Implementation (Indicators Object)

To support VMC Cipher B, the following calculations must be added to the `Indicators` object in `bot_engine.js`.

### 1.1 WaveTrend (WT)
- **Logic:**
    1. `ESA = EMA(hlc3, channelLength)`
    2. `D = EMA(abs(hlc3 - ESA), channelLength)`
    3. `CI = (hlc3 - ESA) / (0.015 * D)`
    4. `WT1 = EMA(CI, averageLength)`
    5. `WT2 = SMA(WT1, malen)`
- **Output:** `{ wt1, wt2, vwap: wt1 - wt2 }`

### 1.2 Money Flow Index (MFI)
- **Logic:**
    1. `Typical Price = (high + low + close) / 3`
    2. `Raw Money Flow = Typical Price * Volume`
    3. `Positive MF = Sum of Raw MF on days where Typical Price > prev Typical Price`
    4. `Negative MF = Sum of Raw MF on days where Typical Price < prev Typical Price`
    5. `MFI = 100 - (100 / (1 + (Positive MF / Negative MF)))`
- **Output:** `mfiValue` (0-100)

### 1.3 Stochastic RSI
- **Logic:**
    1. `RSI = RSI(close, rsiLen)`
    2. `StochRSI = (RSI - Lowest(RSI, len)) / (Highest(RSI, len) - Lowest(RSI, len))`
    3. `K = SMA(StochRSI, smoothK)`
    4. `D = SMA(K, smoothD)`
- **Output:** `{ k, d }`

### 1.4 Schaff Trend Cycle (STC)
- **Logic:**
    1. Calculate MACD (Fast EMA - Slow EMA).
    2. Apply Stochastic to MACD $\rightarrow$ smoothed result.
    3. Apply second Stochastic to the first smoothed result.
- **Output:** `stcValue` (0-100)

---

## 2. Execution Logic (LogicExecutors)

A new executor `VMC_CipherB` will be added to `LogicExecutors`.

```javascript
'VMC_CipherB': (candles, config) => {
    const wt = Indicators.calcWaveTrend(candles, config.wtLen, config.wtAvg);
    const mfi = Indicators.calcMFI(candles, config.mfiLen);
    const stochRsi = Indicators.calcStochRSI(candles, config.stochLen);
    const stc = Indicators.calcSTC(candles, config.stcFast, config.stcSlow);
    
    return { 
        wt, 
        mfi, 
        stochRsi, 
        stc,
        // Pre-calculate crossovers for validators
        wtCrossUp: wt.wt1 > wt.wt2 && candles[candles.length-2].wt1 <= candles[candles.length-2].wt2,
        wtCrossDown: wt.wt1 < wt.wt2 && candles[candles.length-2].wt1 >= candles[candles.length-2].wt2
    };
}
```

---

## 3. Safety Validators (SafetyValidators)

New validators to be added to the `SafetyValidators` object:

| Validator ID | Logic | Label |
| :--- | :--- | :--- |
| `wt_oversold` | `data.wt.wt2 <= -53` | WaveTrend Oversold |
| `wt_overbought` | `data.wt.wt2 >= 53` | WaveTrend Overbought |
| `wt_cross_up` | `data.wtCrossUp === true` | WT Bullish Cross |
| `wt_cross_down` | `data.wtCrossDown === true` | WT Bearish Cross |
| `mfi_bullish` | `data.mfi > 50` (or based on Area) | MFI Bullish Flow |
| `mfi_bearish` | `data.mfi < 50` | MFI Bearish Flow |
| `stoch_rsi_oversold` | `data.stochRsi.k < 20` | Stoch RSI Oversold |
| `stc_bullish` | `data.stc > 25 && data.stc_prev < 25` | STC Cycle Bottom |
| `sommi_diamond_bull` | `data.htf_candles_bullish && data.wt_cross_up` | Sommi Bullish Diamond |

---

## 4. Template Structure

### Logic Template (`templates/logic/vmc_cipherb.json`)
```json
{
  "type": "VMC_CipherB",
  "indicators": {
    "wtLen": 9, "wtAvg": 12, "mfiLen": 60, "stochLen": 14, "stcFast": 23, "stcSlow": 50
  },
  "safety_checks": [
    { "id": "wt_cross_up", "required": "True" },
    { "id": "wt_oversold", "required": "True" },
    { "id": "mfi_bullish", "required": "True" }
  ]
}
```

### Risk Template (`templates/risk/vmc_cipherb.json`)
```json
{
  "riskPerTradePercent": 0.01,
  "stopLossPercent": 0.02,
  "takeProfitPercent": 0.05,
  "maxTradesPerDay": 3
}
```

---

## 5. Implementation Plan

1. **Step 1:** Add `Indicators.calcWaveTrend`, `calcMFI`, `calcStochRSI`, `calcSTC`.
2. **Step 2:** Implement `LogicExecutors.VMC_CipherB`.
3. **Step 3:** Add the set of `SafetyValidators` for VMC.
4. **Step 4:** Create the JSON templates in `/templates`.
5. **Step 5:** Verify with a test strategy file.
