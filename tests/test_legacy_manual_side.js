// tests/test_legacy_manual_side.js
import assert from 'node:assert';
import { legacyManualSide } from '../src/manual/legacyManualSide.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

// No logicType → default BUY
assert.strictEqual(legacyManualSide(null, {}, 100), 'BUY'); ok('null logicType → BUY');
assert.strictEqual(legacyManualSide(undefined, {}, 100), 'BUY'); ok('undefined logicType → BUY');

// SMC: trend drives side, neutral defaults to BUY (the legacy bug, preserved here)
assert.strictEqual(legacyManualSide('SMC', { structure: { trend: 1 } }, 100), 'BUY'); ok('SMC trend 1 → BUY');
assert.strictEqual(legacyManualSide('SMC', { structure: { trend: -1 } }, 100), 'SELL'); ok('SMC trend -1 → SELL');
assert.strictEqual(legacyManualSide('SMC', { structure: { trend: 0 } }, 100), 'BUY'); ok('SMC neutral → BUY (legacy)');
assert.strictEqual(legacyManualSide('SMC', {}, 100), 'BUY'); ok('SMC no structure → BUY');

// Breakout: only when channel.active; inside channel defaults to BUY (legacy bug, preserved)
assert.strictEqual(legacyManualSide('Breakout', { channel: { active: true, top: 110, bottom: 90 } }, 120), 'BUY'); ok('Breakout above top → BUY');
assert.strictEqual(legacyManualSide('Breakout', { channel: { active: true, top: 110, bottom: 90 } }, 80), 'SELL'); ok('Breakout below bottom → SELL');
assert.strictEqual(legacyManualSide('Breakout', { channel: { active: true, top: 110, bottom: 90 } }, 100), 'BUY'); ok('Breakout inside → BUY (legacy)');
assert.strictEqual(legacyManualSide('Breakout', { channel: { active: false, top: 110, bottom: 90 } }, 120), 'BUY'); ok('Breakout inactive → BUY (legacy)');

// Other logic types have no legacy side branch → always BUY
assert.strictEqual(legacyManualSide('VMC_CipherB', { wtCrossDown: true }, 100), 'BUY'); ok('VMC_CipherB → BUY (legacy, no branch)');
assert.strictEqual(legacyManualSide('Reversal', { rejection: { type: 'bearish' } }, 100), 'BUY'); ok('Reversal → BUY (legacy, no branch)');

console.log(`\n${passed} checks passed`);
