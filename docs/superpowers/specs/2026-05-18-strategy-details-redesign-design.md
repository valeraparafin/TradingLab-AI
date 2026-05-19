# Design Spec: Strategy Details Page Redesign

## Status
- **Date**: 2026-05-18
- **Status**: Approved
- **Priority**: High

## Context
The current Strategy Details page uses a vertical stack of cards that is inefficient for real-time monitoring. Users must scroll between the KPI stats, active positions, and the terminal logs, losing the temporal connection between a bot event (log) and its result (position).

## Goals
- Transition to a "Trading Terminal" layout (Side-by-Side).
- Implement high-density KPI metrics.
- Separate Runtime tuning from Structural configuration.
- Improve visual hierarchy using shadcn/ui components.

## Design Specifications

### 1. Header & Quick Actions
- **Layout**: A streamlined toolbar.
- **Components**:
    - `Button` (Ghost, `ArrowLeft` icon) for navigation.
    - `H1` for Strategy Name, accompanied by a `Badge` (Running/Stopped) and the strategy ID.
    - **Action Group (Right)**:
        - `ToggleGroup` (Compact) for **Adaptive $\leftrightarrow$ Manual** mode.
        - `Button` (Icon only, variant: `danger` if running, `primary` if stopped) for Start/Stop.
        - `Button` (Icon only, variant: `outline`) with $\text{Settings}$ (⚙️) icon to trigger the Configuration Sheet.

### 2. High-Density KPI Bar
- **Layout**: A grid of 8 compact `StatCard` components.
- **Metrics**:
    - **Primary (High Emphasis)**: `Net PnL`, `Win Rate`, `Total Trades`.
    - **Secondary (Supporting)**: `Profit Factor`, `Total Orders`, `Wins`, `Losses`, `Avg Profit`.
- **Visuals**:
    - `Net PnL`: Include a trend indicator ($\text{up}$/$\text{down}$).
    - `Win Rate`: Subtle background progress bar.
    - `Wins`/`Losses`: Value text colored Emerald/Rose respectively.

### 3. Main Workspace (Side-by-Side)
- **Container**: `ResizablePanelGroup` for flexible layout.
- **Left Panel (~65%) - Active Positions**:
    - Component: `Table` with sticky header.
    - Data: Symbol, Side (as `Badge`), Entry, Current, PnL (color-coded), SL/TP.
    - Empty State: `Empty` component for "No open positions".
- **Right Panel (~35%) - Strategy Terminal**:
    - Component: `ScrollArea` with a dark theme.
    - Log Styling: Color-coded labels for `[INFO]`, `[SAFETY_CHECK]`, and `[CHECK]`.
    - Behavior: Auto-scroll to bottom on new events.

### 4. Configuration Sheet
- **Component**: `Sheet` (slide-out from right).
- **Structure**: `Tabs` interface with two views:
    - **Tab 1: Runtime (Quick Tuning)**:
        - `ToggleGroup` for Trigger Mode.
        - `Slider` for check interval (visible only in Manual mode).
        - `Button` to "Update" current runtime settings.
    - **Tab 2: Configuration (Structural)**:
        - `Input` for Strategy Name.
        - `Select` for Logic Template.
        - `Select` for Risk Template.
        - `Button` "Save & Restart" (requires confirmation dialog).

## Technical Requirements
- **UI Framework**: shadcn/ui.
- **Icons**: Lucide-react.
- **State Management**: Sync runtime changes immediately via `strategyApi.updateConfig`.
- **Responsiveness**: Grid columns should adjust from 4 (mobile) $\rightarrow$ 8 (desktop).

## Verification Plan
1. **Layout Check**: Verify Side-by-Side resizable panels work without breaking the page.
2. **Runtime Test**: Switch Adaptive $\rightarrow$ Manual and move the slider; verify API call and immediate bot response.
3. **Config Test**: Change logic template $\rightarrow$ Save $\rightarrow$ Verify bot process restarts with new config.
4. **Visual Audit**: Ensure no `alert()` calls remain, replaced by `sonner` toasts.
