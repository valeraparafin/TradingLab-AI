// tests/test_breakeven.mjs
import assert from 'node:assert';
import { breakevenStop } from '../src/backtest/exitPolicy.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

// BUY: entry 100, initial SL 90 → R = 10. breakevenR 1 → target 110.
{
  const pos = { side: 'BUY', entryPrice: 100, initialSlPrice: 90, slPrice: 90 };
  assert.strictEqual(breakevenStop(pos, { high: 109, low: 95 }, 1), 90, 'not reached → unchanged');
  assert.strictEqual(breakevenStop(pos, { high: 111, low: 95 }, 1), 100, 'reached → SL moves to entry');
  ok('BUY breakeven moves SL to entry once target hit');
}

// SELL: entry 100, initial SL 110 → R = 10. breakevenR 1 → target 90.
{
  const pos = { side: 'SELL', entryPrice: 100, initialSlPrice: 110, slPrice: 110 };
  assert.strictEqual(breakevenStop(pos, { high: 105, low: 91 }, 1), 110, 'not reached → unchanged');
  assert.strictEqual(breakevenStop(pos, { high: 105, low: 89 }, 1), 100, 'reached → SL moves to entry');
  ok('SELL breakeven moves SL to entry once target hit');
}

// profit-only: never moves SL adversely; R=0 or breakevenR<=0 → unchanged
{
  const buy = { side: 'BUY', entryPrice: 100, initialSlPrice: 90, slPrice: 99 };
  assert.strictEqual(breakevenStop(buy, { high: 111, low: 95 }, 1), 100, 'BUY moves up to entry (max)');
  const flat = { side: 'BUY', entryPrice: 100, initialSlPrice: 100, slPrice: 100 };
  assert.strictEqual(breakevenStop(flat, { high: 200, low: 95 }, 1), 100, 'R=0 → unchanged');
  const off = { side: 'BUY', entryPrice: 100, initialSlPrice: 90, slPrice: 90 };
  assert.strictEqual(breakevenStop(off, { high: 999, low: 95 }, 0), 90, 'breakevenR<=0 → unchanged');
  ok('profit-only and guarded edges');
}

console.log(`\n${passed} checks passed`);
