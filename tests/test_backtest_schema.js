import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { openBacktestDb } from '../src/backtest/backtestSchema.js';

console.log('Running backtest schema tests...');
const tmp = path.join(os.tmpdir(), `btschema_${Date.now()}.db`);

const run = async () => {
  const db = await openBacktestDb(tmp);
  const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  const names = tables.map(t => t.name);
  assert.ok(names.includes('backtest_runs'), 'backtest_runs table exists');
  assert.ok(names.includes('backtest_trades'), 'backtest_trades table exists');
  assert.ok(names.includes('equity_curve'), 'equity_curve table exists');

  const db2 = await openBacktestDb(tmp); // idempotent
  assert.ok(db2, 'second open succeeds');

  await db.close();
  await db2.close();
  fs.unlinkSync(tmp);
  console.log('✅ backtest schema tests passed');
};

run().catch(e => { console.error('❌', e); process.exit(1); });
