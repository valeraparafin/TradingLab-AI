import assert from 'assert';
import { deriveSignal } from '../src/core/SignalAdapter.js';
import { SIDE } from '../src/core/contracts.js';

const tests = [];
const add = (name, fn) => tests.push({ name, fn });

// ---- SMC ----
add('SMC bullish trend → BUY with confluence', () => {
  const raw = {
    structure: { trend: 1, structure: [{ type: 'BOS', bias: 'bullish', price: 105 }] },
    obs: [{ range: { top: 106, bottom: 104 } }],
    fvgs: [],
  };
  const s = deriveSignal('SMC', raw, { price: 110, candles: [] });
  assert.strictEqual(s.side, SIDE.BUY);
  assert.ok(Math.abs(s.conviction - 0.9) < 1e-9, `conviction ${s.conviction}`);
  assert.strictEqual(s.invalidation, 105);
});

add('SMC bearish trend → SELL', () => {
  const raw = { structure: { trend: -1, structure: [] }, obs: [], fvgs: [] };
  const s = deriveSignal('SMC', raw, { price: 90, candles: [] });
  assert.strictEqual(s.side, SIDE.SELL);
  assert.ok(Math.abs(s.conviction - 0.6) < 1e-9, `conviction ${s.conviction}`);
});

add('SMC neutral trend → HOLD', () => {
  const raw = { structure: { trend: 0, structure: [] }, obs: [], fvgs: [] };
  const s = deriveSignal('SMC', raw, { price: 100, candles: [] });
  assert.strictEqual(s.side, SIDE.HOLD);
});

add('unknown logicType throws', () => {
  assert.throws(() => deriveSignal('NOPE', {}, { price: 1, candles: [] }), /Unsupported/);
});

// ===== runner (do not edit below) =====
let failed = 0;
for (const t of tests) {
  try { t.fn(); console.log(`✅ ${t.name}`); }
  catch (e) { failed++; console.error(`❌ ${t.name}\n   ${e.message}`); }
}
if (failed) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
console.log('\nAll SignalAdapter tests passed!');
