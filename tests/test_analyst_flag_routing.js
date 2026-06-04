// tests/test_analyst_flag_routing.js
// Routing tests through AnalystAgent.process(): OFF = simulated loop (unchanged),
// ON = delegate to the pure signal core. Tools are stubbed so no network happens.
import assert from 'node:assert';
import { AnalystAgent } from '../src/agents/AnalystAgent.js';
import { deriveAgentProposal } from '../src/agents/deriveAgentProposal.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

// 110-candle fixture that drives SMC to a bullish structure break (see Task 1).
function bullishSMCCandles() {
  const candles = Array.from({ length: 110 }, (_, i) =>
    ({ time: i, open: 7, high: 10, low: 5, close: 7, volume: 10 }));
  candles[55].high = 20;
  candles[109].high = 25;
  candles[109].close = 25;
  return candles;
}

// Build an agent with a fake orchestrator (config flag + indicators) and stubbed tools.
function makeAgent({ useSignalCore, indicators }, tools) {
  const agent = new AnalystAgent({
    config: { useSignalCore },
    llmContext: { indicators },
  });
  agent.tools = tools; // replace the real ToolRegistry — no network in tests
  return agent;
}

// --- OFF: simulated reflection loop runs (flag false, env irrelevant) ---
{
  const agent = makeAgent({ useSignalCore: false, indicators: ['SMC'] }, {
    get_indicator: async () => ({ success: true, data: { result: 5 } }), // positive quant score
    get_candles: async () => ({ success: true, data: [
      { time: 1, open: 100, high: 101, low: 99, close: 100, volume: 1 }] }),
  });
  const p = await agent.process({ symbol: 'BTCUSDT', timeframe: '1H' });
  assert.strictEqual(p.side, 'BUY'); // fScore 5 > 0 → BUY (simulated path)
  assert.ok(/Market/.test(p.rationale), 'simulated hypothesis-chain rationale');
  ok('OFF → simulated path (BUY from stubbed quant score)');
}

// --- ON: process() delegates fully to deriveAgentProposal on the fetched candles ---
{
  const candles = bullishSMCCandles();
  const agent = makeAgent({ useSignalCore: true, indicators: ['SMC'] }, {
    get_candles: async () => ({ success: true, data: candles }),
  });
  const p = await agent.process({ symbol: 'BTCUSDT', timeframe: '1H' });
  const expected = deriveAgentProposal({
    indicators: ['SMC'], logicConfig: {}, candles, price: candles[candles.length - 1].close });
  assert.deepStrictEqual(p, expected);
  assert.strictEqual(p.side, 'BUY'); // sanity: fixture is non-trivial
  ok('ON → core proposal (process == deriveAgentProposal)');
}

// --- ON + no core-supported logicType → HOLD reaches the agent output ---
{
  const agent = makeAgent({ useSignalCore: true, indicators: ['FVG'] }, {
    get_candles: async () => ({ success: true, data: [
      { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 }] }),
  });
  const p = await agent.process({ symbol: 'X', timeframe: '1H' });
  assert.strictEqual(p.side, 'HOLD');
  assert.strictEqual(p.conviction, 0);
  ok('ON + unsupported indicators → HOLD');
}

// --- ON + candle fetch fails → HOLD fallback (process never calls the core with no data) ---
{
  const agent = makeAgent({ useSignalCore: true, indicators: ['SMC'] }, {
    get_candles: async () => ({ success: false, data: null, error: 'boom' }),
  });
  const p = await agent.process({ symbol: 'X', timeframe: '1H' });
  assert.strictEqual(p.side, 'HOLD');
  ok('ON + candle fetch fails → HOLD');
}

console.log(`\n${passed} checks passed`);
