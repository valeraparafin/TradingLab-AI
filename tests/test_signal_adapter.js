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

// ---- WaveTrend (VMC_CipherB) ----
add('WaveTrend cross up + full confluence → BUY', () => {
  const raw = { wtCrossUp: true, wtCrossDown: false, mfi: 60, stochRsi: { k: 50, d: 50 }, stc: 60 };
  const s = deriveSignal('VMC_CIPHERB', raw, { price: 100, candles: [] });
  assert.strictEqual(s.side, SIDE.BUY);
  assert.ok(Math.abs(s.conviction - 1.0) < 1e-9, `conviction ${s.conviction}`);
});

add('WaveTrend cross down → SELL', () => {
  const raw = { wtCrossUp: false, wtCrossDown: true, mfi: 40, stochRsi: { k: 50, d: 50 }, stc: 40 };
  const s = deriveSignal('VMC_CIPHERB', raw, { price: 100, candles: [] });
  assert.strictEqual(s.side, SIDE.SELL);
  assert.ok(Math.abs(s.conviction - 1.0) < 1e-9, `conviction ${s.conviction}`);
});

add('WaveTrend no cross → HOLD', () => {
  const raw = { wtCrossUp: false, wtCrossDown: false, mfi: 50, stochRsi: { k: 50, d: 50 }, stc: 50 };
  const s = deriveSignal('VMC_CIPHERB', raw, { price: 100, candles: [] });
  assert.strictEqual(s.side, SIDE.HOLD);
});

// ---- Breakout ----
add('Breakout above active channel → BUY (capped conviction)', () => {
  const raw = { channel: { top: 100, bottom: 90, active: true } };
  const s = deriveSignal('BREAKOUT', raw, { price: 105, candles: [] });
  assert.strictEqual(s.side, SIDE.BUY);
  assert.ok(Math.abs(s.conviction - 0.9) < 1e-9, `conviction ${s.conviction}`);
  assert.strictEqual(s.invalidation, 90);
});

add('Breakout inactive channel → HOLD', () => {
  const raw = { channel: { top: null, bottom: null, active: false } };
  const s = deriveSignal('BREAKOUT', raw, { price: 105, candles: [] });
  assert.strictEqual(s.side, SIDE.HOLD);
});

add('Breakout price inside channel → HOLD', () => {
  const raw = { channel: { top: 100, bottom: 90, active: true } };
  const s = deriveSignal('BREAKOUT', raw, { price: 95, candles: [] });
  assert.strictEqual(s.side, SIDE.HOLD);
});

add('Breakout below active channel → SELL (capped conviction)', () => {
  const raw = { channel: { top: 100, bottom: 90, active: true } };
  const s = deriveSignal('BREAKOUT', raw, { price: 85, candles: [] });
  assert.strictEqual(s.side, SIDE.SELL);
  assert.ok(Math.abs(s.conviction - 0.9) < 1e-9, `conviction ${s.conviction}`);
  assert.strictEqual(s.invalidation, 100);
});

// ---- Reversal ----
add('Reversal bullish rejection + aligned FVG → BUY', () => {
  const raw = { structure: { trend: 0 }, recentFVG: { type: 'bullish' }, rejection: { type: 'bullish', high: 100, low: 90 } };
  const s = deriveSignal('REVERSAL', raw, { price: 95, candles: [] });
  assert.strictEqual(s.side, SIDE.BUY);
  assert.ok(Math.abs(s.conviction - 0.9) < 1e-9, `conviction ${s.conviction}`);
  assert.strictEqual(s.invalidation, 90);
});

add('Reversal bearish rejection, no FVG → SELL', () => {
  const raw = { structure: { trend: 0 }, recentFVG: null, rejection: { type: 'bearish', high: 100, low: 90 } };
  const s = deriveSignal('REVERSAL', raw, { price: 99, candles: [] });
  assert.strictEqual(s.side, SIDE.SELL);
  assert.ok(Math.abs(s.conviction - 0.65) < 1e-9, `conviction ${s.conviction}`);
  assert.strictEqual(s.invalidation, 100);
});

add('Reversal no rejection → HOLD', () => {
  const raw = { structure: { trend: 1 }, recentFVG: { type: 'bullish' }, rejection: null };
  const s = deriveSignal('REVERSAL', raw, { price: 100, candles: [] });
  assert.strictEqual(s.side, SIDE.HOLD);
});

// ===== runner (do not edit below) =====
let failed = 0;
for (const t of tests) {
  try { t.fn(); console.log(`✅ ${t.name}`); }
  catch (e) { failed++; console.error(`❌ ${t.name}\n   ${e.message}`); }
}
if (failed) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
console.log('\nAll SignalAdapter tests passed!');
