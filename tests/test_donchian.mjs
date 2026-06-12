// tests/test_donchian.mjs
import assert from 'node:assert';
import { Technicals } from '../src/indicators/technical.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };
const mk = (h, l) => ({ time: 0, open: l, high: h, low: l, close: (h + l) / 2, volume: 1 });

// --- donchian: latest highest-high / lowest-low over the last `period` candles ---
{
  const candles = [mk(10, 5), mk(12, 6), mk(11, 4), mk(13, 7)];
  const ch = Technicals.donchian(candles, 3); // last 3: highs 12,11,13 lows 6,4,7
  assert.strictEqual(ch.upper, 13, 'upper = max high of last 3');
  assert.strictEqual(ch.lower, 4, 'lower = min low of last 3');
  ok('donchian latest channel over last period candles');
}

// --- donchian: null when fewer than `period` candles ---
{
  assert.strictEqual(Technicals.donchian([mk(10, 5)], 3), null, 'null below period');
  ok('donchian null when insufficient candles');
}

console.log(`\n${passed} passed`);
