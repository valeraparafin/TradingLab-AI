---
name: strategy-settings-refactor
description: Refactor the strategy settings UI to separate runtime tweaks from structural configuration, implementing a full-featured configuration panel.
type: project
---

# Strategy Settings Refactor Design

## Overview
The current strategy settings in `StrategyDetails.tsx` are incomplete and provide a poor user experience. This refactor separates "live" runtime adjustments from "structural" bot configuration, ensuring that all parameters available on the Dashboard are also available in the strategy details view.

## User Experience (The Hybrid Approach)

### 1. Runtime Quick-Tweak (Popover)
To allow immediate adjustments to the bot's heartbeat without disrupting the monitoring view.
- **Trigger**: "Runtime" button in the page header.
- **Components**: 
  - `Popover` containing a `ToggleGroup` (Adaptive vs Manual).
  - Conditional `Slider` for Check Interval (visible only in Manual mode) with real-time label.
- **Behavior**: Immediate update via `strategyApi.updateConfig`.

### 2. Bot Configuration (Side Panel)
A comprehensive editor for the bot's structural definition, mirroring the Dashboard's edit modal.
- **Trigger**: Settings (gear) icon.
- **Component**: `Sheet` (side panel).
- **Fields**:
  - **Identity**: Strategy Name (`Input`).
  - **Templates**: Logic Template & Risk Template (`Select` components).
  - **Execution**: Timeframe (`Select`), Trade Mode (`Select`), Paper Trading (`Checkbox`).
  - **Scope**: Watchlist (`Input` - comma separated).
  - **Limits**: Max Trade Size (USD) & Max Trades / Day (`Input` numbers).
- **Action**: "Save & Restart" button that triggers a full configuration update and restarts the bot instance.

## Technical implementation

### Data Model
The `updateConfig` API call will be updated to handle the full set of parameters:
```typescript
{
  name: string;
  logicTemplateId: string;
  riskTemplateId: string;
  settings: {
    triggerMode: 'Adaptive' | 'Manual';
    interval: number;
    timeframe: string;
    watchlist: string;
    tradeMode: string;
    paperTrading: boolean;
    maxTradeSize: number;
    maxTradesPerDay: number;
  }
}
```

### Components
- Use `shadcn` components: `Popover`, `Slider`, `ToggleGroup`, `Sheet`, `Input`, `Select`, `Checkbox`.
- Implement `FieldGroup` and `Field` for consistent form layout.
- Maintain the existing Socket.io connection for real-time status updates after a restart.

## Success Criteria
1. All fields from the Dashboard "Edit" modal are present and functional in the `StrategyDetails` side panel.
2. Runtime adjustments can be made via a popover without opening a full panel.
3. "Save & Restart" successfully updates the backend and restarts the bot.
4. UI is responsive and follows the project's aesthetic guidelines.
