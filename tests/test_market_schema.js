import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { openMarketDb } from '../src/data/marketDataSchema.js';

console.log('Running market schema tests...');

const tmp = path.join(os.tmpdir(), `mdtest_${Date.now()}.db`);

const run = async () => {
  const db = await openMarketDb(tmp);
  const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  const names = tables.map(t => t.name);
  assert.ok(names.includes('candles'), 'candles table exists');
  assert.ok(names.includes('funding_rates'), 'funding_rates table exists');
  assert.ok(names.includes('contract_specs'), 'contract_specs table exists');

  const db2 = await openMarketDb(tmp); // idempotent: second open must not throw
  assert.ok(db2, 'second open succeeds');

  await db.close();
  await db2.close();
  fs.unlinkSync(tmp);
  console.log('✅ market schema tests passed');
};

run().catch(e => { console.error('❌', e); process.exit(1); });
