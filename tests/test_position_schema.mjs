// tests/test_position_schema.mjs
import assert from 'node:assert';
import { initDB, getDB } from '../db.js';

let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

await initDB();
const db = getDB('ai');

const apCols = (await db.all('PRAGMA table_info(ai_active_positions)')).map(c => c.name);
for (const c of ['side', 'sl_price', 'tp_price', 'opened_at']) {
  assert.ok(apCols.includes(c), `ai_active_positions has ${c}`); ok(`active_positions.${c}`);
}

const ctCols = (await db.all('PRAGMA table_info(ai_closed_trades)')).map(c => c.name);
for (const c of ['id', 'strategy_id', 'symbol', 'side', 'entry_price', 'exit_price', 'qty', 'size_usd', 'pnl_usd', 'exit_reason', 'opened_at', 'closed_at']) {
  assert.ok(ctCols.includes(c), `ai_closed_trades has ${c}`); ok(`closed_trades.${c}`);
}

console.log(`\n${p} checks passed`);
process.exit(0);
