import assert from 'assert';
import { deriveSignal } from '../src/core/SignalAdapter.js';

const tests = [];
const add = (name, fn) => tests.push({ name, fn });

add('SMC_ZONE BUY raw maps to a BUY signal carrying the invalidation', () => {
  const raw = { side: 'BUY', zone: { top: 100.3, bottom: 100.1 }, invalidation: 100.1 };
  const s = deriveSignal('SMC_ZONE', raw, { price: 100.2, candles: [] });
  assert.strictEqual(s.side, 'BUY');
  assert.strictEqual(s.invalidation, 100.1);
  assert.ok(s.conviction > 0);
});

add('SMC_ZONE HOLD raw maps to a HOLD signal', () => {
  const raw = { side: 'HOLD', zone: null, invalidation: null };
  const s = deriveSignal('SMC_ZONE', raw, { price: 100, candles: [] });
  assert.strictEqual(s.side, 'HOLD');
});

let failed = 0;
for (const t of tests) {
  try { t.fn(); console.log(`PASS ${t.name}`); }
  catch (e) { failed++; console.error(`FAIL ${t.name}\n   ${e.message}`); }
}
if (failed) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
console.log('\nAll smcZone signal tests passed!');
