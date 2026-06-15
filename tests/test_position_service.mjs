// tests/test_position_service.mjs
import assert from 'node:assert';
import { initDB, getDB } from '../db.js';
import { aiStrategyService } from '../src/server/services/aiStrategyService.js';

let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

await initDB();
const db = getDB('ai');
const AID = 990001; // test-only synthetic agent id
await db.run('DELETE FROM ai_active_positions WHERE strategy_id = ?', [AID]);
await db.run('DELETE FROM ai_closed_trades WHERE strategy_id = ?', [AID]);

// open
const o1 = await aiStrategyService.openPosition(AID, { symbol: 'BTCUSDT', side: 'BUY', entryPrice: 100, qty: 2, slPrice: 90, tpPrice: 120 });
assert.equal(o1.opened, true); ok('opens a position');
// one-per-symbol lock
const o2 = await aiStrategyService.openPosition(AID, { symbol: 'BTCUSDT', side: 'BUY', entryPrice: 101, qty: 1, slPrice: 91, tpPrice: 121 });
assert.equal(o2.opened, false); ok('duplicate symbol is locked out');

const open = await aiStrategyService.listOpenPositions(AID);
assert.equal(open.length, 1); ok('lists one open position');
assert.equal(open[0].side, 'BUY'); ok('maps side');
assert.equal(open[0].entryPrice, 100); ok('maps entryPrice');
assert.equal(open[0].slPrice, 90); ok('maps slPrice');
assert.equal(open[0].qty, 2); ok('maps qty');

// enrich with injected price fn (server-side unrealized PnL)
const enriched = await aiStrategyService.getOpenPositionsEnriched(AID, async () => 110);
assert.equal(enriched[0].mid, 110); ok('enriched carries mid');
assert.equal(enriched[0].unrealizedPnl, 20); ok('unrealized = (110-100)*2');

// close
await aiStrategyService.recordClosedTrade({
  strategy_id: AID, symbol: 'BTCUSDT', side: 'BUY', entry_price: 100, exit_price: 120,
  qty: 2, size_usd: 200, pnl_usd: 40, exit_reason: 'TP', opened_at: 't0', closed_at: 't1',
});
await aiStrategyService.closePosition(AID, 'BTCUSDT');
assert.equal((await aiStrategyService.listOpenPositions(AID)).length, 0); ok('close removes open position');
const closed = await aiStrategyService.listClosedTrades(AID, 10);
assert.equal(closed.length, 1); ok('lists one closed trade');
assert.equal(closed[0].pnl_usd, 40); ok('closed trade keeps pnl');

// cleanup
await db.run('DELETE FROM ai_active_positions WHERE strategy_id = ?', [AID]);
await db.run('DELETE FROM ai_closed_trades WHERE strategy_id = ?', [AID]);
console.log(`\n${p} checks passed`);
process.exit(0);
