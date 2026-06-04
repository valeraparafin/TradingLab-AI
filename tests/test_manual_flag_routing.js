// tests/test_manual_flag_routing.js
import assert from 'node:assert';
import { resolveEntrySide } from '../src/manual/resolveEntrySide.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

const smcNeutral = { structure: { trend: 0, structure: [] }, obs: [] };
const smcBull = { structure: { trend: 1, structure: [] }, obs: [] };

// OFF → legacy side, never skips (legacy commits to a side)
{
  const r = resolveEntrySide({ logicType: 'SMC', strategyData: smcNeutral, price: 100, candles: [], useSignalCore: false });
  assert.strictEqual(r.skip, false); assert.strictEqual(r.side, 'BUY');
  ok('OFF + SMC neutral → legacy BUY, no skip');
}

// ON → core side
{
  const r = resolveEntrySide({ logicType: 'SMC', strategyData: smcBull, price: 100, candles: [], useSignalCore: true });
  assert.strictEqual(r.skip, false); assert.strictEqual(r.side, 'BUY');
  ok('ON + SMC bullish → core BUY');
}

// ON + HOLD → skip with reason, no side
{
  const r = resolveEntrySide({ logicType: 'SMC', strategyData: smcNeutral, price: 100, candles: [], useSignalCore: true });
  assert.strictEqual(r.skip, true);
  assert.strictEqual(r.side, null);
  assert.ok(typeof r.reason === 'string' && r.reason.length > 0, 'reason present');
  ok('ON + SMC neutral → skip (HOLD)');
}

// ON + core SELL → side SELL, no skip
{
  const r = resolveEntrySide({ logicType: 'SMC', strategyData: { structure: { trend: -1, structure: [] }, obs: [] }, price: 100, candles: [], useSignalCore: true });
  assert.strictEqual(r.skip, false); assert.strictEqual(r.side, 'SELL');
  ok('ON + SMC bearish → core SELL');
}

// ON + unsupported logicType → skip (no throw into the live loop), reason present
{
  const r = resolveEntrySide({ logicType: 'NopeNotReal', strategyData: {}, price: 100, candles: [], useSignalCore: true });
  assert.strictEqual(r.skip, true);
  assert.strictEqual(r.side, null);
  assert.ok(typeof r.reason === 'string' && /unsupported logicType/i.test(r.reason), 'reason names the unsupported type');
  ok('ON + unsupported logicType → skip, no throw');
}

console.log(`\n${passed} checks passed`);
