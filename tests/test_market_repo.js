import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { openMarketDb } from '../src/data/marketDataSchema.js';
import { MarketDataRepo } from '../src/data/MarketDataRepo.js';

const tmp = path.join(os.tmpdir(), `mdrepo_${Date.now()}.db`);

const run = async () => {
  const db = await openMarketDb(tmp);
  const repo = new MarketDataRepo(db);
  const c = (time, close) => ({ time, open: close, high: close, low: close, close, volume: 1 });

  const n1 = await repo.upsertCandles('BTCUSDT', '1H', [c(1000, 10), c(2000, 11), c(3000, 12)]);
  assert.strictEqual(n1, 3, 'inserted 3');
  const n2 = await repo.upsertCandles('BTCUSDT', '1H', [c(2000, 11), c(3000, 12)]);
  assert.strictEqual(n2, 0, 're-inserting duplicates inserts 0');

  const got = await repo.getCandles('BTCUSDT', '1H', 1000, 3000);
  assert.strictEqual(got.length, 3);
  assert.strictEqual(got[0].time, 1000);
  assert.strictEqual(got[2].close, 12);

  assert.strictEqual(await repo.lastCandleTime('BTCUSDT', '1H'), 3000);
  assert.strictEqual(await repo.lastCandleTime('ETHUSDT', '1H'), null);

  // gap: missing 5000 between 4000 and 6000 (step 1000); 3000->4000 contiguous
  await repo.upsertCandles('BTCUSDT', '1H', [c(4000, 13), c(6000, 15)]);
  const gaps = await repo.findGaps('BTCUSDT', '1H', 1000);
  assert.deepStrictEqual(gaps, [5000], `gaps ${JSON.stringify(gaps)}`);

  await db.close();
  fs.unlinkSync(tmp);
  console.log('✅ market repo (candles) tests passed');
};

run().catch(e => { console.error('❌', e); process.exit(1); });
