// tests/test_rsi.mjs
import assert from 'node:assert';
import { Technicals } from '../src/indicators/technical.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

// --- strictly rising series → RSI = 100 (no losses) ---
{
  const values = Array.from({ length: 30 }, (_, i) => 100 + i); // 100,101,...129
  const rsi = Technicals.rsi(values, 14);
  assert.strictEqual(rsi.length, 30 - 14, 'series length = n - period');
  for (const v of rsi) assert.ok(Math.abs(v - 100) < 1e-9, 'all gains → RSI 100');
  ok('strictly rising → RSI 100');
}

// --- strictly falling series → RSI = 0 (no gains) ---
{
  const values = Array.from({ length: 30 }, (_, i) => 130 - i);
  const rsi = Technicals.rsi(values, 14);
  for (const v of rsi) assert.ok(Math.abs(v - 0) < 1e-9, 'all losses → RSI 0');
  ok('strictly falling → RSI 0');
}

// --- alternating equal up/down → RSI in a tight band around 50, bounded ---
{
  const values = [];
  for (let i = 0; i < 40; i++) values.push(100 + (i % 2)); // 100,101,100,101,...
  const rsi = Technicals.rsi(values, 14);
  const last = rsi[rsi.length - 1];
  // Wilder smoothing leaves the gain/loss streams offset by one bar, so the limit is
  // ~52, not exactly 50. Assert a tight band + strict bounds rather than an exact value.
  assert.ok(last > 45 && last < 55, `balanced moves → RSI near 50 (got ${last})`);
  for (const v of rsi) assert.ok(v >= 0 && v <= 100, 'RSI bounded in [0,100]');
  ok('alternating → RSI near 50 (Wilder)');
}

// --- insufficient data → [] ---
{
  assert.deepStrictEqual(Technicals.rsi([1, 2, 3], 14), [], 'n <= period → []');
  assert.deepStrictEqual(Technicals.rsi([], 14), [], 'empty → []');
  ok('insufficient data → []');
}

console.log(`\n${passed} checks passed`);
