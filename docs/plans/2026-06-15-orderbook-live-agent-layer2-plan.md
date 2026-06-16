# Order-Book Live Agent — Layer 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Launch the live order-book breakout strategy as a configurable paper-trading agent from the `/ai` dashboard.

**Architecture:** The agent's `AgentOrchestrator` owns a `LiveObEngine` (Layer 1). A fast ~10 s drain loop maps buffered book signals → `QualitativeProposal` → existing `RiskPolicy` (forced structural) → `TradeExecutor` PAPER. The 5-min cycle only does telemetry in OB mode.

**Tech Stack:** Node ESM, SQLite (`db.js` idempotent ALTER pattern), Socket.io, React (Vite) frontend. Tests: plain ESM + `node:assert`, run `node tests/<file>.mjs`.

**Spec:** `docs/specs/2026-06-15-orderbook-live-agent-layer2-design.md`

---

## File Structure

- Create: `src/agents/ObAnalyst.js` — pure signal-record → proposal mapper.
- Create: `templates/logic/orderbook.json` — `type: "OrderBook"` logic template.
- Create: `src/agents/obGuardrails.js` — `applyOrderBookGuardrails(g)` structural override.
- Modify: `src/agents/AgentOrchestrator.js` — OB mode (engine ownership, drain loop, runCycle bypass, council).
- Modify: `src/server/services/agentManager.js` — detect OB, build feed + candlesProvider + obConfig, force structural guardrails.
- Modify: `frontend/src/components/AIAgentConfigForm.tsx` — send string logic id; OB threshold fields (final task).
- Modify: `db.js` — `ob_config TEXT` column (final task).
- Tests: `tests/test_ob_analyst.mjs`, `tests/test_orchestrator_ob_mode.mjs`, `tests/test_ob_guardrails.mjs`.

---

## Task 1: ObAnalyst pure mapper

**Files:**
- Create: `src/agents/ObAnalyst.js`
- Test: `tests/test_ob_analyst.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/test_ob_analyst.mjs
import assert from 'node:assert';
import { proposalFromSignal } from '../src/agents/ObAnalyst.js';

let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

const buy = { type: 'signal', sym: 'SUIUSDT', side: 'BUY', conviction: 0.7,
  entryMid: 100.5, invalidation: 100, rationale: 'breakout BUY thru 100' };
const pb = proposalFromSignal(buy);
assert.equal(pb.side, 'BUY'); ok('BUY side passthrough');
assert.equal(pb.conviction, 0.7); ok('conviction passthrough');
assert.equal(pb.invalidationIdea, 100); ok('numeric invalidation → invalidationIdea');
assert.equal(pb.entryMid, 100.5); ok('entryMid passthrough');
assert.ok(typeof pb.rationale === 'string'); ok('rationale string');

const sell = { type: 'signal', sym: 'X', side: 'SELL', conviction: 0.5, entryMid: 9, invalidation: 10, rationale: 'r' };
assert.equal(proposalFromSignal(sell).side, 'SELL'); ok('SELL side passthrough');

// Malformed / missing side → HOLD proposal (RiskPolicy will DENY).
const hold = proposalFromSignal({ type: 'signal', sym: 'X' });
assert.equal(hold.side, 'HOLD'); ok('missing side → HOLD');
assert.equal(hold.invalidationIdea, null); ok('HOLD invalidationIdea null');

const holdNull = proposalFromSignal(null);
assert.equal(holdNull.side, 'HOLD'); ok('null record → HOLD');

console.log(`\n${p} checks passed`);
```

- [ ] **Step 2: Run test, verify it fails**

Run: `node tests/test_ob_analyst.mjs`
Expected: FAIL — cannot find `../src/agents/ObAnalyst.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/agents/ObAnalyst.js
// Pure: a drained order-book signal record (obSignalLog.signalRecord shape) → the
// QualitativeProposal contract RiskPolicy consumes. Carries entryMid so the orchestrator
// prices the order at the signal's own mid (not a lagging candle). No I/O.

/** HOLD proposal — RiskPolicy DENYs it (no trade). */
function holdProposal(reason = 'no order-book signal') {
  return { side: 'HOLD', conviction: 0, rationale: reason, invalidationIdea: null, entryMid: null };
}

/**
 * @param {{side?:string, conviction?:number, entryMid?:number,
 *          invalidation?:number|null, rationale?:string}|null} rec
 * @returns {{side:string, conviction:number, rationale:string,
 *            invalidationIdea:number|null, entryMid:number|null}}
 */
export function proposalFromSignal(rec) {
  if (!rec || (rec.side !== 'BUY' && rec.side !== 'SELL')) {
    return holdProposal(rec ? `unusable signal side ${rec.side}` : 'null signal record');
  }
  return {
    side: rec.side,
    conviction: typeof rec.conviction === 'number' ? rec.conviction : 0,
    rationale: rec.rationale || `order-book ${rec.side}`,
    invalidationIdea: typeof rec.invalidation === 'number' && isFinite(rec.invalidation) ? rec.invalidation : null,
    entryMid: typeof rec.entryMid === 'number' && isFinite(rec.entryMid) ? rec.entryMid : null,
  };
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `node tests/test_ob_analyst.mjs`
Expected: PASS — `8 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/agents/ObAnalyst.js tests/test_ob_analyst.mjs
git commit -m "feat(ob-agent): ObAnalyst — drained signal → QualitativeProposal mapper"
```

---

## Task 2: OrderBook logic template

**Files:**
- Create: `templates/logic/orderbook.json`

- [ ] **Step 1: Write the template**

```json
{
  "id": "orderbook",
  "name": "Order Book (Live)",
  "type": "OrderBook",
  "indicators": {
    "imbThresh": 0.10,
    "aggThresh": 0.15,
    "minVelocity": 0.5,
    "maxSpreadBps": 8,
    "horizonMs": 60000,
    "htfStep": 1
  },
  "safety_checks": [
    { "id": "ob_gate", "description": "Spread + imbalance gate vetoes contradicting/wide-spread crosses" }
  ]
}
```

- [ ] **Step 2: Verify it loads and resolves to the OrderBook indicator**

Run:
```bash
node -e "import('./src/server/services/aiStrategyService.js').then(async ({aiStrategyService})=>{console.log(await aiStrategyService.getLogicTemplateIndicators('orderbook'))})"
```
Expected: `[ 'OrderBook' ]`

- [ ] **Step 3: Commit**

```bash
git add templates/logic/orderbook.json
git commit -m "feat(ob-agent): OrderBook logic template (type=OrderBook)"
```

---

## Task 3: Fix logic_template_id string + send it from the form

The form coerces the string template id with `Number()` → `NaN` → `null`. SQLite's INTEGER
affinity stores a non-numeric string unchanged, so send the raw string. This makes OB
selectable and fixes the latent SMC-fallback bug for all logic types.

**Files:**
- Modify: `frontend/src/components/AIAgentConfigForm.tsx`

- [ ] **Step 1: Change the submit mapping**

In `handleSubmit`, replace:
```js
      logic_template_id: formData.logicTemplateId ? Number(formData.logicTemplateId) : null,
```
with:
```js
      // Logic template ids are filename strings (e.g. "orderbook"); do NOT Number()-coerce
      // (that yields NaN→null and silently drops the selection). SQLite stores the string fine.
      logic_template_id: formData.logicTemplateId || null,
```

- [ ] **Step 2: Verify the dropdown initial value still round-trips**

The form already initializes `logicTemplateId` from `String(agent.logic_template_id)` and the
options use `String(t.id)`, so a saved string id re-selects correctly. No other change needed.

- [ ] **Step 3: Lint**

Run: `cd frontend && npm run lint`
Expected: no new errors in `AIAgentConfigForm.tsx`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/AIAgentConfigForm.tsx
git commit -m "fix(ai-agent): persist string logic_template_id (was NaN→null, forced SMC fallback)"
```

---

## Task 4: Structural guardrails override for OB agents

**Files:**
- Create: `src/agents/obGuardrails.js`
- Test: `tests/test_ob_guardrails.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/test_ob_guardrails.mjs
import assert from 'node:assert';
import { applyOrderBookGuardrails } from '../src/agents/obGuardrails.js';

let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

const base = { riskPerTrade: 0.01, stopLossPct: 0.02, takeProfitPct: 0.04, minRiskRewardRatio: 1.5, portfolioValue: 200 };
const g = applyOrderBookGuardrails(base);
assert.equal(g.stopMode, 'structural'); ok('stopMode structural');
assert.equal(g.minRiskRewardRatio, 0); ok('R:R gate disabled');
assert.equal(g.structuralRR, 2); ok('structuralRR default 2');
assert.equal(g.riskPerTrade, 0.01); ok('preserves sizing');
assert.equal(g.portfolioValue, 200); ok('preserves portfolioValue');
// Does not mutate the input.
assert.equal(base.stopMode, undefined); ok('pure — input untouched');
// Honors an explicit structuralRR override.
assert.equal(applyOrderBookGuardrails(base, { structuralRR: 3 }).structuralRR, 3); ok('structuralRR override');

console.log(`\n${p} checks passed`);
```

- [ ] **Step 2: Run test, verify it fails**

Run: `node tests/test_ob_guardrails.mjs`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```js
// src/agents/obGuardrails.js
// Order-book agents must use structural stops: SL = the broken level (signal invalidation),
// TP = structuralRR × risk. The percent-based R:R gate is disabled (minRiskRewardRatio=0) —
// otherwise RiskPolicy compares an ATR/structural setup against a percent threshold and DENYs
// nearly every OB trade. Risk profile still supplies sizing/heat/daily limits.

/**
 * @param {object} guardrails  output of riskProfileToGuardrails (fractions)
 * @param {{structuralRR?:number}} [opts]
 * @returns {object} a NEW guardrails object with structural overrides applied
 */
export function applyOrderBookGuardrails(guardrails = {}, { structuralRR = 2 } = {}) {
  return {
    ...guardrails,
    stopMode: 'structural',
    structuralRR: guardrails.structuralRR ?? structuralRR,
    minRiskRewardRatio: 0,
  };
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `node tests/test_ob_guardrails.mjs`
Expected: PASS — `8 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/agents/obGuardrails.js tests/test_ob_guardrails.mjs
git commit -m "feat(ob-agent): structural guardrails override for order-book agents"
```

---

## Task 5: AgentOrchestrator OB mode

The orchestrator gains an OB branch driven by an injected `obEngine` (the live engine) +
`obConfig`. It bypasses the candle analyst, runs a fast drain loop, prices at the signal's
`entryMid`, and feeds the council from the latest OB proposal.

**Files:**
- Modify: `src/agents/AgentOrchestrator.js`
- Test: `tests/test_orchestrator_ob_mode.mjs`

- [ ] **Step 1: Write the failing test (injected fakes, no network)**

```js
// tests/test_orchestrator_ob_mode.mjs
import assert from 'node:assert';
import AgentOrchestrator from '../src/agents/AgentOrchestrator.js';

let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

const io = { emit() {} };

// Fake engine: hands out one BUY signal for SUIUSDT on first drain, then nothing.
function fakeEngine(rec) {
  let handed = false;
  return {
    started: false, stopped: false,
    start() { this.started = true; }, stop() { this.stopped = true; },
    drainSignals(sym) { if (!handed && sym === 'SUIUSDT') { handed = true; return [rec]; } return []; },
    getStats() { return { SUIUSDT: { ticks: 1, signals: 1, resolved: 0, wins: 0, netBpsSum: 0 } }; },
  };
}

const sig = { type: 'signal', sym: 'SUIUSDT', side: 'BUY', conviction: 0.7, entryMid: 100.5, invalidation: 100, rationale: 'breakout BUY thru 100' };

// Capture executed trades via an injected executor.
const executed = [];
const fakeExecutor = { executeTrade: async (t) => { executed.push(t); return { success: true, executedPrice: t.price }; } };

const guardrails = { riskPerTrade: 0.1, maxTradeSizeUSD: 1000, portfolioValue: 200, stopMode: 'structural', structuralRR: 2, minRiskRewardRatio: 0, leverage: 1 };

const engine = fakeEngine(sig);
const o = new AgentOrchestrator(io, {
  execution: { agentId: 1, paperTrading: true, symbols: ['SUIUSDT'], tradeMode: 'PAPER' },
  guardrails,
  obEngine: engine,
  obConfig: { drainIntervalMs: 10_000 },
  indicators: ['OrderBook'],
});
// Inject the fake executor (constructor builds a real one; override for the test).
o.tradeExecutor = fakeExecutor;

// start() must start the engine and NOT throw.
o.isRunning = true;

// Drive one drain tick directly (don't rely on timers).
await o._obDrainTick();

assert.equal(executed.length, 1, 'one paper trade'); ok('drain → one execution');
assert.equal(executed[0].side, 'buy'); ok('side buy (lowercased)');
assert.equal(executed[0].price, 100.5); ok('priced at signal entryMid');
// SL = broken level 100; TP = entry + 2*(entry-level) = 100.5 + 2*0.5 = 101.5 (checked via decision log not asserted here).

// Second drain → engine empty → no new trade.
await o._obDrainTick();
assert.equal(executed.length, 1); ok('empty drain → no new trade');

// OB mode: runCycle must NOT invoke the candle analyst.
let analystCalled = false;
o.analyst = { process: async () => { analystCalled = true; return { side: 'HOLD', conviction: 0 }; } };
o._getPortfolioState = async () => ({ openPositions: 0, portfolioHeatPct: 0, dailyPnlPct: 0, tradesToday: 0 });
o._recordTelemetry = async () => {};
await o.runCycle();
assert.equal(analystCalled, false); ok('runCycle bypasses candle analyst in OB mode');

// stop() tears the engine down.
o.stop();
assert.equal(engine.stopped, true); ok('stop() stops the engine');

console.log(`\n${p} checks passed`);
```

- [ ] **Step 2: Run test, verify it fails**

Run: `node tests/test_orchestrator_ob_mode.mjs`
Expected: FAIL — `_obDrainTick` is not a function / OB mode absent.

- [ ] **Step 3: Implement OB mode in AgentOrchestrator**

In the constructor, after the existing field assignments, add OB wiring:
```js
    // ── Order-Book mode ─────────────────────────────────────────────
    // When an obEngine is injected (agentManager builds it for OrderBook agents) the
    // orchestrator drains live book signals on a fast loop instead of the candle analyst.
    this.obEngine = config.obEngine || null;
    this.obConfig = config.obConfig || {};
    this.isObMode = !!this.obEngine;
    this._obDrainTimer = null;
    this._lastObProposal = null; // feeds the cockpit council in OB mode
```

Add the drain tick method (place near `runCycle`):
```js
  /**
   * OB mode: pull buffered book signals, map → proposal, gate via RiskPolicy (structural),
   * execute PAPER at the signal's own entryMid. Sparse by design — most ticks drain nothing.
   */
  async _obDrainTick() {
    if (!this.isRunning || !this.obEngine) return;
    const { proposalFromSignal } = await import('./ObAnalyst.js');
    const portfolioState = await this._getPortfolioState();
    for (const symbol of this.symbolsToWatch) {
      let records;
      try { records = this.obEngine.drainSignals(symbol) || []; }
      catch (e) { console.error(`[OB] drain ${symbol}: ${e.message}`); continue; }
      for (const rec of records) {
        try {
          const proposal = proposalFromSignal(rec);
          if (proposal.side === 'HOLD' || proposal.entryMid == null) continue;
          const entryPrice = proposal.entryMid;
          const verdict = this.riskPolicy.evaluate(proposal, {
            entryPrice, ...portfolioState,
            invalidation: (typeof proposal.invalidationIdea === 'number' && isFinite(proposal.invalidationIdea))
              ? proposal.invalidationIdea : null,
          });
          this._lastObProposal = proposal;
          if (verdict.decision !== 'PERMIT') {
            this.broadcastDecision({ symbol, decision: 'VETOED',
              reasoning: `${proposal.side} (OB); policy denied: ${verdict.reason}` });
            continue;
          }
          const order = verdict.order;
          const tradeParams = { symbol, side: order.side.toLowerCase(), sizeUSD: order.sizeUSD,
            price: order.entryPrice, marketType: this.execution.tradeMode };
          this.broadcastDecision({ symbol, decision: 'EXECUTE',
            reasoning: `${proposal.side} (OB conviction ${proposal.conviction.toFixed(2)}); SL ${order.slPrice}, TP ${order.tpPrice}`,
            details: tradeParams });
          const r = await this.tradeExecutor.executeTrade(tradeParams);
          this.broadcastThought({ agent: 'orchestrator',
            thought: `OB trade ${r.success ? 'Executed' : 'Failed'} (${order.side} ${symbol})` });
        } catch (e) {
          console.error(`[OB] execute ${symbol}: ${e.message}`);
        }
      }
    }
  }
```

In `runCycle`, short-circuit the candle analyst when in OB mode (keep telemetry). Replace the
top of `runCycle`:
```js
  async runCycle() {
    if (!this.isRunning) return;
    const portfolioState = await this._getPortfolioState();
    // OB mode: trades are driven by the fast drain loop; the cycle only records telemetry.
    if (this.isObMode) {
      await this._recordTelemetry(portfolioState, this._lastObProposal);
      return;
    }
    let lastProposal = null;
    for (const symbol of this.symbolsToWatch) {
      // ... existing body unchanged ...
```

In `start()`, start the engine + drain loop when in OB mode:
```js
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('AgentOrchestrator: Starting adversarial loop...');
    if (this.isObMode) {
      this.obEngine.start?.();
      const drainMs = this.obConfig.drainIntervalMs || 10_000;
      this._obDrainTimer = setInterval(() => this._obDrainTick(), drainMs);
    }
    this.loopInterval = setInterval(() => this.runCycle(), this.config.cycleInterval || 300000);
    this.runCycle();
  }
```

In `stop()`, tear down the engine + drain loop:
```js
  stop() {
    this.isRunning = false;
    if (this.loopInterval) { clearInterval(this.loopInterval); this.loopInterval = null; }
    if (this._obDrainTimer) { clearInterval(this._obDrainTimer); this._obDrainTimer = null; }
    if (this.obEngine) { try { this.obEngine.stop?.(); } catch (e) { console.error(`[OB] stop: ${e.message}`); } }
    console.log('AgentOrchestrator: Stopped.');
  }
```

- [ ] **Step 4: Run test, verify it passes**

Run: `node tests/test_orchestrator_ob_mode.mjs`
Expected: PASS — `8 checks passed`.

- [ ] **Step 5: Regression — existing agent test still green**

Run: `node tests/test_ai_agents.mjs`
Expected: PASS (no OB config → `isObMode` false → unchanged behavior).

- [ ] **Step 6: Commit**

```bash
git add src/agents/AgentOrchestrator.js tests/test_orchestrator_ob_mode.mjs
git commit -m "feat(ob-agent): AgentOrchestrator OB mode — fast drain loop, entryMid pricing"
```

---

## Task 6: agentManager wiring (build engine + force structural)

**Files:**
- Modify: `src/server/services/agentManager.js`

- [ ] **Step 1: Add the OB branch in `start()`**

After indicators are resolved and BEFORE constructing the orchestrator, insert:
```js
        const isOrderBook = indicators.map(String).includes('OrderBook');
        let obEngine = null, obConfig = null, finalGuardrails = guardrails;
        if (isOrderBook) {
          const { OrderBookFeed } = await import('../../marketdata/orderbook/OrderBookFeed.js');
          const { LiveObEngine } = await import('../../marketdata/orderbook/liveObEngine.js');
          const { applyOrderBookGuardrails } = await import('../../agents/obGuardrails.js');
          const { toolRegistry } = await import('../../registry/ToolRegistry.js');
          const symbols = execution.symbols;
          const obParams = await _loadObParams(agent); // thresholds: ob_config JSON or template defaults
          const feed = new OrderBookFeed({ symbols: symbols.map((s) => ({ futures: s, spot: s })), record: false });
          const candlesProvider = async (sym, tf) => {
            const res = await toolRegistry.executeTool('get_candles', { symbol: sym, interval: tf, limit: 50 });
            return res.success ? res.data : [];
          };
          obEngine = new LiveObEngine({ feed, candlesProvider, symbols,
            opts: { baseTf: agent.timeframe || '5m', record: true, ...obParams } });
          obConfig = { drainIntervalMs: 10_000 };
          finalGuardrails = applyOrderBookGuardrails(guardrails);
        }

        const o = new AgentOrchestrator(io, {
          llmContext, guardrails: finalGuardrails, execution, indicators,
          obEngine, obConfig,
        });
```
(Remove the previous `new AgentOrchestrator(io, { llmContext, guardrails, execution, indicators })` line — replaced above.)

- [ ] **Step 2: Add the obParams loader helper at module scope**

Above `createAgentManager`, add:
```js
// Resolve OB thresholds: per-agent ob_config JSON (Task 7) if present, else the OrderBook
// logic template's `indicators` block, else the engine's built-in DEF.
async function _loadObParams(agent) {
  // Per-agent override (added in Task 7); tolerate absence/parse errors.
  if (agent.ob_config) {
    try { const j = JSON.parse(agent.ob_config); if (j && typeof j === 'object') return j; } catch (_) {}
  }
  try {
    const { templateService } = await import('./template.service.js');
    const tpl = await templateService.loadTemplate('logic', String(agent.logic_template_id));
    if (tpl?.indicators && typeof tpl.indicators === 'object') return tpl.indicators;
  } catch (_) {}
  return {}; // LiveObEngine DEF fills the rest
}
```

- [ ] **Step 3: Manual smoke (server running)**

Start the server (`npm run server`), create an agent with logic "Order Book (Live)", watchlist
`SUIUSDT,GPSUSDT`, timeframe `5m`, a risk profile, then POST start. Expect:
- `agent:status running` and no start error in the server log.
- Engine connects (book sync logs), `ai_paper_trades` gains rows when a signal PERMITs.
Stop the agent; engine tears down (no lingering sockets).

- [ ] **Step 4: Commit**

```bash
git add src/server/services/agentManager.js
git commit -m "feat(ob-agent): agentManager builds LiveObEngine + structural guardrails for OrderBook agents"
```

---

## Task 7: ob_config column + OB threshold fields in the form (final)

**Files:**
- Modify: `db.js`
- Modify: `src/server/services/aiStrategyService.js`
- Modify: `frontend/src/components/AIAgentConfigForm.tsx`

- [ ] **Step 1: Add the idempotent column**

In `db.js`, append to the `aiStrategyColumns` array:
```js
        'ALTER TABLE ai_strategies ADD COLUMN ob_config TEXT',
```

- [ ] **Step 2: Persist + read `ob_config` in the service**

In `aiStrategyService.createAgent`, add `ob_config` to the INSERT column list and values
(`a.ob_config ?? null`). In `updateAgent`, add `'ob_config'` to the `allowed` array. In
`listAgents` and `getAgent` SELECTs include `ob_config`.

- [ ] **Step 3: Add OB threshold fields to the form (shown only when OrderBook is selected)**

In `AIAgentConfigForm.tsx`: detect the selected logic template's name/type === Order Book
(compare `formData.logicTemplateId` against the `logicTemplates` entry whose id is `orderbook`).
When selected, render number inputs for `imbThresh`, `aggThresh`, `minVelocity`, `maxSpreadBps`,
`horizonMs`, `htfStep`, seeded from defaults `{imbThresh:0.10, aggThresh:0.15, minVelocity:0.5, maxSpreadBps:8, horizonMs:60000, htfStep:1}`. On submit, serialize them to
`ob_config: JSON.stringify({...})` (only when OrderBook is selected; otherwise omit/null).

- [ ] **Step 4: Verify end-to-end**

Run: `cd frontend && npm run lint` (no new errors), then manually create an OB agent with a
custom `imbThresh`, start it, and confirm the engine uses the override (server log / behavior).

- [ ] **Step 5: Commit**

```bash
git add db.js src/server/services/aiStrategyService.js frontend/src/components/AIAgentConfigForm.tsx
git commit -m "feat(ob-agent): per-agent OB thresholds (ob_config column + form fields)"
```

---

## Final review

After all tasks: dispatch a whole-implementation code review. Then run the full test suite
(`node tests/test_ob_analyst.mjs`, `test_ob_guardrails.mjs`, `test_orchestrator_ob_mode.mjs`,
`test_ai_agents.mjs`, the ob-engine suite) — all green — and do one live smoke from `/ai`.
Update memory (`project-orderbook-feed`) + graph (`graphify update .`).
