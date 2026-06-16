// tests/test_rf_trend_align.mjs
import assert from 'node:assert';
import { rf_trend_align } from '../src/validators/safety-rules.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

// --- dir up + long state → pass ---
{
  const res = rf_trend_align(101, 100, { dir: 1, state: 1 }, {});
  assert.strictEqual(res.pass, true, 'dir up & long state → pass');
  ok('rf_trend_align passes when aligned (long)');
}

// --- dir up but short state → fail ---
{
  const res = rf_trend_align(99, 100, { dir: 1, state: -1 }, {});
  assert.strictEqual(res.pass, false, 'dir up but short state → fail');
  ok('rf_trend_align fails on mismatch');
}

// --- flat dir → fail (no alignment) ---
{
  const res = rf_trend_align(100, 100, { dir: 0, state: 0 }, {});
  assert.strictEqual(res.pass, false, 'flat filter → fail');
  ok('rf_trend_align fails when filter flat');
}

console.log(`\n${passed} passed`);
