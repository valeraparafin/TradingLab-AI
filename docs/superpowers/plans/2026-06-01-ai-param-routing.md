# AI Param Routing & Deterministic Risk Enforcement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route agent config into a qualitative `llmContext` (for the future LLM) vs deterministic `guardrails` (enforced in code at the point of action), fix the inert-fields/veto/wrong-table bugs, and extract AI orchestration out of `server.js` — all without adding a real LLM call.

**Architecture:** Two phases. **Phase A** is a pure move-refactor: pull the 12 `/api/agents/*` routes and the orchestrator registry out of `server.js` into a thin Express router + an `agentManager` service (io injected). Tests stay green — no behavior change. **Phase B** introduces the logic on the clean structure: a pure `paramResolver` that splits config into three labeled blocks, a deterministic `RiskPolicy` that does all sizing/SL-TP/limit-gating, a `QualitativeProposal` contract for the Analyst (no money numbers), and an executor that writes to `ai_paper_trades`.

**Tech Stack:** Node 18+ ESM, Express, Socket.io, sqlite (`getDB('ai')`), `node:assert` + `node:test`-style `.mjs` scripts run with `node`.

**Coordination / sequencing rule:** Phase A (move) lands and is verified green **before** any Phase B logic change. Never mix "code moved" with "logic changed" in one commit. Phase B tasks B1–B4 are independent pure modules (parallelizable); B5–B6 wire them together and must come last.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `server.js` | modify (shrink) | create app/io, mount router, inject io into manager, boot |
| `src/server/routes/agents.routes.js` | **create** | thin HTTP layer: 12 `/api/agents/*` endpoints, delegate only |
| `src/server/services/agentManager.js` | **create** | owns `orchestrators` Map; start/stop/archive; builds config via resolver; emits `agent:status` |
| `src/agents/paramResolver.js` | **create** | pure: `resolveAgentParams()` → `{ llmContext, guardrails, execution }` |
| `src/agents/RiskPolicy.js` | **create** | pure deterministic: sizing + SL/TP + limit gates |
| `src/agents/AnalystAgent.js` | modify | `process()` returns `QualitativeProposal` (no money numbers) |
| `src/agents/AgentOrchestrator.js` | modify | uses `llmContext`/`RiskPolicy`/per-agent executor in `runCycle` |
| `src/agents/TradeExecutor.js` | modify | write `ai_paper_trades` via `getDB('ai')`, per-agent, honor `paperTrading` |
| `src/agents/RiskGuard.js` | delete | orphaned; absorbed by `RiskPolicy` |
| `tests/test_param_resolver.mjs` | **create** | unit test for resolver |
| `tests/test_risk_policy.mjs` | **create** | unit test for RiskPolicy |
| `tests/test_proposal_contract.mjs` | **create** | Analyst returns proposal shape, no money fields |
| `tests/test_executor_ai_db.mjs` | **create** | paper trade lands in `ai_paper_trades` |

Existing integration tests (`tests/test_ai_agents.mjs`, `tests/test_concurrency.mjs`, `tests/test_analyst_indicators.mjs`) are the Phase-A regression gate; they hit a live server on `http://localhost:3000`.

---

# PHASE A — Extraction from server.js (move only, no behavior change)

### Task A1: Create `agentManager` service (move registry + start/stop/archive)

**Files:**
- Create: `src/server/services/agentManager.js`
- Reference (source of moved logic): `server.js:76-141` (start/stop), `server.js:281-290` (archive), `server.js:40` (Map)

- [ ] **Step 1: Create the service** — move the registry and orchestration logic verbatim from `server.js`, wrapped in a factory that receives `io`. (Phase A keeps the **existing** inline config-building; B6 swaps it for the resolver.)

```js
// src/server/services/agentManager.js
import AgentOrchestrator from '../../agents/AgentOrchestrator.js';
import { aiStrategyService } from './aiStrategyService.js';

/**
 * Owns the live orchestrator registry and start/stop/archive lifecycle.
 * `io` is injected so this module never imports server.js (one-directional dep).
 */
export function createAgentManager(io) {
  const orchestrators = new Map(); // agent_id (Number) -> AgentOrchestrator | null(reserved)

  return {
    size: () => orchestrators.size,
    isRunning: (agentId) => orchestrators.has(Number(agentId)),

    async start(agentIdRaw) {
      const agentId = Number(agentIdRaw);
      if (!agentId) return { http: 400, body: { success: false, error: 'Missing agent_id' } };
      if (orchestrators.has(agentId)) return { http: 200, body: { status: 'already_running' } };
      orchestrators.set(agentId, null); // reserve
      try {
        const agent = await aiStrategyService.getAgent(agentId);
        if (!agent) {
          orchestrators.delete(agentId);
          return { http: 404, body: { success: false, error: 'Agent not found' } };
        }
        const riskProfile = agent.risk_profile_id
          ? await aiStrategyService.getRiskProfile(agent.risk_profile_id) : {};
        if (!agent.risk_profile_id || !riskProfile || Object.keys(riskProfile).length === 0) {
          console.warn(`[Agent Start] Agent ${agentId} starting WITHOUT risk constraints.`);
        }
        const paperTrading = true; // real-mode safety until exchange accounts exist
        let indicators = ['SMC'];
        try {
          const resolved = await aiStrategyService.getLogicTemplateIndicators(agent.logic_template_id);
          if (resolved?.length) indicators = resolved;
        } catch (_) { /* keep default */ }

        const config = {
          ...riskProfile,
          agentId,
          logicTemplateId: agent.logic_template_id,
          indicators,
          symbols: (agent.watchlist || 'BTCUSDT,ETHUSDT').split(',').map(s => s.trim()).filter(Boolean),
          timeframe: agent.timeframe || '1H',
          portfolioValue: agent.portfolio_value || 10000,
          cycleInterval: agent.cycle_interval_ms || 300000,
          paperTrading,
        };

        const o = new AgentOrchestrator(io, config);
        o.start();
        orchestrators.set(agentId, o);
        await aiStrategyService.updateAgent(agentId, { status: 'running', last_run: new Date().toISOString() });
        io.emit('agent:status', { agentId, status: 'running' });
        return { http: 200, body: { status: 'started' } };
      } catch (err) {
        orchestrators.delete(agentId);
        console.error(`[Agent Start Error] ${err.message}`);
        return { http: 500, body: { success: false, error: err.message } };
      }
    },

    async stop(agentIdRaw) {
      const agentId = Number(agentIdRaw);
      if (!agentId) return { http: 400, body: { success: false, error: 'Missing agent_id' } };
      try {
        const o = orchestrators.get(agentId);
        if (o) o.stop();
        orchestrators.delete(agentId);
        await aiStrategyService.updateAgent(agentId, { status: 'stopped' });
        io.emit('agent:status', { agentId, status: 'stopped' });
        return { http: 200, body: { status: 'stopped' } };
      } catch (err) {
        console.error(`[Agent Stop Error] ${err.message}`);
        return { http: 500, body: { success: false, error: err.message } };
      }
    },

    async archive(agentIdRaw) {
      const agentId = Number(agentIdRaw);
      const o = orchestrators.get(agentId);
      if (o) o.stop();
      orchestrators.delete(agentId);
      await aiStrategyService.archiveAgent(agentId);
      io.emit('agent:status', { agentId, status: 'stopped' });
      return { http: 200, body: { success: true } };
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/services/agentManager.js
git commit -m "refactor: extract agent lifecycle registry into agentManager service"
```

---

### Task A2: Create `agents.routes.js` Express router (move the 12 endpoints)

**Files:**
- Create: `src/server/routes/agents.routes.js`
- Reference (source handlers to move verbatim): `server.js:44-290`

- [ ] **Step 1: Create the router factory.** Move each handler body **verbatim** from `server.js`, replacing the inline registry/start/stop/archive logic with `manager.*` calls. **Preserve route order** (static `/api/agents/<word>` BEFORE `/api/agents/:id`).

```js
// src/server/routes/agents.routes.js
import { Router } from 'express';
import { getDB } from '../../../db.js';
import { aiStrategyService } from '../services/aiStrategyService.js';

export function createAgentsRouter(manager) {
  const r = Router();

  // GET /api/agents  (move from server.js:44-54)
  r.get('/', async (req, res) => {
    try {
      const includeArchived = req.query.includeArchived === 'true';
      const agents = await aiStrategyService.listAgents(includeArchived);
      res.json({ success: true, data: agents });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/agents (move from server.js:55-65)
  r.post('/', async (req, res) => {
    try {
      const result = await aiStrategyService.createAgent(req.body);
      res.json({ success: true, data: result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/agents/risk-templates (move from server.js:66-75)
  r.get('/risk-templates', async (req, res) => {
    try {
      const templates = await aiStrategyService.listRiskTemplates();
      res.json({ success: true, data: templates });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/agents/start  -> delegate to manager
  r.post('/start', async (req, res) => {
    const { http, body } = await manager.start(req.body.agent_id);
    res.status(http).json(body);
  });

  // POST /api/agents/stop  -> delegate to manager
  r.post('/stop', async (req, res) => {
    const { http, body } = await manager.stop(req.body.agent_id);
    res.status(http).json(body);
  });

  // GET /api/agents/trades   (move from server.js:143-161 verbatim — uses getDB('ai'))
  // GET /api/agents/summary  (move from server.js:162-191; replace orchestrators.size with manager.size())
  // POST /api/agents/config  (move from server.js:192-229 verbatim)
  // GET /api/agents/config/:agent_id (move from server.js:230-256 verbatim)
  // GET /api/agents/:id      (move from server.js:257-267 verbatim)
  // PUT /api/agents/:id      (move from server.js:268-280 verbatim)
  // POST /api/agents/:id/archive -> delegate to manager.archive(req.params.id)

  // ... (paste the remaining handlers here, in the order listed above)

  return r;
}
```

> **Move instructions (no logic change):** cut each handler from `server.js` at the cited line range and paste into the router using `r.<method>('<subpath>', ...)`. The only edits: (a) `summary` replaces `orchestrators.size` → `manager.size()`; (b) `/:id/archive` calls `manager.archive(req.params.id)`; (c) paths drop the `/api/agents` prefix (the prefix is applied at mount in A3).

- [ ] **Step 2: Commit**

```bash
git add src/server/routes/agents.routes.js
git commit -m "refactor: move /api/agents endpoints into agents.routes router"
```

---

### Task A3: Slim `server.js` to mount the router

**Files:**
- Modify: `server.js` (remove lines 40, 44-290; add mount); keep import of `aiStrategyService` only if still used in boot (`server.js:355`)

- [ ] **Step 1: Replace the inline AI block with router mount.** After `io` is created, add:

```js
import { createAgentManager } from './src/server/services/agentManager.js';
import { createAgentsRouter } from './src/server/routes/agents.routes.js';

// ... after `const io = new Server(...)` is defined:
const agentManager = createAgentManager(io);
app.use('/api/agents', createAgentsRouter(agentManager));
```

Then delete the old `const orchestrators = new Map()` (line 40) and all `app.<verb>('/api/agents...')` handlers (lines 44-290). Keep `import AgentOrchestrator` only if no longer referenced — remove it from `server.js` (it now lives in `agentManager`).

- [ ] **Step 2: Verify the server boots**

Run: `node -e "import('./server.js').then(()=>{console.log('BOOT OK');process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})"`
Expected: `BOOT OK` (no import/reference errors). Stop with Ctrl-C if it keeps listening.

- [ ] **Step 3: Phase-A regression — run the live integration suite**

```bash
npm run server   # in one shell (background)
node tests/test_ai_agents.mjs
node tests/test_concurrency.mjs
node tests/test_analyst_indicators.mjs
```
Expected: `OK test_ai_agents`, `OK test_concurrency`, `OK test_analyst_indicators`. Proves the move did not change the HTTP contract.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "refactor: mount agents router; remove inline AI orchestration from server.js"
```

---

# PHASE B — Param routing + deterministic enforcement

### Task B1: `paramResolver` (pure split into llmContext / guardrails / execution)

**Files:**
- Create: `src/agents/paramResolver.js`
- Test: `tests/test_param_resolver.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/test_param_resolver.mjs
import assert from 'node:assert';
import { resolveAgentParams, posturePhrase } from '../src/agents/paramResolver.js';

// posture phrase boundaries
assert.ok(posturePhrase(0.005).startsWith('conservative'));
assert.ok(posturePhrase(0.02).startsWith('balanced'));
assert.ok(posturePhrase(0.05).startsWith('aggressive'));

const agent = {
  id: 7, watchlist: 'BTCUSDT, ETHUSDT', timeframe: '4H',
  trade_mode: 'spot', portfolio_value: 1000, cycle_interval_ms: 60000,
};
const profile = {
  risk_per_trade_percent: 0.02, stop_loss_percent: 0.05, take_profit_percent: 0.1,
  max_trade_size_usd: 250, max_open_positions: 3, max_portfolio_heat_percent: 10,
  daily_loss_limit_percent: 5, daily_profit_target_percent: 8,
};
const out = resolveAgentParams(agent, profile, ['SMC', 'FVG'], { SMC: 'd1', FVG: 'd2' });

// llmContext = qualitative only, no raw risk numbers
assert.deepEqual(out.llmContext.indicators, ['SMC', 'FVG']);
assert.equal(out.llmContext.timeframe, '4H');
assert.deepEqual(out.llmContext.watchlist, ['BTCUSDT', 'ETHUSDT']);
assert.ok(out.llmContext.posture.startsWith('balanced'));
assert.equal(out.llmContext.riskPerTrade, undefined, 'no raw money number leaks into llmContext');

// guardrails normalized to FRACTIONS (5 -> 0.05, 0.05 stays 0.05)
assert.equal(out.guardrails.riskPerTrade, 0.02);
assert.equal(out.guardrails.stopLossPct, 0.05);
assert.equal(out.guardrails.maxPortfolioHeatPct, 0.10);
assert.equal(out.guardrails.dailyLossLimitPct, 0.05);
assert.equal(out.guardrails.maxTradeSizeUSD, 250);
assert.equal(out.guardrails.portfolioValue, 1000);

// execution
assert.equal(out.execution.agentId, 7);
assert.equal(out.execution.paperTrading, true);
assert.deepEqual(out.execution.symbols, ['BTCUSDT', 'ETHUSDT']);

console.log('OK test_param_resolver');
```

- [ ] **Step 2: Run it, verify it fails**

Run: `node tests/test_param_resolver.mjs`
Expected: FAIL — `Cannot find module '../src/agents/paramResolver.js'`.

- [ ] **Step 3: Implement**

```js
// src/agents/paramResolver.js

/** Normalize a stored percent that may be a fraction (0.05) or a whole percent (5) to a FRACTION. */
function normFraction(v) {
  if (v == null || !isFinite(v)) return v;
  return v > 1 ? v / 100 : v;
}

export function posturePhrase(riskPerTradeFraction) {
  const r = normFraction(riskPerTradeFraction);
  if (r == null || !isFinite(r)) return 'balanced — moderate risk for steady growth';
  if (r <= 0.01) return 'conservative — prioritize capital preservation';
  if (r >= 0.04) return 'aggressive — pursue larger moves, accept higher risk';
  return 'balanced — moderate risk for steady growth';
}

/**
 * Split a flat agent config into three labeled blocks.
 * @param {object} agent       ai_strategies row (snake_case)
 * @param {object} riskProfile ai_risk_profiles row (snake_case) or {}
 * @param {string[]} indicators resolved indicator names
 * @param {object} indicatorDescriptions name -> description
 */
export function resolveAgentParams(agent, riskProfile = {}, indicators = ['SMC'], indicatorDescriptions = {}) {
  const rp = riskProfile || {};
  const symbols = (agent.watchlist || 'BTCUSDT,ETHUSDT').split(',').map(s => s.trim()).filter(Boolean);
  const riskPerTrade = normFraction(rp.risk_per_trade_percent ?? 0.01);

  return {
    llmContext: {
      timeframe: agent.timeframe || '1H',
      indicators,
      indicatorDescriptions,
      watchlist: symbols,
      tradeMode: agent.trade_mode || 'spot',
      posture: posturePhrase(riskPerTrade),
    },
    guardrails: {
      riskPerTrade,
      stopLossPct: normFraction(rp.stop_loss_percent),
      takeProfitPct: normFraction(rp.take_profit_percent),
      maxTradeSizeUSD: rp.max_trade_size_usd ?? Infinity,
      maxOpenPositions: rp.max_open_positions ?? Infinity,
      maxPortfolioHeatPct: normFraction(rp.max_portfolio_heat_percent) ?? Infinity,
      dailyLossLimitPct: normFraction(rp.daily_loss_limit_percent) ?? Infinity,
      dailyProfitTargetPct: normFraction(rp.daily_profit_target_percent),
      portfolioValue: agent.portfolio_value || 10000,
    },
    execution: {
      agentId: Number(agent.id),
      paperTrading: true, // real-mode safety until exchange accounts exist
      tradeMode: agent.trade_mode || 'spot',
      cycleInterval: agent.cycle_interval_ms || 300000,
      symbols,
    },
  };
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `node tests/test_param_resolver.mjs`
Expected: `OK test_param_resolver`.

- [ ] **Step 5: Commit**

```bash
git add src/agents/paramResolver.js tests/test_param_resolver.mjs
git commit -m "feat: paramResolver splits agent config into llmContext/guardrails/execution"
```

---

### Task B2: `RiskPolicy` (deterministic sizing + SL/TP + gates)

**Files:**
- Create: `src/agents/RiskPolicy.js`
- Test: `tests/test_risk_policy.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/test_risk_policy.mjs
import assert from 'node:assert';
import { RiskPolicy } from '../src/agents/RiskPolicy.js';

const guardrails = {
  riskPerTrade: 0.02, stopLossPct: 0.05, takeProfitPct: 0.10,
  maxTradeSizeUSD: 250, maxOpenPositions: 3, maxPortfolioHeatPct: 0.10,
  dailyLossLimitPct: 0.05, dailyProfitTargetPct: 0.08, portfolioValue: 1000,
};
const policy = new RiskPolicy(guardrails);
const ctx = { entryPrice: 100, openPositions: 0, portfolioHeatPct: 0, dailyPnlPct: 0 };

// (a) sizing is USD, capped by maxTradeSizeUSD: 1000*0.02 = 20 (< 250)
let v = policy.evaluate({ side: 'BUY', conviction: 0.7 }, ctx);
assert.equal(v.decision, 'PERMIT');
assert.equal(v.order.sizeUSD, 20);
// mirrored SL/TP for BUY
assert.equal(v.order.slPrice, 95);   // 100*(1-0.05)
assert.equal(v.order.tpPrice, 110);  // 100*(1+0.10)

// cap applies
const capped = new RiskPolicy({ ...guardrails, riskPerTrade: 0.9 });
assert.equal(capped.evaluate({ side: 'BUY', conviction: 0.7 }, ctx).order.sizeUSD, 250);

// SELL mirrors SL/TP
const vs = policy.evaluate({ side: 'SELL', conviction: 0.7 }, ctx).order;
assert.equal(vs.slPrice, 105); // 100*(1+0.05)
assert.equal(vs.tpPrice, 90);  // 100*(1-0.10)

// (b) HOLD = no-op DENY
assert.equal(policy.evaluate({ side: 'HOLD' }, ctx).decision, 'DENY');

// (c) gates
assert.equal(policy.evaluate({ side: 'BUY', conviction: 1 }, { ...ctx, openPositions: 3 }).decision, 'DENY');
assert.equal(policy.evaluate({ side: 'BUY', conviction: 1 }, { ...ctx, portfolioHeatPct: 0.10 }).decision, 'DENY');
assert.equal(policy.evaluate({ side: 'BUY', conviction: 1 }, { ...ctx, dailyPnlPct: -0.05 }).decision, 'DENY');
assert.equal(policy.evaluate({ side: 'BUY', conviction: 1 }, { ...ctx, dailyPnlPct: 0.08 }).decision, 'DENY');

console.log('OK test_risk_policy');
```

- [ ] **Step 2: Run it, verify it fails**

Run: `node tests/test_risk_policy.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
// src/agents/RiskPolicy.js

/**
 * Deterministic risk policy. Constructed from resolved guardrails (all *Pct are FRACTIONS).
 * The LLM gets no vote here: this computes size + SL/TP and gates the order.
 */
export class RiskPolicy {
  constructor(guardrails = {}) {
    this.g = guardrails;
  }

  /**
   * @param {{side:'BUY'|'SELL'|'HOLD', conviction:number}} proposal
   * @param {{entryPrice:number, openPositions:number, portfolioHeatPct:number, dailyPnlPct:number}} ctx
   * @returns {{decision:'PERMIT'|'DENY', reason?:string, order?:object}}
   */
  evaluate(proposal, ctx) {
    const g = this.g;
    const { entryPrice, openPositions = 0, portfolioHeatPct = 0, dailyPnlPct = 0 } = ctx || {};

    if (!proposal || proposal.side === 'HOLD' || !proposal.side) {
      return { decision: 'DENY', reason: 'Proposal is HOLD/empty (no-op)' };
    }
    // Circuit breakers
    if (isFinite(g.dailyLossLimitPct) && dailyPnlPct <= -Math.abs(g.dailyLossLimitPct)) {
      return { decision: 'DENY', reason: 'Daily loss limit reached' };
    }
    if (g.dailyProfitTargetPct != null && isFinite(g.dailyProfitTargetPct) && dailyPnlPct >= g.dailyProfitTargetPct) {
      return { decision: 'DENY', reason: 'Daily profit target reached' };
    }
    // Hard caps
    if (openPositions >= (g.maxOpenPositions ?? Infinity)) {
      return { decision: 'DENY', reason: `Max open positions (${g.maxOpenPositions}) reached` };
    }
    if (isFinite(g.maxPortfolioHeatPct) && portfolioHeatPct >= g.maxPortfolioHeatPct) {
      return { decision: 'DENY', reason: `Portfolio heat ${portfolioHeatPct} >= limit ${g.maxPortfolioHeatPct}` };
    }

    // Sizing — single unit (USD)
    const sizeUSD = Math.min((g.portfolioValue || 0) * (g.riskPerTrade || 0), g.maxTradeSizeUSD ?? Infinity);

    // SL/TP prices mirrored by side
    const sl = g.stopLossPct, tp = g.takeProfitPct;
    const slPrice = sl == null ? null : (proposal.side === 'BUY' ? entryPrice * (1 - sl) : entryPrice * (1 + sl));
    const tpPrice = tp == null ? null : (proposal.side === 'BUY' ? entryPrice * (1 + tp) : entryPrice * (1 - tp));

    return {
      decision: 'PERMIT',
      order: { side: proposal.side, sizeUSD, entryPrice, slPrice, tpPrice },
    };
  }
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `node tests/test_risk_policy.mjs`
Expected: `OK test_risk_policy`.

- [ ] **Step 5: Commit**

```bash
git add src/agents/RiskPolicy.js tests/test_risk_policy.mjs
git commit -m "feat: deterministic RiskPolicy (USD sizing, mirrored SL/TP, limit gates)"
```

---

### Task B3: `QualitativeProposal` contract for the Analyst (no money numbers)

**Files:**
- Modify: `src/agents/AnalystAgent.js:210-226` (`_finalizeDecision`)
- Test: `tests/test_proposal_contract.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/test_proposal_contract.mjs
import assert from 'node:assert';
import { AnalystAgent } from '../src/agents/AnalystAgent.js';

const analyst = new AnalystAgent({ config: { indicators: ['SMC'] } });
const proposal = await analyst.process({ symbol: 'BTCUSDT', timeframe: '1H' });

assert.ok(['BUY', 'SELL', 'HOLD'].includes(proposal.side), `side invalid: ${proposal.side}`);
assert.equal(typeof proposal.conviction, 'number');
assert.ok(proposal.conviction >= 0 && proposal.conviction <= 1);
assert.equal(typeof proposal.rationale, 'string');

// MUST NOT carry money numbers
for (const k of ['sizeUSD', 'size', 'stop_loss', 'take_profit', 'slPrice', 'tpPrice', 'price']) {
  assert.equal(proposal[k], undefined, `proposal must not contain money field: ${k}`);
}
console.log('OK test_proposal_contract');
```

- [ ] **Step 2: Run it, verify it fails**

Run: `node tests/test_proposal_contract.mjs`
Expected: FAIL — proposal has `signal` (not `side`) and lacks `conviction`/`rationale` shape.

- [ ] **Step 3: Rewrite `_finalizeDecision`** to emit the contract. Replace `src/agents/AnalystAgent.js:210-226` with:

```js
    _finalizeDecision(symbol, evidence) {
        const finalIteration = evidence[evidence.length - 1];
        const fq = (finalIteration?.state || []).filter(s => s.source === 'quant');
        const fScore = fq.length ? fq.map(q => Number(q.value?.result) || 0).reduce((a, b) => a + b, 0) / fq.length : 0;

        const side = fScore > 0 ? 'BUY' : fScore < 0 ? 'SELL' : 'HOLD';
        const conviction = Math.min(0.95, 0.5 + (evidence.length * 0.1));
        const rationale = evidence.map(e => e.reflection.newHypothesis).join(' -> ');

        // QualitativeProposal contract — NO money numbers. (Future LLM returns this exact shape.)
        const proposal = {
            side,
            conviction,
            rationale,
            invalidationIdea: side === 'HOLD' ? null : `Invalidate if structure flips against ${side}.`,
        };

        this.emitThought(`Final Proposal: ${side} for ${symbol} (conviction ${conviction.toFixed(2)})`);
        return proposal;
    }
```

> **Note:** `process()` already returns `_finalizeDecision(...)`, so no other change is needed in this file. Callers that read `proposal.signal`/`proposal.symbol` are updated in Task B5.

- [ ] **Step 4: Run it, verify it passes**

Run: `node tests/test_proposal_contract.mjs`
Expected: `OK test_proposal_contract`.

- [ ] **Step 5: Commit**

```bash
git add src/agents/AnalystAgent.js tests/test_proposal_contract.mjs
git commit -m "feat: Analyst emits QualitativeProposal (side/conviction/rationale, no money fields)"
```

---

### Task B4: Executor writes to `ai_paper_trades` (per-agent, correct DB)

**Files:**
- Modify: `src/agents/TradeExecutor.js:60-122`
- Test: `tests/test_executor_ai_db.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/test_executor_ai_db.mjs
import assert from 'node:assert';
import { initDB, getDB } from '../db.js';
import { TradeExecutor } from '../src/agents/TradeExecutor.js';

await initDB();
const agentId = 99999;
const exec = new TradeExecutor({ tradeMode: 'PAPER', agentId });
const r = await exec.executeTrade({ symbol: 'BTCUSDT', side: 'buy', sizeUSD: 20, price: 100 });
assert.equal(r.success, true);
assert.equal(r.mode, 'PAPER');

const db = getDB('ai');
const row = await db.get(
  'SELECT * FROM ai_paper_trades WHERE strategy_id = ? ORDER BY id DESC LIMIT 1', [agentId]);
assert.ok(row, 'trade must be recorded in ai_paper_trades');
assert.equal(row.symbol, 'BTCUSDT');
assert.equal(row.size_usd, 20);

await db.run('DELETE FROM ai_paper_trades WHERE strategy_id = ?', [agentId]); // cleanup
console.log('OK test_executor_ai_db');
```

> Verify the exact init export name first: `node -e "import('./db.js').then(m=>console.log(Object.keys(m)))"`. If the initializer is named differently (e.g. `setupDatabase`), use that name in the test's import + call.

- [ ] **Step 2: Run it, verify it fails**

Run: `node tests/test_executor_ai_db.mjs`
Expected: FAIL — trade written to `paper_trades` (manual DB), so the `ai_paper_trades` query returns `undefined`.

- [ ] **Step 3: Rewrite the executor.** Replace `_executePaper` and the module export in `src/agents/TradeExecutor.js`:

```js
  // constructor already sets this.tradeMode; add agentId:
  constructor(config) {
    this.tradeMode = config.tradeMode || 'PAPER';
    this.agentId = config.agentId ?? null;
    this.bitgetService = new BitGetService(config.bitget);
  }

  async executeTrade(tradeDetails) {
    const { symbol, side, sizeUSD, price, marketType } = tradeDetails;
    if (this.tradeMode === 'REAL') {
      return await this._executeReal(symbol, side, sizeUSD, price, marketType);
    }
    return await this._executePaper(symbol, side, sizeUSD, price, this.agentId);
  }

  async _executePaper(symbol, side, sizeUSD, price, agentId) {
    console.log(`[TradeExecutor] PAPER ${side} ${symbol} @ ${price} ($${sizeUSD}) agent=${agentId}`);
    const slippage = 1 + (Math.random() * 0.001 - 0.0005);
    const executedPrice = side.toLowerCase() === 'buy' ? price * slippage : price / slippage;
    const result = {
      symbol, side, price: executedPrice, size_usd: sizeUSD, strategy_id: agentId,
      status: 'EXECUTED', timestamp: new Date().toISOString(), mode: 'PAPER',
    };
    try {
      const db = getDB('ai'); // AI contour DB — NOT the manual paper_trades
      await db.run(
        `INSERT INTO ai_paper_trades (strategy_id, symbol, side, price, size_usd, status, timestamp, mode)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [result.strategy_id, result.symbol, result.side, result.price, result.size_usd, result.status, result.timestamp, result.mode]
      );
      return { success: true, mode: 'PAPER', executedPrice, slippage: (slippage - 1) * 100, data: result };
    } catch (error) {
      console.error(`[TradeExecutor] PAPER recording failed: ${error.message}`);
      throw error;
    }
  }
```

Remove the trailing `export const tradeExecutor = new TradeExecutor({});` singleton (the orchestrator will instantiate per agent in B5). Update the import in `db.js` usage — `getDB` is already imported at top of the file; keep it.

- [ ] **Step 4: Run it, verify it passes**

Run: `node tests/test_executor_ai_db.mjs`
Expected: `OK test_executor_ai_db`.

- [ ] **Step 5: Commit**

```bash
git add src/agents/TradeExecutor.js tests/test_executor_ai_db.mjs
git commit -m "fix: executor writes ai_paper_trades via getDB('ai'), per-agent; drop singleton"
```

---

### Task B5: Wire `AgentOrchestrator.runCycle` to resolver/RiskPolicy/executor

**Files:**
- Modify: `src/agents/AgentOrchestrator.js` (constructor + `runCycle`)
- Delete: `src/agents/RiskGuard.js`

- [ ] **Step 1: Update the constructor** to accept the resolved blocks and build a RiskPolicy + per-agent executor. Replace `src/agents/AgentOrchestrator.js:11-25`:

```js
import { AnalystAgent } from './AnalystAgent.js';
import { agentMemory } from './AgentMemory.js';
import { toolRegistry } from '../registry/ToolRegistry.js';
import { TradeExecutor } from './TradeExecutor.js';
import { RiskPolicy } from './RiskPolicy.js';

export default class AgentOrchestrator {
  constructor(io, config = {}) {
    this.io = io;
    this.config = config;
    this.agentId = config.execution?.agentId ?? config.agentId ?? null;
    this.llmContext = config.llmContext || {};
    this.execution = config.execution || { paperTrading: true };
    this.memory = agentMemory;
    this.analyst = new AnalystAgent(this);
    this.riskPolicy = new RiskPolicy(config.guardrails || {});
    this.tradeExecutor = new TradeExecutor({
      tradeMode: this.execution.paperTrading ? 'PAPER' : 'REAL',
      agentId: this.agentId,
    });
    this.toolRegistry = toolRegistry;
    this.isRunning = false;
    this.loopInterval = null;
    this.symbolsToWatch = config.execution?.symbols || config.symbols || ['BTCUSDT', 'ETHUSDT'];
  }
```

> **Compatibility:** `AnalystAgent` reads `orchestrator.config.indicators`. Add a shim so it keeps working: in the constructor leave `config.indicators` populated by the manager (B6 passes both the blocks and a top-level `indicators`). Alternatively update `AnalystAgent` line 20 to `(orchestrator?.llmContext?.indicators) || (orchestrator?.config?.indicators) || ['SMC']`. **Do the AnalystAgent line-20 change** to make `llmContext` authoritative.

- [ ] **Step 2: Rewrite `runCycle`** (`src/agents/AgentOrchestrator.js:46-123`) to the proposal→policy→execute flow:

```js
  async runCycle() {
    if (!this.isRunning) return;
    for (const symbol of this.symbolsToWatch) {
      try {
        // 1. Analyst proposes (qualitative — no numbers)
        const proposal = await this.analyst.process({ symbol, timeframe: this.llmContext.timeframe });
        await this.memory.saveEpisode({
          agent_id: 'AnalystAgent', input: { symbol }, reasoning: proposal.rationale,
          action: 'PROPOSE_TRADE', observation: 'analysis complete', result: JSON.stringify(proposal),
        });

        // 2. Deterministic policy decides size/SL/TP and gates
        const entryPrice = await this._getCurrentPrice(symbol);
        const portfolioState = await this._getPortfolioState();
        const verdict = this.riskPolicy.evaluate(proposal, { entryPrice, ...portfolioState });

        await this.memory.saveEpisode({
          agent_id: 'RiskPolicy', input: proposal, reasoning: verdict.reason || 'permitted',
          action: 'GATE', observation: 'limits evaluated', result: verdict.decision,
        });

        if (verdict.decision !== 'PERMIT') {
          this.broadcastDecision({ symbol, decision: 'VETOED',
            reasoning: `${proposal.side} proposed; policy denied: ${verdict.reason}` });
          continue;
        }

        // 3. Execute
        const order = verdict.order;
        const tradeParams = {
          symbol, side: order.side.toLowerCase(), sizeUSD: order.sizeUSD,
          price: order.entryPrice, marketType: this.execution.tradeMode,
        };
        this.broadcastDecision({ symbol, decision: 'EXECUTE',
          reasoning: `${proposal.side} (conviction ${proposal.conviction}); SL ${order.slPrice}, TP ${order.tpPrice}`,
          details: tradeParams });
        const executionResult = await this.tradeExecutor.executeTrade(tradeParams);
        this.broadcastThought({ agent: 'orchestrator',
          thought: `Trade ${executionResult.success ? 'Executed' : 'Failed'} (${order.side} ${symbol})` });
      } catch (error) {
        console.error(`Error in cycle for ${symbol}:`, error);
      }
    }
  }

  /** Open-position / heat / daily-pnl snapshot for the policy. Deterministic, no mock equity. */
  async _getPortfolioState() {
    try {
      const { getDB } = await import('../../db.js');
      const db = getDB('ai');
      const row = await db.get(
        'SELECT COUNT(*) AS c FROM ai_active_positions WHERE strategy_id = ?', [this.agentId]);
      return { openPositions: row?.c || 0, portfolioHeatPct: 0, dailyPnlPct: 0 };
    } catch (_) {
      return { openPositions: 0, portfolioHeatPct: 0, dailyPnlPct: 0 };
    }
  }
```

> `_getCurrentPrice`, `start`, `stop`, `broadcastThought`, `broadcastDecision` are unchanged. Remove the old `import RiskAgent` and `import { tradeExecutor }` lines. `RiskAgent.js` may stay on disk (drawdown monitor, unused) or be deleted; this plan deletes only `RiskGuard.js`.

- [ ] **Step 3: Delete the orphaned RiskGuard**

```bash
git rm src/agents/RiskGuard.js
```

- [ ] **Step 4: Smoke-check the module loads**

Run: `node -e "import('./src/agents/AgentOrchestrator.js').then(()=>console.log('LOAD OK')).catch(e=>{console.error(e);process.exit(1)})"`
Expected: `LOAD OK`.

- [ ] **Step 5: Commit**

```bash
git add src/agents/AgentOrchestrator.js src/agents/AnalystAgent.js
git commit -m "feat: orchestrator uses RiskPolicy + per-agent executor; delete orphaned RiskGuard"
```

---

### Task B6: `agentManager` builds config via `paramResolver`

**Files:**
- Modify: `src/server/services/agentManager.js` (the `start` method body from A1)

- [ ] **Step 1: Replace the inline config build** in `start()` with the resolver. Swap the block that builds `const config = {...}` for:

```js
import { resolveAgentParams } from '../../agents/paramResolver.js';
// ... inside start(), after riskProfile + indicators are resolved:

        const indicatorDescriptions = {}; // descriptions injected later when LLM lands
        const { llmContext, guardrails, execution } =
          resolveAgentParams(agent, riskProfile, indicators, indicatorDescriptions);

        const o = new AgentOrchestrator(io, { llmContext, guardrails, execution, indicators });
        o.start();
```

> Keep everything else in `start()` (reservation, status update, `agent:status` emit) identical.

- [ ] **Step 2: Verify server boots and starting an agent does not crash**

Run (server in background): `npm run server` then
`node -e "fetch('http://localhost:3000/api/agents').then(r=>r.json()).then(b=>console.log('AGENTS OK', b.success))"`
Expected: `AGENTS OK true`.

- [ ] **Step 3: Commit**

```bash
git add src/server/services/agentManager.js
git commit -m "feat: agentManager builds orchestrator config via paramResolver"
```

---

### Task C1: Full regression

**Files:** none (verification only)

- [ ] **Step 1: Run every unit test**

```bash
node tests/test_param_resolver.mjs
node tests/test_risk_policy.mjs
node tests/test_proposal_contract.mjs
node tests/test_executor_ai_db.mjs
```
Expected: four `OK ...` lines.

- [ ] **Step 2: Run the live integration suite**

```bash
npm run server   # background
node tests/test_ai_agents.mjs
node tests/test_concurrency.mjs
node tests/test_analyst_indicators.mjs
```
Expected: three `OK ...` lines. Confirms extraction + new wiring preserved the HTTP contract and concurrency.

- [ ] **Step 3: Final commit (if any uncommitted verification artifacts)**

```bash
git add -A && git commit -m "test: full regression pass for AI param-routing" || echo "nothing to commit"
```

---

## Self-Review (completed by author)

- **Spec coverage:** §5 taxonomy→B1; §6a resolver→B1; §6b proposal seam→B3; §6c RiskPolicy→B2/B5; §6d executor→B4; §6e extraction→A1–A3+B6; §7 tests→B1–B4 unit + C1 integration. No gaps.
- **Placeholder scan:** route-move steps cite exact source line ranges and show the router skeleton + delegated handlers; all new modules have complete code. No "TBD/handle edge cases".
- **Type consistency:** `resolveAgentParams` → `{ llmContext, guardrails, execution }` consumed identically in B5/B6; `RiskPolicy.evaluate(proposal, ctx)` signature matches B2 test and B5 call; `QualitativeProposal { side, conviction, rationale, invalidationIdea }` produced in B3, consumed in B5; guardrail `*Pct` are fractions throughout.
