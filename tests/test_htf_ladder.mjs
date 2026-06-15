// tests/test_htf_ladder.mjs
import assert from 'node:assert';
import { higherTf } from '../src/marketdata/orderbook/htfLadder.js';

let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

assert.equal(higherTf('5m', 1), '15m'); ok('5m +1 -> 15m');
assert.equal(higherTf('15m', 1), '30m'); ok('15m +1 -> 30m');
assert.equal(higherTf('15m', 2), '1h'); ok('15m +2 -> 1h');
assert.equal(higherTf('1m', 1), '5m'); ok('1m +1 -> 5m');
assert.equal(higherTf('1d', 1), '1d'); ok('top rung clamps to 1d');
assert.equal(higherTf('5m', 0), '5m'); ok('step 0 -> same tf');
assert.equal(higherTf('7m', 1), '15m'); ok('unknown tf snaps up to next known rung');

console.log(`\n${p} checks passed`);
