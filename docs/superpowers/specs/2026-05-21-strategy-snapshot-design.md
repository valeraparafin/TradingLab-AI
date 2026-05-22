# Design Spec: Strategy Snapshot & Hybrid Configuration Decomposition

**Date:** 2026-05-21
**Status:** Finalized
**Topic:** Transition from template-based dynamic resolution to a snapshot model with decomposed risk parameters and a professional management UI.

## 1. Overview
The current system resolves strategy configurations at runtime by merging templates with overrides. This creates a dependency on filesystem-based templates and makes the system opaque. This spec implements a "Snapshot" model where each strategy stores its own complete, independent configuration in the database, with professional risk parameters decomposed into dedicated columns for strict typing, transparency, and analytics.

## 2. Database Architecture

### 2.1. `strategies` Table (Modification)
The `config` JSON blob is replaced by a specialized logic snapshot.
- **Modified Columns:**
    - `logic_config` (TEXT/JSON): Stores the complete snapshot of the trading logic (indicators, filters, rule parameters).
- **Retained Columns:** `id`, `name`, `status`, `is_archived`, `last_run`.

### 2.2. `strategy_risk_settings` Table (New)
A new table for professional risk management with a `1:1` relationship to `strategies`.

| Column | Type | Description |
| :--- | :--- | :--- |
| `strategy_id` | INTEGER (PK, FK) | Reference to `strategies(id)` |
| `risk_per_trade_percent` | REAL | % of portfolio risk per trade |
| `stop_loss_percent` | REAL | Hard stop-loss threshold |
| `take_profit_percent` | REAL | Hard take-profit threshold |
| `min_risk_reward_ratio` | REAL | Minimum acceptable Risk:Reward ratio |
| `max_portfolio_heat_percent` | REAL | Max total risk across all open positions |
| `max_open_positions` | INTEGER | Max number of concurrent positions |
| `max_trades_per_day` | INTEGER | Daily trade count limit |
| `daily_loss_limit_percent` | REAL | Portfolio loss threshold for daily halt |
| `daily_profit_target_percent` | REAL | Portfolio profit threshold for daily halt |
| `updated_at` | DATETIME | Timestamp of last modification |

## 3. Backend Logic & API

### 3.1. Validation Layer (Zod)
Two primary schemas ensure data integrity:
- **`RiskSettingsSchema`**: Strict validation for all professional risk parameters (e.g., `.positive()`, `.max(100)` for percentages).
- **`LogicConfigSchema`**: Flexible validation for the `logic_config` JSON, ensuring required structure based on strategy type.

### 3.2. API Endpoints

#### `POST /api/strategies` (The Snapshot Assembler)
1. Receives `logicTemplateId`, `riskTemplateId`, and `settings` (overrides).
2. Loads templates $\rightarrow$ Applies overrides $\rightarrow$ Generates full configuration.
3. **Transactionally** inserts into `strategies` and `strategy_risk_settings`.
4. Result: The strategy is now fully independent of the template files.

#### `PATCH /api/strategies/:id/risk` (Targeted Risk Update)
- Validates payload via `RiskSettingsSchema`.
- Updates specific columns in `strategy_risk_settings`.
- Triggers bot restart if strategy is `running`.

#### `PATCH /api/strategies/:id/logic` (Targeted Logic Update)
- Reads current `logic_config` $\rightarrow$ Merges updates $\rightarrow$ Validates via `LogicConfigSchema`.
- Updates `strategies.logic_config`.
- Triggers bot restart if strategy is `running`.

#### `GET /api/strategies/full-config/:id` (Bot Access)
- Joins `strategies` and `strategy_risk_settings`.
- Returns a unified, flat object for the `bot_engine` to consume.

## 4. User Interface (UI) Design

The UI is redesigned to avoid "Excel-fatigue" while providing professional control.

### 4.1. Page Structure
- **General Section**: Name, status toggle, archive button.
- **Risk Profile (Strict Form)**: 
    - A grid of typed inputs for the 10 professional risk parameters.
    - **Tooltips**: Every field has a `(?)` icon explaining the parameter (e.g., "Portfolio Heat" explanation).
    - **Immediate Feedback**: Zod-powered red borders for invalid inputs.
- **Trading Logic (Dynamic Form)**:
    - Grouped into collapsible accordions (e.g., `Indicators` $\rightarrow$ `Filters` $\rightarrow$ `Entry Rules`).
    - Dynamically generated inputs based on the `logic_config` structure.

### 4.2. UX Workflows
- **Restart Guard**: If strategy is `running`, a confirmation dialog appears before saving: *"Saving changes will restart the bot. Proceed?"*
- **Dirty State**: Visual indicator (e.g., "Unsaved Changes") appears when inputs differ from the DB state.
- **Origin Trace**: Display the name of the template used to create the snapshot for context.

## 5. Success Criteria
1. **Independence**: Changing a template file does NOT affect existing strategies.
2. **Integrity**: No invalid risk values (e.g., negative percentages) can enter the DB.
3. **Transparency**: Risk parameters are queryable via standard SQL without JSON parsing.
4. **Consistency**: UI changes are reflected in the bot's behavior after a restart.
