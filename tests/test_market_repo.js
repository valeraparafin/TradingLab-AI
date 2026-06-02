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

  // ---- funding ----
  const fn1 = await repo.upsertFunding('BTCUSDT', [{ time: 8000, rate: 0.0001 }, { time: 16000, rate: -0.0002 }]);
  assert.strictEqual(fn1, 2, 'inserted 2 funding rows');
  const fn2 = await repo.upsertFunding('BTCUSDT', [{ time: 16000, rate: -0.0002 }]);
  assert.strictEqual(fn2, 0, 'duplicate funding inserts 0');
  const fund = await repo.getFunding('BTCUSDT', 0, 20000);
  assert.strictEqual(fund.length, 2);
  assert.strictEqual(fund[0].time, 8000);
  assert.ok(Math.abs(fund[1].rate - -0.0002) < 1e-12);

  // ---- contract specs ----
  await repo.upsertContractSpec({ symbol: 'BTCUSDT', mmr: 0.005, max_leverage: 150, min_leverage: 1, taker_fee: 0.0006, maker_fee: 0.0002, fund_interval_h: 8, tick_size: 0.1, qty_step: 0.0001, price_precision: 1, qty_precision: 4, min_trade_num: 0.0001, min_trade_usdt: 5 });
  const spec = await repo.getContractSpec('BTCUSDT');
  assert.strictEqual(spec.max_leverage, 150);
  assert.strictEqual(spec.taker_fee, 0.0006);
  assert.strictEqual(spec.mmr, 0.005);
  await repo.upsertContractSpec({ symbol: 'BTCUSDT', mmr: 0.01, max_leverage: 125, min_leverage: 1, taker_fee: 0.0006, maker_fee: 0.0002, fund_interval_h: 8, tick_size: 0.1, qty_step: 0.0001, price_precision: 1, qty_precision: 4, min_trade_num: 0.0001, min_trade_usdt: 5 });
  const spec2 = await repo.getContractSpec('BTCUSDT');
  assert.strictEqual(spec2.max_leverage, 125, 'spec overwritten (INSERT OR REPLACE)');
  assert.strictEqual(await repo.getContractSpec('NOPEUSDT'), undefined);

  await db.close();
  fs.unlinkSync(tmp);
  console.log('✅ market repo (candles) tests passed');
};

run().catch(e => { console.error('❌', e); process.exit(1); });
