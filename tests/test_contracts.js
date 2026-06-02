import assert from 'assert';
import { SIDE } from '../src/core/contracts.js';

console.log('Running contracts tests...');

assert.strictEqual(SIDE.BUY, 'BUY', 'SIDE.BUY');
assert.strictEqual(SIDE.SELL, 'SELL', 'SIDE.SELL');
assert.strictEqual(SIDE.HOLD, 'HOLD', 'SIDE.HOLD');
assert.ok(Object.isFrozen(SIDE), 'SIDE must be frozen');

console.log('✅ contracts tests passed');
