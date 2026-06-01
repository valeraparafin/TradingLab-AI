// tests/test_executor_ai_db.mjs
import assert from 'node:assert';
import { initDB, getDB } from '../db.js';
import { TradeExecutor } from '../src/agents/TradeExecutor.js';

await initDB();
const agentId = 99999;
const exec = new TradeExecutor({ tradeMode: 'PAPER', agentId });
const r = await exec.executeTrade({ symbol: 'BTCUSDT', side: 'buy', sizeUSD: 20, price: 100 });
assert.equal(r.success, true);
assert.equal(r.mode, 'PAPER');

const db = getDB('ai');
const row = await db.get(
  'SELECT * FROM ai_paper_trades WHERE strategy_id = ? ORDER BY id DESC LIMIT 1', [agentId]);
assert.ok(row, 'trade must be recorded in ai_paper_trades');
assert.equal(row.symbol, 'BTCUSDT');
assert.equal(row.size_usd, 20);

await db.run('DELETE FROM ai_paper_trades WHERE strategy_id = ?', [agentId]); // cleanup
console.log('OK test_executor_ai_db');
