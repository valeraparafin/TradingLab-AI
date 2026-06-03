import assert from 'assert';
import { slip, checkExit } from '../src/backtest/execution.js';

const tests = [];
const add = (n, fn) => tests.push({ n, fn });
const near = (a, b, t = 1e-9) => Math.abs(a - b) < t;

add('slip worsens fill: BUY pays more, SELL receives less', () => {
  assert.ok(near(slip(100, 'BUY', 5), 100.05));   // +0.05%
  assert.ok(near(slip(100, 'SELL', 5), 99.95));    // -0.05%
  assert.strictEqual(slip(100, 'BUY', 0), 100);    // no slippage
});

add('checkExit BUY intrabar SL (market, slippage) takes priority over TP', () => {
  const pos = { side: 'BUY', slPrice: 90, tpPrice: 110 };
  const bar = { open: 100, high: 111, low: 89 }; // both SL and TP touched -> SL wins
  const ex = checkExit(pos, bar, { slippageBps: 10 }, false);
  assert.strictEqual(ex.reason, 'SL');
  assert.ok(near(ex.idealPrice, 90));
  assert.ok(near(ex.exitPrice, slip(90, 'SELL', 10))); // 89.91
  assert.strictEqual(ex.market, true);
});

add('checkExit BUY intrabar TP (limit, no slippage)', () => {
  const pos = { side: 'BUY', slPrice: 90, tpPrice: 110 };
  const bar = { open: 100, high: 111, low: 95 };
  const ex = checkExit(pos, bar, { slippageBps: 10 }, false);
  assert.strictEqual(ex.reason, 'TP');
  assert.strictEqual(ex.exitPrice, 110);
  assert.strictEqual(ex.market, false);
});

add('checkExit BUY gap-on-open below SL exits at slipped open', () => {
  const pos = { side: 'BUY', slPrice: 90, tpPrice: 110 };
  const bar = { open: 85, high: 88, low: 80 };
  const ex = checkExit(pos, bar, { slippageBps: 10 }, false);
  assert.strictEqual(ex.reason, 'SL_GAP');
  assert.ok(near(ex.idealPrice, 85));
  assert.ok(near(ex.exitPrice, slip(85, 'SELL', 10)));
});

add('checkExit skips gap-on-open on the entry bar', () => {
  const pos = { side: 'BUY', slPrice: 90, tpPrice: 110 };
  const bar = { open: 85, high: 88, low: 86 }; // open below SL, but it is the entry bar
  const ex = checkExit(pos, bar, { slippageBps: 10 }, true);
  // entry bar: no gap check; intrabar low 86 <= 90 -> SL at slPrice 90 (market)
  assert.strictEqual(ex.reason, 'SL');
  assert.ok(near(ex.idealPrice, 90));
});

add('checkExit SELL intrabar SL and TP mirror correctly', () => {
  const pos = { side: 'SELL', slPrice: 110, tpPrice: 90 };
  const slBar = { open: 100, high: 111, low: 99 };
  const slEx = checkExit(pos, slBar, { slippageBps: 10 }, false);
  assert.strictEqual(slEx.reason, 'SL');
  assert.ok(near(slEx.exitPrice, slip(110, 'BUY', 10))); // buy-back slips up
  const tpBar = { open: 100, high: 101, low: 89 };
  const tpEx = checkExit(pos, tpBar, { slippageBps: 10 }, false);
  assert.strictEqual(tpEx.reason, 'TP');
  assert.strictEqual(tpEx.exitPrice, 90);
});

add('checkExit returns null when no level is touched', () => {
  const pos = { side: 'BUY', slPrice: 90, tpPrice: 110 };
  const bar = { open: 100, high: 105, low: 95 };
  assert.strictEqual(checkExit(pos, bar, { slippageBps: 5 }, false), null);
});

let failed = 0;
for (const t of tests) { try { t.fn(); console.log(`✅ ${t.n}`); } catch (e) { failed++; console.error(`❌ ${t.n}\n   ${e.message}`); } }
if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log('\nAll execution tests passed!');
