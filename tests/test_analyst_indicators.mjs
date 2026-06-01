import assert from 'node:assert';
import { AnalystAgent } from '../src/agents/AnalystAgent.js';

const calls = [];
const agent = new AnalystAgent({ broadcastThought() {}, config: { indicators: ['SMC', 'Breakout'] } });
agent.tools = {
  get_indicator: async ({ indicatorType }) => { calls.push(indicatorType); return { success: true, data: { result: 1 } }; },
  get_candles: async () => ({ success: true, data: [] }),
};

await agent._gatherEvidence('BTCUSDT', '1H', {});
assert.deepEqual(calls.sort(), ['Breakout', 'SMC'], 'calls get_indicator once per configured indicator');
console.log('OK test_analyst_indicators');
