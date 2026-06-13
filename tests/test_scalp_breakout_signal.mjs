// tests/test_scalp_breakout_signal.mjs
import assert from 'node:assert';
import { deriveSignal } from '../src/core/SignalAdapter.js';
let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

let s = deriveSignal('SCALPBREAKOUT', { side: 'BUY', invalidation: 100 }, {});
assert.strictEqual(s.side, 'BUY', 'BUY passthrough'); ok('side passthrough');
assert.strictEqual(s.invalidation, 100, 'invalidation passthrough'); ok('invalidation passthrough');
assert.ok(s.conviction > 0, 'conviction set'); ok('conviction');

s = deriveSignal('SCALPBREAKOUT', { side: 'HOLD', invalidation: null }, {});
assert.strictEqual(s.side, 'HOLD', 'HOLD → hold'); ok('HOLD maps to hold');

console.log(`\n${p} checks passed`);
