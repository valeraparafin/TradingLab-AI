// tests/test_position_routes.mjs
import assert from 'node:assert';
import express from 'express';
import { initDB, getDB } from '../db.js';
import { aiStrategyService } from '../src/server/services/aiStrategyService.js';
import { createAgentsRouter } from '../src/server/routes/agents.routes.js';

let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

await initDB();
const db = getDB('ai');
const AID = 990003;
await db.run('DELETE FROM ai_active_positions WHERE strategy_id = ?', [AID]);
await db.run('DELETE FROM ai_closed_trades WHERE strategy_id = ?', [AID]);
await aiStrategyService.openPosition(AID, { symbol: 'BTCUSDT', side: 'BUY', entryPrice: 100, qty: 2, slPrice: 90, tpPrice: 120 });
await aiStrategyService.recordClosedTrade({ strategy_id: AID, symbol: 'ETHUSDT', side: 'SELL', entry_price: 50, exit_price: 45, qty: 1, size_usd: 50, pnl_usd: 5, exit_reason: 'TP', opened_at: 't0', closed_at: 't1' });

const app = express();
app.use('/api/agents', createAgentsRouter({ size: () => 0 }));
const server = app.listen(0);
const port = server.address().port;
const base = `http://localhost:${port}/api/agents`;

const posRes = await (await fetch(`${base}/${AID}/positions`)).json();
assert.equal(posRes.success, true); ok('positions route ok');
assert.equal(posRes.data.positions.length, 1); ok('one open position returned');
assert.ok('mid' in posRes.data.positions[0]); ok('position carries mid field');

assert.ok('pricePrecision' in posRes.data.positions[0]); ok('position carries pricePrecision');

const clRes = await (await fetch(`${base}/${AID}/closed-trades`)).json();
assert.equal(clRes.data.trades.length, 1); ok('one closed trade returned');
assert.equal(clRes.data.trades[0].exit_reason, 'TP'); ok('closed trade reason');
assert.ok('pricePrecision' in clRes.data.trades[0]); ok('closed trade carries pricePrecision');

server.close();
await db.run('DELETE FROM ai_active_positions WHERE strategy_id = ?', [AID]);
await db.run('DELETE FROM ai_closed_trades WHERE strategy_id = ?', [AID]);
console.log(`\n${p} checks passed`);
process.exit(0);
