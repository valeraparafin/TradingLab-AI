// tests/test_derive_agent_proposal.js
// Pure-module tests for the AI agent's signal-core seam.
import assert from 'node:assert';
import { deriveAgentProposal, pickLogicType } from '../src/agents/deriveAgentProposal.js';
import { deriveSignal } from '../src/core/SignalAdapter.js';
import { IndicatorManager } from '../src/indicators/index.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

// --- pickLogicType: first core-supported indicator wins, else null ---
assert.strictEqual(pickLogicType(['SMC']), 'SMC');
ok('pickLogicType single supported');
assert.strictEqual(pickLogicType(['FVG', 'Breakout']), 'Breakout');
ok('pickLogicType skips unsupported, picks first supported');
assert.strictEqual(pickLogicType(['FVG', 'OrderBlocks']), null);
ok('pickLogicType none supported → null');
assert.strictEqual(pickLogicType([]), null);
ok('pickLogicType empty → null');
assert.strictEqual(pickLogicType(undefined), null);
ok('pickLogicType undefined (default param) → null');

// --- no core-supported logicType → HOLD proposal (candles never touched) ---
{
  const p = deriveAgentProposal({ indicators: ['FVG'], candles: [], price: 0 });
  assert.strictEqual(p.side, 'HOLD');
  assert.strictEqual(p.conviction, 0);
  assert.strictEqual(p.invalidationIdea, null);
  assert.ok(/no core-supported logicType/i.test(p.rationale), 'rationale names the gap');
  ok('no supported logicType → HOLD');
}

// --- error safety: bad candles must NOT throw into the caller ---
{
  // candles=null makes IndicatorManager.calculate throw; deriveAgentProposal must catch.
  const p = deriveAgentProposal({ indicators: ['SMC'], candles: null, price: 0 });
  assert.strictEqual(p.side, 'HOLD');
  assert.strictEqual(p.conviction, 0);
  assert.ok(/signal core error/i.test(p.rationale), 'rationale flags the core error');
  ok('throwing core path → HOLD, no throw');
}

// --- neutral SMC (too few candles for pivots) → HOLD, invalidationIdea null ---
{
  const flat = Array.from({ length: 60 }, (_, i) =>
    ({ time: i, open: 100, high: 101, low: 99, close: 100, volume: 10 }));
  const p = deriveAgentProposal({ indicators: ['SMC'], candles: flat, price: 100 });
  assert.strictEqual(p.side, 'HOLD');
  assert.strictEqual(p.invalidationIdea, null);
  ok('neutral SMC → HOLD');
}

// --- bullish SMC fixture → exact mapping of Signal → QualitativeProposal ---
{
  // 110 flat candles with a lone pivot high (price 20) at index 55, then a final
  // close (25) that breaks above it → SMC trend=1 (bullish BOS at price 20).
  const candles = Array.from({ length: 110 }, (_, i) =>
    ({ time: i, open: 7, high: 10, low: 5, close: 7, volume: 10 }));
  candles[55].high = 20;     // unique pivot high in the [5,105] window → lastHigh = 20
  candles[109].high = 25;    // keep high >= close
  candles[109].close = 25;   // currentClose 25 > lastHigh 20 → bullish structure break
  const price = candles[candles.length - 1].close;

  const expected = deriveSignal('SMC', new IndicatorManager({}).calculate('SMC', candles), { price, candles });
  assert.strictEqual(expected.side, 'BUY', 'fixture sanity: SMC should be bullish');

  const p = deriveAgentProposal({ indicators: ['SMC'], logicConfig: {}, candles, price });
  assert.strictEqual(p.side, expected.side);
  assert.strictEqual(p.conviction, expected.conviction);
  assert.strictEqual(p.rationale, expected.reason);
  assert.strictEqual(p.invalidationIdea, expected.invalidation ?? null);
  assert.strictEqual(typeof p.invalidationIdea, 'number');
  ok(`bullish SMC mapping (side ${p.side}, invalidationIdea ${p.invalidationIdea})`);
}

console.log(`\n${passed} checks passed`);
