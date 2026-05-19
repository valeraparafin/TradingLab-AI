# Strategy Details Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Transform the Strategy Details page into a professional trading terminal with a side-by-side layout, high-density KPIs, and a tabbed configuration sheet.

**Architecture:**
- **Layout**: Use `ResizablePanelGroup` for a 65/35 split between Positions and Terminal.
- **Header**: A compact toolbar replacing the large card-based control panel.
- **Settings**: A `Sheet` component containing `Tabs` for Runtime (quick tuning) and Configuration (structural changes).
- **Metrics**: A high-density grid of `StatCard` components with conditional coloring.

**Tech Stack**: React, Tailwind CSS, shadcn/ui, Lucide-react.

---

### Task 1: UI Primitive Expansion
**Files**:
- Modify: `frontend/src/components/ui/components.tsx`

- [ ] **Step 1: Add `Sheet` components** (Root, Trigger, Content, Header, Title, Description).
- [ ] **Step 2: Add `Slider` component** (Basic Radix-like slider for interval tuning).
- [ ] **Step 3: Add `ToggleGroup` and `ToggleGroupItem`** (For Adaptive/Manual mode).
- [ ] **Step 4: Add `Resizable` components** (`ResizablePanelGroup`, `ResizablePanel`, `ResizableHandle`).
- [ ] **Step 5: Commit**
  `git commit -m "ui: add sheet, slider, togglegroup, and resizable components"`

### Task 2: Header & Quick Actions Toolbar
**Files**:
- Modify: `frontend/src/components/StrategyDetails.tsx`

- [ ] **Step 1: Implement the streamlined Header row**.
  - Add `ArrowLeft` icon button.
  - Place Strategy Name, Status Badge, and ID in a flex row.
- [ ] **Step 2: Implement the Right-side Action Group**.
  - Add `ToggleGroup` for Adaptive/Manual.
  - Add `Button` with `Play`/`Square` icon for Start/Stop.
  - Add `Button` with `Settings` (⚙️) icon.
- [ ] **Step 3: Connect Start/Stop and Mode Toggle to `strategyApi`**.
- [ ] **Step 4: Commit**
  `git commit -m "feat(ui): implement compact header and quick actions"`

### Task 3: High-Density KPI Bar
**Files**:
- Modify: `frontend/src/components/StrategyDetails.tsx`

- [ ] **Step 1: Redesign `StatCard` for high density**.
  - Update props to handle `trend` and `color`.
  - Implement compact typography (label small, value bold).
- [ ] **Step 2: Implement the 8-column KPI grid**.
  - Map `stats` data to the 8 metrics (Net PnL, Win Rate, Total Trades, Profit Factor, Total Orders, Wins, Losses, Avg Profit).
- [ ] **Step 3: Add visual indicators**.
  - Add $\text{up}$/$\text{down}$ icons for Net PnL.
  - Add color coding for Wins (emerald) and Losses (rose).
- [ ] **Step 4: Commit**
  `git commit -m "feat(ui): implement high-density KPI bar"`

### Task 4: Main Workspace (Side-by-Side Layout)
**Files**:
- Modify: `frontend/src/components/StrategyDetails.tsx`

- [ ] **Step 1: Wrap the main content in `ResizablePanelGroup`**.
- [ ] **Step 2: Implement the Left Panel (Positions)**.
  - Use `Table` component.
  - Implement the "No active positions" `Empty` state.
- [ ] **Step 3: Implement the Right Panel (Terminal)**.
  - Embed `StrategyTerminal` within a `ScrollArea`.
- [ ] **Step 4: Commit**
  `git commit -m "feat(ui): implement resizable side-by-side layout"`

### Task 5: The Configuration Sheet (Settings)
**Files**:
- Modify: `frontend/src/components/StrategyDetails.tsx`

- [ ] **Step 1: Implement `Sheet` wrapper triggered by the Settings button**.
- [ ] **Step 2: Implement `Tabs` structure inside the Sheet**.
- [ ] **Step 3: Build "Runtime" Tab**.
  - `ToggleGroup` for mode.
  - `Slider` for interval (conditionally rendered for Manual mode).
  - "Update" button calling `strategyApi.updateConfig`.
- [ ] **Step 4: Build "Configuration" Tab**.
  - `Input` for name.
  - `Select` for Logic Template.
  - `Select` for Risk Template.
  - "Save & Restart" button with confirmation.
- [ ] **Step 5: Commit**
  `git commit -m "feat(ui): implement tabbed configuration sheet"`

### Task 6: Terminal Log Styling & UX
**Files**:
- Modify: `frontend/src/components/StrategyTerminal.tsx`

- [ ] **Step 1: Implement log-level color coding**.
  - `[INFO]` $\rightarrow$ blue/muted.
  - `[SAFETY_CHECK]` $\rightarrow$ amber.
  - `[CHECK]` $\rightarrow$ red/rose.
- [ ] **Step 2: Ensure auto-scroll to bottom on new events**.
- [ ] **Step 3: Commit**
  `git commit -m "style(terminal): improve log readability and auto-scroll"`

### Task 7: Final Polish & Toast Integration
**Files**:
- Modify: `frontend/src/components/StrategyDetails.tsx`
- Modify: `frontend/src/main.tsx` (or appropriate entry point)

- [ ] **Step 1: Install/Configure `sonner` for toasts**.
- [ ] **Step 2: Replace all `alert()` calls with `toast.success()` or `toast.error()`**.
- [ ] **Step 3: Final layout audit for responsiveness (mobile $\rightarrow$ desktop)**.
- [ ] **Step 4: Commit**
  `git commit -m "ui: replace alerts with toasts and final layout polish"`
