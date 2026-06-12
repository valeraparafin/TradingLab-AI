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

// --- alternating equal up/down → RSI ≈ 50 ---
{
  const values = [];
  for (let i = 0; i < 40; i++) values.push(100 + (i % 2)); // 100,101,100,101,...
  const rsi = Technicals.rsi(values, 14);
  const last = rsi[rsi.length - 1];
  assert.ok(Math.abs(last - 50) < 1e-6, `balanced moves → RSI ~50 (got ${last})`);
  ok('alternating → RSI ~50');
}

// --- insufficient data → [] ---
{
  assert.deepStrictEqual(Technicals.rsi([1, 2, 3], 14), [], 'n <= period → []');
  assert.deepStrictEqual(Technicals.rsi([], 14), [], 'empty → []');
  ok('insufficient data → []');
}

console.log(`\n${passed} checks passed`);
