# Portfolio Value Configuration Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `PORTFOLIO_VALUE_USD` from `.env` to explicit strategy-specific risk configurations in JSON templates and the UI.

**Architecture:** Remove global environment variable dependency. Introduce `portfolioValue` into risk templates and strategy configs. Implement strict validation in the bot engine to ensure no strategy runs without an explicit deposit value.

**Tech Stack:** Node.js, React, TypeScript, JSON.

---

## File Mapping

- **Modify:** `templates/risk/*.json` (All risk templates) - Add `portfolioValue` to `settings`.
- **Modify:** `bot_engine.js` - Remove `process.env` dependency and add strict validation.
- **Modify:** `bot.js` - Remove `process.env` dependency.
- **Modify:** `frontend/src/components/StrategyConfigForm.tsx` - Add UI field and state management for `portfolioValue`.
- **Modify:** `.env.example` - Remove `PORTFOLIO_VALUE_USD`.

---

## Implementation Tasks

### Task 1: Update Risk Templates
**Files:**
- Modify: `templates/risk/aggressive.json`
- Modify: `templates/risk/conservative.json`
- Modify: `templates/risk/conservative_growth.json`
- Modify: `templates/risk/default_risk.json`
- Modify: `templates/risk/scalp_alts.json`
- Modify: `templates/risk/scalp_majors.json`
- Modify: `templates/risk/scalping_fast.json`
- Modify: `templates/risk/vmc_cipherb.json`
- Modify: `templates/risk/vmc_scalping.json`
- Modify: `templates/risk/yt1_reversal.json`

- [ ] **Step 1: Add `portfolioValue: 1000` to the `settings` object in all listed JSON files.**
  Example for `default_risk.json`:
  ```json
  {
    "settings": {
      "portfolioValue": 1000,
      "maxTradeSizeUSD": 100,
      ...
    }
  }
  ```
- [ ] **Step 2: Commit changes**
  ```bash
  git add templates/risk/*.json
  git commit -m "feat: add portfolioValue to risk templates"
  ```

### Task 2: Backend Engine Strict Validation
**Files:**
- Modify: `bot_engine.js`

- [ ] **Step 1: Remove `process.env.PORTFOLIO_VALUE_USD` dependency.**
  Find: `portfolioValue: parseFloat(process.env.PORTFOLIO_VALUE_USD || "1000"),`
  Replace with: `portfolioValue: config.portfolioValue,` (or the relevant config path).

- [ ] **Step 2: Implement strict validation check at the start of the engine.**
  Add check:
  ```javascript
  if (!config.portfolioValue || config.portfolioValue <= 0) {
    throw new Error("CRITICAL ERROR: portfolioValue is missing or invalid. Please configure the deposit size in the Strategy Risk settings.");
  }
  ```

- [ ] **Step 3: Run a test launch of the bot with a strategy missing `portfolioValue` to verify the critical error.**
  Expected: Bot crashes immediately with the specified error message.

- [ ] **Step 4: Commit changes**
  ```bash
  git add bot_engine.js
  git commit -m "feat: implement strict portfolioValue validation in bot_engine"
  ```

### Task 3: Backend Bot Entry Point Cleanup
**Files:**
- Modify: `bot.js`

- [ ] **Step 1: Remove `process.env.PORTFOLIO_VALUE_USD` usage.**
  Remove references and fallbacks to `1000` in `bot.js`. Ensure `portfolioValue` is passed from the strategy config.

- [ ] **Step 2: Commit changes**
  ```bash
  git add bot.js
  git commit -m "chore: remove portfolioValue fallback from bot.js"
  ```

### Task 4: Frontend UI Integration
**Files:**
- Modify: `frontend/src/components/StrategyConfigForm.tsx`

- [ ] **Step 1: Add `portfolioValue` to form state.**
  ```typescript
  const [portfolioValue, setPortfolioValue] = useState(1000);
  ```

- [ ] **Step 2: Update `useEffect` to load `portfolioValue`.**
  ```typescript
  setPortfolioValue(config.riskOverrides?.portfolioValue || config.risk?.portfolioValue || 1000);
  ```

- [ ] **Step 3: Add "Portfolio Value (USD)" input field to the JSX.**
  Place it above "Max Trade Size (USD)":
  ```tsx
  <div>
    <label className="block text-xs font-medium mb-1">Portfolio Value (USD)</label>
    <input
      type="number"
      className="w-full p-2 rounded border bg-background text-sm"
      value={portfolioValue}
      onChange={e => setPortfolioValue(Number(e.target.value))}
    />
  </div>
  ```

- [ ] **Step 4: Update `handleSubmit` to include `portfolioValue` in the settings object.**
  ```typescript
  const settings = {
    portfolioValue: Number(portfolioValue),
    timeframe,
    ...
  };
  ```

- [ ] **Step 5: Commit changes**
  ```bash
  git add frontend/src/components/StrategyConfigForm.tsx
  git commit -m "feat: add portfolioValue field to StrategyConfigForm"
  ```

### Task 5: Environment Cleanup
**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Remove `PORTFOLIO_VALUE_USD` from `.env.example`.**

- [ ] **Step 2: Commit changes**
  ```bash
  git add .env.example
  git commit -m "chore: remove PORTFOLIO_VALUE_USD from .env.example"
  ```
