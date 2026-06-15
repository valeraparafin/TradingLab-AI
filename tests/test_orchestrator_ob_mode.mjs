// tests/test_orchestrator_ob_mode.mjs
import assert from 'node:assert';
import AgentOrchestrator from '../src/agents/AgentOrchestrator.js';

let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

const io = { emit() {} };

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
o.tradeExecutor = fakeExecutor;
o.isRunning = true;

await o._obDrainTick();

assert.equal(executed.length, 1, 'one paper trade'); ok('drain → one execution');
assert.equal(executed[0].side, 'buy'); ok('side buy (lowercased)');
assert.equal(executed[0].price, 100.5); ok('priced at signal entryMid');

await o._obDrainTick();
assert.equal(executed.length, 1); ok('empty drain → no new trade');

let analystCalled = false;
o.analyst = { process: async () => { analystCalled = true; return { side: 'HOLD', conviction: 0 }; } };
o._getPortfolioState = async () => ({ openPositions: 0, portfolioHeatPct: 0, dailyPnlPct: 0, tradesToday: 0 });
o._recordTelemetry = async () => {};
await o.runCycle();
assert.equal(analystCalled, false); ok('runCycle bypasses candle analyst in OB mode');

o.stop();
assert.equal(engine.stopped, true); ok('stop() stops the engine');

// ─── Position lifecycle (Task 4) ───
{
  const opened = [];
  const closed = [];
  const svc = await import('../src/server/services/aiStrategyService.js');
  const orig = { ...svc.aiStrategyService };
  svc.aiStrategyService.openPosition = async (aid, pos) => { opened.push(pos); return { opened: true }; };
  svc.aiStrategyService.listOpenPositions = async () => opened.map((o) => ({ ...o }));
  svc.aiStrategyService.recordClosedTrade = async (t) => { closed.push(t); };
  svc.aiStrategyService.closePosition = async () => { opened.length = 0; return { changes: 1 }; };

  let mid = 100;
  const fakeEngine2 = {
    start() {}, stop() {},
    drainSignals: (() => { let fired = false; return () => { if (fired) return []; fired = true;
      return [{ side: 'BUY', conviction: 0.7, entryMid: 100, invalidation: 99, rationale: 'ob' }]; }; })(),
    getLatestFeatures: () => ({ futures: { mid } }),
  };
  const io2 = { emit() {} };
  const { default: AgentOrchestrator } = await import('../src/agents/AgentOrchestrator.js');
  const o2 = new AgentOrchestrator(io2, {
    agentId: 990002,
    execution: { agentId: 990002, symbols: ['BTCUSDT'], tradeMode: 'spot', paperTrading: true },
    guardrails: { stopMode: 'structural', structuralRR: 2, minRiskRewardRatio: 0, portfolioValue: 500, riskPerTrade: 0.01, maxTradeSizeUSD: 1000, leverage: 1 },
    obEngine: fakeEngine2, obConfig: { drainIntervalMs: 10000 },
  });
  o2.isRunning = true;
  o2._getPortfolioState = async () => ({ openPositions: 0, portfolioHeatPct: 0, dailyPnlPct: 0, tradesToday: 0 });
  o2.tradeExecutor = { executeTrade: async (t) => ({ success: true, mode: 'PAPER', executedPrice: t.price, data: {} }) };

  await o2._obDrainTick();
  assert.equal(opened.length, 1); ok('drain opens one position');
  assert.equal(opened[0].side, 'BUY'); ok('opened side BUY');

  mid = 102;
  await o2._sweepExits({ BTCUSDT: mid });
  assert.equal(closed.length, 1); ok('sweep closes at TP');
  assert.equal(closed[0].exit_reason, 'TP'); ok('exit reason TP');
  assert.ok(closed[0].pnl_usd > 0); ok('pnl positive at TP');

  Object.assign(svc.aiStrategyService, orig);
}

console.log(`\n${p} checks passed`);
