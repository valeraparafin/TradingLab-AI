# Design Spec: Portfolio Value Configuration Migration

**Date:** 2026-05-20
**Status:** Draft
**Topic:** Migration of `PORTFOLIO_VALUE_USD` from environment variables to strategy-specific risk configuration.

## 1. Problem Statement
Currently, the bot's portfolio value is managed via a global `.env` variable (`PORTFOLIO_VALUE_USD`). This prevents the system from supporting multiple strategies with different deposit sizes and introduces "hidden" magic numbers that can lead to configuration errors.

## 2. Objectives
- Remove all dependencies on `process.env.PORTFOLIO_VALUE_USD`.
- Make portfolio value an explicit, mandatory part of the risk configuration.
- Enable per-strategy portfolio value overrides.
- Update the UI to allow management of this value.
- Implement strict validation to prevent bot execution without a defined portfolio value.

## 3. Technical Design

### 3.1 Data Model Changes
- **Risk Templates (`templates/risk/*.json`):** 
  Add `portfolioValue` (number) to the `settings` object of every risk template.
- **Strategy Configuration:** 
  The strategy configuration object will now include `portfolioValue`. This value will be sourced from the selected risk template by default but can be overridden for a specific strategy.

### 3.2 Backend Logic (`bot_engine.js`, `bot.js`)
- **Removal of Fallbacks:** Delete all occurrences of `process.env.PORTFOLIO_VALUE_USD` and hardcoded defaults like `|| "1000"`.
- **Strict Validation:**
  At the start of the bot engine execution, a check will be performed:
  ```javascript
  if (!config.portfolioValue || config.portfolioValue <= 0) {
    throw new Error("CRITICAL ERROR: portfolioValue is missing or invalid. Please configure the deposit size in the Strategy Risk settings.");
  }
  ```
- **Execution Flow:** The orchestrator (`server.js`) will pass the `portfolioValue` from the database/config directly into the engine.

### 3.3 Frontend Changes (`StrategyConfigForm.tsx`)
- **State Management:** Add `portfolioValue` to the form's local state.
- **Dynamic Updates:** 
  When a risk template is selected, the `portfolioValue` field should update to match the template's value unless a specific override already exists for the strategy.
- **UI Layout:** 
  Add a numeric input field labeled "Portfolio Value (USD)" positioned above "Max Trade Size (USD)".
- **Data Submission:** Update the `handleSubmit` function to include `portfolioValue` in the settings object sent to the server.

## 4. Success Criteria
- [ ] No mentions of `PORTFOLIO_VALUE_USD` in `.env` or as a fallback in code.
- [ ] Bot fails to start with a clear error message if `portfolioValue` is missing.
- [ ] User can set and save a unique portfolio value for each strategy via the dashboard.
- [ ] Choosing a risk template correctly populates the portfolio value field.
