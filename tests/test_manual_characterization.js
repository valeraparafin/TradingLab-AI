// tests/test_manual_characterization.js
// Golden-master: the new core (deriveSignal) must match the legacy bot_engine
// side decision EXCEPT the three documented intentional fix CATEGORIES:
//   #1 neutral/inactive → HOLD (was BUY)
//   #2 VMC_CipherB gains a real wt-cross side (was always BUY)
//   #3 Reversal gains a real rejection side (was always BUY)
// These 3 categories produce 7 fixture-level diffs below (3 for #1, 2 for #2, 2 for #3).
import assert from 'node:assert';
import { legacyManualSide } from '../src/manual/legacyManualSide.js';
import { deriveSignal } from '../src/core/SignalAdapter.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

// Each case: logicType, raw indicator data, price, expected legacy side, expected core side, diff?
const cases = [
  // ---- SMC ----
  { name: 'SMC trend 1', logicType: 'SMC', raw: { structure: { trend: 1, structure: [] }, obs: [] }, price: 100, legacy: 'BUY', core: 'BUY', diff: false },
  { name: 'SMC trend -1', logicType: 'SMC', raw: { structure: { trend: -1, structure: [] }, obs: [] }, price: 100, legacy: 'SELL', core: 'SELL', diff: false },
  { name: 'SMC neutral (#1)', logicType: 'SMC', raw: { structure: { trend: 0, structure: [] }, obs: [] }, price: 100, legacy: 'BUY', core: 'HOLD', diff: true },

  // ---- Breakout ----
  { name: 'Breakout above top', logicType: 'Breakout', raw: { channel: { active: true, top: 110, bottom: 90 } }, price: 120, legacy: 'BUY', core: 'BUY', diff: false },
  { name: 'Breakout below bottom', logicType: 'Breakout', raw: { channel: { active: true, top: 110, bottom: 90 } }, price: 80, legacy: 'SELL', core: 'SELL', diff: false },
  { name: 'Breakout inside (#1)', logicType: 'Breakout', raw: { channel: { active: true, top: 110, bottom: 90 } }, price: 100, legacy: 'BUY', core: 'HOLD', diff: true },
  { name: 'Breakout inactive (#1)', logicType: 'Breakout', raw: { channel: { active: false, top: 110, bottom: 90 } }, price: 120, legacy: 'BUY', core: 'HOLD', diff: true },

  // ---- VMC_CipherB (#2) ----
  { name: 'VMC wtCrossUp', logicType: 'VMC_CipherB', raw: { wtCrossUp: true, mfi: 50, stochRsi: { k: 50 }, stc: 50 }, price: 100, legacy: 'BUY', core: 'BUY', diff: false },
  { name: 'VMC wtCrossDown (#2)', logicType: 'VMC_CipherB', raw: { wtCrossDown: true, mfi: 50, stochRsi: { k: 50 }, stc: 50 }, price: 100, legacy: 'BUY', core: 'SELL', diff: true },
  { name: 'VMC no cross (#2)', logicType: 'VMC_CipherB', raw: { mfi: 50, stochRsi: { k: 50 }, stc: 50 }, price: 100, legacy: 'BUY', core: 'HOLD', diff: true },

  // ---- Reversal (#3) ----
  { name: 'Reversal bullish', logicType: 'Reversal', raw: { rejection: { type: 'bullish', low: 95, high: 105 } }, price: 100, legacy: 'BUY', core: 'BUY', diff: false },
  { name: 'Reversal bearish (#3)', logicType: 'Reversal', raw: { rejection: { type: 'bearish', low: 95, high: 105 } }, price: 100, legacy: 'BUY', core: 'SELL', diff: true },
  { name: 'Reversal no rejection (#3)', logicType: 'Reversal', raw: {}, price: 100, legacy: 'BUY', core: 'HOLD', diff: true },
];

let diffCount = 0;
for (const c of cases) {
  const legacySide = legacyManualSide(c.logicType, c.raw, c.price);
  // candles is unused by the manual-mode side mappers (price + raw indicator data suffice).
  const coreSide = deriveSignal(c.logicType, c.raw, { price: c.price, candles: [] }).side;
  assert.strictEqual(legacySide, c.legacy, `${c.name}: legacy side`);
  assert.strictEqual(coreSide, c.core, `${c.name}: core side`);
  const isDiff = legacySide !== coreSide;
  assert.strictEqual(isDiff, c.diff, `${c.name}: diff flag (legacy=${legacySide} core=${coreSide})`);
  if (isDiff) diffCount++;
  ok(`${c.name} (legacy ${legacySide} / core ${coreSide}${isDiff ? ' — documented diff' : ''})`);
}

// Exactly the documented diffs, no more, no less (3 for #1 + 2 for #2 + 2 for #3 = 7)
assert.strictEqual(diffCount, 7, 'exactly 7 documented diffs across the battery');
ok('diff count == 7 (no undocumented divergence)');

console.log(`\n${passed} checks passed`);
