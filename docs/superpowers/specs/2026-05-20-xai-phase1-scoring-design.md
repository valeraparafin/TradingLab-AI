# Design Spec: XAI Phase 1 - Quantitative Scoring Framework

**Date:** 2026-05-20
**Status:** Draft
**Topic:** Transition from binary safety checks to a quantitative Confidence Index.

## 1. Overview
The current safety validation system in `src/validators/safety-rules.js` uses binary logic (`pass: true/false`). While effective for blocking trades, it provides no insight into how "close" a signal was to being valid. This spec defines a framework to introduce a `score` (0.0 to 1.0) for every check, aggregating them into a Global Confidence Index (GCI).

## 2. Scoring Rubric

Each validator function will be updated to return an object containing both `pass` (for backward compatibility) and `score`.

### 2.1 Numeric Thresholds (Fuzzy Logic)
For rules based on a value crossing a threshold (e.g., WaveTrend $\le -53$):
- **Ideal Zone:** Value meets the threshold $\rightarrow$ `score = 1.0`.
- **Buffer Zone:** Value is within a predefined range (e.g., 20 units) of the threshold $\rightarrow$ `score` linearly decays from `1.0` to `0.0`.
- **Fail Zone:** Value is outside the buffer zone $\rightarrow$ `score = 0.0`.

**Formula:**
`score = Math.max(0, 1 - (abs(actual - threshold) / buffer))`

### 2.2 Categorical/State Values
For rules based on states (e.g., Trend: Bullish/Bearish/Neutral):
- **Perfect Match:** (e.g., Bullish for a Long trade) $\rightarrow$ `score = 1.0`.
- **Neutral/Ambiguous:** (e.g., Neutral) $\rightarrow$ `score = 0.5`.
- **Contradiction:** (e.g., Bearish for a Long trade) $\rightarrow$ `score = 0.0`.

### 2.3 Binary Flags
For absolute requirements (e.g., `!!rejection`):
- **Present:** `score = 1.0`.
- **Absent:** `score = 0.0`.

## 3. Aggregation Logic (GCI)

The `bot_engine.js` will aggregate individual scores into a **Global Confidence Index (GCI)**.

### 3.1 Weighted Average
Not all rules are created equal. Rules are categorized as:
- **Critical Rules:** (e.g., Trend, Structure) $\rightarrow$ High Weight (e.g., 2.0).
- **Support Rules:** (e.g., MFI, StochRSI) $\rightarrow$ Low Weight (e.g the 0.5).

**Formula:**
$$\text{GCI} = \frac{\sum (\text{Score}_i \times \text{Weight}_i)}{\sum \text{Weight}_i}$$

### 3.2 The Hard Filter (Safety Guard)
To ensure zero risk of breaking current execution:
- The `allPass` boolean remains the primary trigger for trade execution.
- If `allPass === false`, the trade is blocked **regardless of the GCI value**.
- GCI is used for logging and (in future phases) for dynamic risk scaling.

## 4. Execution Integration

### 4.1 `src/validators/safety-rules.js`
Update all exported functions to return:
```typescript
{
  label: string,
  required: string,
  actual: string,
  pass: boolean,
  score: number // 0.0 to 1.0
}
```

### 4.2 `bot_engine.js`
1. After `safetyValidator.run()`, calculate the GCI.
2. Log the GCI alongside the `safety_check` event in the database.
3. Output the GCI to the console for real-time monitoring.

## 5. Proposed Risk Mapping (Future Phase)
Once GCI is validated, it will map to position size:
- **GCI < 0.5:** No Trade (already handled by `allPass`).
- **0.5 $\le$ GCI < 0.7:** Weak Conviction $\rightarrow$ 0.5% Risk.
- **0.7 $\le$ GCI < 0.9:** Strong Conviction $\rightarrow$ 1.0% Risk.
- **GCI $\ge$ 0.9:** Elite Conviction $\rightarrow$ 2.0% Risk.

## 6. Success Criteria
- **Execution Parity:** The bot opens/blocks the exact same trades as the current version.
- **Data Accuracy:** `score` and `GCI` are correctly calculated and stored in `events` table.
- **No Regressions:** No crashes in `bot_engine.js` due to the new scoring logic.
