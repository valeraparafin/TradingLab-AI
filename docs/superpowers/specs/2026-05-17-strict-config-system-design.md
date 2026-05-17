# Design Spec: Strict Template-Driven Configuration System

**Date:** 2026-05-17
**Status:** Draft
**Topic:** Refactoring strategy configuration to use a strict Template + Overrides pattern to eliminate data duplication and configuration bugs.

## 1. Problem Statement

The current configuration system suffers from "data fragmentation." Settings (like `maxTradesPerDay`) are often duplicated both in a risk template and in the final strategy JSON. This leads to:
- **Symptom-based bugs**: The trading engine may read a default value (e.g., 3 trades/day) if the specific path in the JSON is missing or misnamed, even if the UI shows a different value.
- **Maintenance overhead**: Changing a global risk parameter requires updating every single strategy file.
- **Config Drift**: Strategy files become bloated with redundant data, making it hard to see what actually makes a strategy unique.

## 2. Proposed Architecture: The Layered Config Pattern

We will implement a **Configuration Layering** approach where the final configuration is a resolved view of a base template and specific overrides.

### 2.1 Data Model

#### A. Risk/Logic Templates (`/templates/{type}/*.json`)
Templates serve as the single source of truth for standards.
- **Structure**: `{ "name": string, "settings": Record<string, any> }`
- **Role**: Defines the default values for a specific profile (e.g., "Aggressive").

#### B. Strategy Instance (`/strategies/*.json`)
Strategy files will no longer store full copies of templates. They store only the "diff".
- **Structure**:
  - `riskTemplateId`: ID of the template to use.
  - `riskOverrides`: Only the fields that differ from the template.
  - `logicTemplateId`: ID of the logic template.
  - `logicOverrides`: Only the fields that differ from the template.
  - `generalSettings`: Watchlist, timeframe, etc.

#### C. Resolved Configuration (In-Memory)
The object used by the `bot_engine.js` at runtime.
- **Resolution Logic**: `Resolved = Merge(Template.settings, Strategy.Overrides)`

### 2.3 Data Flow

1. **UI Editing**:
   - The UI fetches the template and the current overrides.
   - The UI presents the "Resolved" values to the user.
   - When saving, the UI/Server calculates the delta and saves only the changed values into `riskOverrides`.

2. **Bot Startup**:
   - `bot_engine.js` loads the strategy JSON.
   - `bot_engine.js` loads the referenced templates from disk.
   - `bot_engine.js` performs a deep merge to create the final config.
   - The final config is validated via Zod.

## 3. Implementation Details

### 3.1 The Resolver
A new utility function `resolveConfig` will be implemented:
- Input: `strategyConfig` (with template IDs and overrides).
- Process: 
  1. Load templates $\to$ 2. Apply overrides $\to$ 3. Validate via Zod.
- Output: A complete, validated configuration object.

### 3.2 Zod Validation
To prevent "silent failures" (like the `|| 3` bug), we will implement strict schemas:
- If a required field (e.g., `maxTradesPerDay`) is missing from both the template and the overrides, the bot will **fail to start** with a clear error message instead of using a fallback.

### 3.3 Migration Strategy
To transition existing strategies without downtime:
1. **Migration Script**: A one-time utility will:
   - Read existing strategy JSONs.
   - Compare values with current templates.
   - Extract overrides.
   - Rewrite the strategy JSON in the new strict format.
   - Verify that `Resolved(New) === OldValues`.

## 4. Success Criteria

- [ ] `bot_engine.js` successfully resolves config from templates + overrides.
- [ ] Strategies in `/strategies` no longer contain redundant `risk` or `logic` objects.
- [ ] Changing a value in a template automatically updates all linked strategies.
- [ ] Attempting to start a bot with a missing required config field results in an explicit error.
- [ ] All existing strategies are migrated to the new format without loss of settings.
