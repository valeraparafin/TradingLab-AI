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
