// tests/test_position_ledger.mjs
import assert from 'node:assert';
import { openPosition, checkExits, realizedPnl } from '../src/agents/PositionLedger.js';

let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

// openPosition normalizes + derives nothing it isn't given
const pos = openPosition({ symbol: 'BTCUSDT', side: 'BUY', entryPrice: 100, qty: 2, slPrice: 90, tpPrice: 120, openedAt: 't0' });
assert.deepEqual(pos, { symbol: 'BTCUSDT', side: 'BUY', entryPrice: 100, qty: 2, slPrice: 90, tpPrice: 120, openedAt: 't0' });
ok('openPosition normalizes');

// realizedPnl sign — long
assert.equal(realizedPnl({ side: 'BUY', entryPrice: 100, qty: 2 }, 120), 40);
ok('long pnl positive at TP');
assert.equal(realizedPnl({ side: 'BUY', entryPrice: 100, qty: 2 }, 90), -20);
ok('long pnl negative at SL');
// realizedPnl sign — short
assert.equal(realizedPnl({ side: 'SELL', entryPrice: 100, qty: 2 }, 80), 40);
ok('short pnl positive when price falls');
assert.equal(realizedPnl({ side: 'SELL', entryPrice: 100, qty: 2 }, 110), -20);
ok('short pnl negative when price rises');

// checkExits — long TP
let r = checkExits([pos], { BTCUSDT: 121 });
assert.equal(r.closed.length, 1);
assert.equal(r.closed[0].exitReason, 'TP');
assert.equal(r.closed[0].exitPrice, 121);
assert.equal(r.closed[0].pnlUsd, 42);
assert.equal(r.remaining.length, 0);
ok('long closes at TP with pnl from mid');

// checkExits — long SL
r = checkExits([pos], { BTCUSDT: 89 });
assert.equal(r.closed[0].exitReason, 'SL');
ok('long closes at SL');

// checkExits — short (sl above, tp below)
const sp = openPosition({ symbol: 'ETHUSDT', side: 'SELL', entryPrice: 100, qty: 1, slPrice: 110, tpPrice: 80, openedAt: 't1' });
assert.equal(checkExits([sp], { ETHUSDT: 79 }).closed[0].exitReason, 'TP');
ok('short closes at TP when price drops');
assert.equal(checkExits([sp], { ETHUSDT: 111 }).closed[0].exitReason, 'SL');
ok('short closes at SL when price rises');

// no mid → passthrough untouched
r = checkExits([pos], {});
assert.equal(r.closed.length, 0);
assert.equal(r.remaining.length, 1);
ok('no mid leaves position open');

// SL priority when one tick straddles both (gap)
const wide = openPosition({ symbol: 'BTCUSDT', side: 'BUY', entryPrice: 100, qty: 1, slPrice: 95, tpPrice: 105, openedAt: 't2' });
assert.equal(checkExits([wide], { BTCUSDT: 95 }).closed[0].exitReason, 'SL'); // mid<=sl wins
ok('SL takes priority on straddle');

console.log(`\n${p} checks passed`);
