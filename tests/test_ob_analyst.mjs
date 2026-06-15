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

const hold = proposalFromSignal({ type: 'signal', sym: 'X' });
assert.equal(hold.side, 'HOLD'); ok('missing side → HOLD');
assert.equal(hold.invalidationIdea, null); ok('HOLD invalidationIdea null');

const holdNull = proposalFromSignal(null);
assert.equal(holdNull.side, 'HOLD'); ok('null record → HOLD');

console.log(`\n${p} checks passed`);
