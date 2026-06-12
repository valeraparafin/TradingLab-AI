// tests/test_slope.mjs
import assert from 'node:assert';
import { Technicals } from '../src/indicators/technical.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

// --- rising line → positive slope ---
{
  const s = Technicals.slope([100, 101, 102, 103, 104], 5);
  assert.ok(s > 0, `rising → positive (got ${s})`);
  ok('rising → positive slope');
}

// --- falling line → negative slope ---
{
  const s = Technicals.slope([104, 103, 102, 101, 100], 5);
  assert.ok(s < 0, `falling → negative (got ${s})`);
  ok('falling → negative slope');
}

// --- flat line → ~0 slope ---
{
  const s = Technicals.slope([100, 100, 100, 100, 100], 5);
  assert.ok(Math.abs(s) < 1e-12, `flat → ~0 (got ${s})`);
  ok('flat → zero slope');
}

// --- uses only the last `period` values ---
{
  const s = Technicals.slope([0, 0, 0, 100, 101, 102], 3); // last 3 rising
  assert.ok(s > 0, 'windowed to last period');
  ok('windowed to last period');
}

// --- insufficient data → null ---
{
  assert.strictEqual(Technicals.slope([1, 2], 5), null, 'short → null');
  assert.strictEqual(Technicals.slope([], 5), null, 'empty → null');
  ok('insufficient data → null');
}

console.log(`\n${passed} checks passed`);
