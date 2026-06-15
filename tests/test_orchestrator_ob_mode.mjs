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

console.log(`\n${p} checks passed`);
