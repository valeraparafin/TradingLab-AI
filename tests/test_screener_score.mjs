// tests/test_screener_score.mjs
import assert from 'node:assert';
import { scoreUniverse } from '../src/screener/score.js';
let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

const rows = [
  { symbol: 'A', volatility: 0.10, momentum: 0.50, liquidity: 100e6 },
  { symbol: 'B', volatility: 0.02, momentum: 0.05, liquidity: 5e6 },   // below floor
  { symbol: 'C', volatility: 0.08, momentum: 0.30, liquidity: 50e6 },
  { symbol: 'D', volatility: 0.20, momentum: 0.40, liquidity: 30e6 },
];
const picks = scoreUniverse(rows, { minLiquidity: 10e6, topN: 2 });
assert.strictEqual(picks.length, 2, 'topN respected'); ok('topN cap');
assert.ok(!picks.find(r => r.symbol === 'B'), 'liquidity floor excludes B'); ok('liquidity floor');
assert.strictEqual(picks[0].rank, 1, 'rank assigned'); ok('rank assigned');
assert.ok(picks.every(r => r.score >= 0 && r.score <= 1), 'score in 0..1'); ok('score bounded');
// denylist
const p2 = scoreUniverse(rows, { minLiquidity: 0, denylist: ['A'], topN: 5 });
assert.ok(!p2.find(r => r.symbol === 'A'), 'denylist excludes A'); ok('denylist');

console.log(`\n${p} checks passed`);
