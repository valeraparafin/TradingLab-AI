// tests/test_precision.mjs
import assert from 'node:assert';
import { tickSizeToPrecision } from '../src/server/services/asset.service.js';
import { roundTo } from '../src/utils/precision.js';

let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

// tickSizeToPrecision: Binance pads tickSize with trailing zeros ("0.00100000").
// Precision must reflect the SIGNIFICANT tick, not the padded string length.
assert.equal(tickSizeToPrecision('0.01000000'), 2); ok('0.01 -> 2');
assert.equal(tickSizeToPrecision('0.00100000'), 3); ok('0.001 -> 3');
assert.equal(tickSizeToPrecision('0.00010000'), 4); ok('0.0001 -> 4');
assert.equal(tickSizeToPrecision('1.00000000'), 0); ok('1 -> 0');
assert.equal(tickSizeToPrecision('0.00000010'), 7); ok('1e-7 -> 7 (exponential)');
assert.equal(tickSizeToPrecision(undefined), 2); ok('undefined -> default 2');
assert.equal(tickSizeToPrecision('0'), 2); ok('zero -> default 2');

// roundTo: snap a value to N decimals, numeric out (drops float noise).
assert.equal(roundTo(1.759727778210061, 3), 1.76); ok('round 1.7597.. @3 -> 1.76');
assert.equal(roundTo(0.8050638971927564, 4), 0.8051); ok('round 0.80506.. @4 -> 0.8051');
assert.equal(roundTo(100, 2), 100); ok('round 100 @2 -> 100');
assert.equal(roundTo(101.5, 2), 101.5); ok('round 101.5 @2 -> 101.5');
assert.equal(roundTo(0.0000757, 5), 0.00008); ok('round qty @5');
assert.ok(Number.isNaN(roundTo(NaN, 2))); ok('NaN passthrough');

console.log(`\n${p} checks passed`);
