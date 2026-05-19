# Strategy Settings Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the strategy settings in `StrategyDetails.tsx` to separate live runtime tweaks (Popover) from structural configuration (Sheet), implementing all fields from the Dashboard.

**Architecture:** 
- **Runtime**: A `Popover` in the header for `triggerMode` and `interval` with immediate API updates.
- **Configuration**: A `Sheet` containing a comprehensive form for strategy identity, templates, execution parameters, and limits, with a "Save & Restart" action.

**Tech Stack:** React, Tailwind CSS, shadcn/ui (`Popover`, `Slider`, `ToggleGroup`, `Sheet`, `Input`, `Select`, `Checkbox`), Axios.

---

### Task 1: Implement Runtime Quick-Tweak Popover

**Files:**
- Modify: `frontend/src/components/StrategyDetails.tsx`

- [ ] **Step 1: Create the Runtime Popover UI**
  Replace the existing `ToggleGroup` in the header (lines 246-255) with a `Popover`.
  ```tsx
  <Popover>
    <PopoverTrigger asChild>
      <Button variant="outline" className="h-8 px-4 flex items-center gap-2">
        <Clock className="h-3 w-3" />
        <span>Runtime</span>
      </Button>
    </PopoverTrigger>
    <PopoverContent className="w-80 space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">Trigger Mode</label>
        <ToggleGroup
          value={triggerMode}
          onValueChange={(val) => {
            const mode = val[0] as 'Adaptive' | 'Manual';
            setTriggerMode(mode);
            handleUpdateConfig({ settings: { triggerMode: mode } });
          }}
        >
          <ToggleGroupItem value="Adaptive">Adaptive</ToggleGroupItem>
          <ToggleGroupItem value="Manual">Manual</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {triggerMode === 'Manual' && (
        <div className="space-y-2">
          <div className="flex justify-between text-sm font-medium">
            <label>Check Interval</label>
            <span>{interval}s</span>
          </div>
          <Slider
            min={10}
            max={3600}
            step={10}
            value={[interval]}
            onValueChange={(val) => {
              setIntervalValue(val[0]);
              handleUpdateConfig({ settings: { interval: val[0] } });
            }}
          />
        </div>
      )}
    </PopoverContent>
  </Popover>
  ```
  *Note: Import `Popover`, `PopoverTrigger`, `PopoverContent`, and `Clock` (from lucide-react).*

- [ ] **Step 2: Verify Runtime updates**
  Start the app, open a strategy, change Trigger Mode and Interval. Check Network tab for `/api/strategies/config` calls.
  Expected: POST requests sent with correct `settings` payload.

- [ ] **Step 3: Commit**
  ```bash
  git add frontend/src/components/StrategyDetails.tsx
  git commit -m "feat: implement runtime quick-tweak popover in strategy details"
  ```

### Task 2: Expand Configuration State & API Integration

**Files:**
- Modify: `frontend/src/components/StrategyDetails.tsx`

- [ ] **Step 1: Add missing configuration states**
  Add states for the missing fields in `StrategyDetails` component:
  ```tsx
  const [timeframe, setTimeframe] = useState('1H');
  const [watchlist, setWatchlist] = useState('');
  const [tradeMode, setTradeMode] = useState('Spot');
  const [paperTrading, setPaperTrading] = useState(false);
  const [maxTradeSize, setMaxTradeSize] = useState(100);
  const [maxTradesPerDay, setMaxTradesPerDay] = useState(10000);
  ```

- [ ] **Step 2: Initialize states from strategy config**
  Update the `fetchData` useEffect (lines 79-92) to parse the full config:
  ```tsx
  const config = JSON.parse(s.config || '{}');
  const settings = config.settings || {};
  
  setTriggerMode(settings.triggerMode || 'Adaptive');
  setIntervalValue(settings.interval || 60);
  
  setConfigName(s.name);
  setSettingsTriggerMode(settings.triggerMode || 'Adaptive');
  setSettingsInterval(settings.interval || 60);
  setLogicTemplateId(config.metadata?.logicTemplateId || '');
  setRiskTemplateId(config.metadata?.riskTemplateId || '');
  
  setTimeframe(settings.timeframe || '1H');
  setWatchlist(settings.watchlist || '');
  setTradeMode(settings.tradeMode || 'Spot');
  setPaperTrading(settings.paperTrading || false);
  setMaxTradeSize(settings.maxTradeSize || 100);
  setMaxTradesPerDay(settings.maxTradesPerDay || 10000);
  ```

- [ ] **Step 3: Commit**
  ```bash
  git add frontend/src/components/StrategyDetails.tsx
  git commit -m "feat: add missing configuration states to strategy details"
  ```

### Task 3: Implement Full Configuration Sheet

**Files:**
- Modify: `frontend/src/components/StrategyDetails.tsx`

- [ ] **Step 1: Refactor Sheet content to use full form**
  Replace the `Tabs` inside `SheetContent` (lines 292-383) with a comprehensive form.
  ```tsx
  <div className="space-y-6 py-4">
    <div className="space-y-2">
      <label className="text-sm font-medium">Strategy Name</label>
      <Input
        value={configName}
        onChange={(e) => setConfigName(e.target.value)}
      />
    </div>
    
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">Logic Template</label>
        <Select value={logicTemplateId} onValueChange={setLogicTemplateId}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {templates.logic.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Risk Template</label>
        <Select value={riskTemplateId} onValueChange={setRiskTemplateId}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {templates.risk.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>

    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">Timeframe</label>
        <Select value={timeframe} onValueChange={setTimeframe}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {['1m', '5m', '15m', '1H', '4H', '1D'].map(tf => <SelectItem key={tf} value={tf}>{tf}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Trade Mode</label>
        <Select value={tradeMode} onValueChange={setTradeMode}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {['Spot', 'Futures'].map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>

    <div className="flex items-center gap-2 py-2">
      <Checkbox id="paper-trading" checked={paperTrading} onCheckedChange={(val) => setPaperTrading(!!val)} />
      <label htmlFor="paper-trading" className="text-sm font-medium">Paper Trading</label>
    </div>

    <div className="space-y-2">
      <label className="text-sm font-medium">Watchlist (comma separated)</label>
      <Input 
        value={watchlist} 
        onChange={(e) => setWatchlist(e.target.value)} 
        placeholder="BTCUSDT, ETHUSDT..."
      />
    </div>

    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">Max Trade Size (USD)</label>
        <Input 
          type="number" 
          value={maxTradeSize} 
          onChange={(e) => setMaxTradeSize(Number(e.target.value))} 
        />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Max Trades / Day</label>
        <Input 
          type="number" 
          value={maxTradesPerDay} 
          onChange={(e) => setMaxTradesPerDay(Number(e.target.value))} 
        />
      </div>
    </div>

    <Button variant="primary" onClick={handleSaveSettings} className="w-full">
      Save & Restart
    </Button>
  </div>
  ```
  *Note: Import `Checkbox` from `./ui/components`.*

- [ ] **Step 2: Update `handleSaveSettings` to send full payload**
  Modify `handleSaveSettings` (lines 181-206) to include all new fields:
  ```tsx
  const handleSaveSettings = async () => {
    if (!strategy) return;
    if (!window.confirm('Are you sure you want to save these changes and restart the strategy?')) return;

    try {
      await strategyApi.updateConfig(strategyId, {
        name: configName,
        logicTemplateId,
        riskTemplateId,
        settings: {
          triggerMode: settingsTriggerMode,
          interval: settingsInterval,
          timeframe,
          watchlist,
          tradeMode,
          paperTrading,
          maxTradeSize,
          maxTradesPerDay
        }
      });

      setStrategy(prev => prev ? { ...prev, name: configName } : null);
      setIsSettingsOpen(false);
      toast.success('Settings saved and strategy restarted successfully.');
    } catch (err: any) {
      toast.error('Failed to save settings: ' + err.message);
    }
  };
  ```

- [ ] **Step 3: Verify end-to-end configuration**
  Open the Settings sheet, change multiple values (e.g., name, timeframe, watchlist), click "Save & Restart". Verify the bot restarts and settings are persisted on page refresh.
  Expected: Success toast, side panel closes, values persist.

- [ ] **Step 4: Commit**
  ```bash
  git add frontend/src/components/StrategyDetails.tsx
  git commit -m "feat: implement full configuration sheet in strategy details"
  ```
