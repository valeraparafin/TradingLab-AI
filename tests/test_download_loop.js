import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { openMarketDb } from '../src/data/marketDataSchema.js';
import { MarketDataRepo } from '../src/data/MarketDataRepo.js';
import { downloadCandles } from '../src/data/marketDataFetch.js';

const tmp = path.join(os.tmpdir(), `mddl_${Date.now()}.db`);

// Fake Binance: bare array of klines from startTime, 2 per page, up to a ceiling.
function makeFakeFetch(maxTime) {
  const TF = 3600000;
  return async (url) => {
    const u = new URL(url);
    const start = Number(u.searchParams.get('startTime'));
    const out = [];
    for (let t = start; t < start + TF * 2 && t <= maxTime; t += TF) {
      out.push([t, '10', '11', '9', '10.5', '100', t + TF - 1, '1000', 5]); // Binance kline shape
    }
    return { ok: true, json: async () => out }; // Binance returns a bare array
  };
}

const run = async () => {
  const db = await openMarketDb(tmp);
  const repo = new MarketDataRepo(db);
  const TF = 3600000;
  const from = 1000000 * TF;
  const maxTime = from + TF * 5; // 6 candles available

  const inserted = await downloadCandles(repo, { symbol: 'BTCUSDT', timeframe: '1H', from, to: maxTime, pageLimit: 2 }, makeFakeFetch(maxTime));
  assert.strictEqual(inserted, 6, `inserted ${inserted}`);

  const again = await downloadCandles(repo, { symbol: 'BTCUSDT', timeframe: '1H', from, to: maxTime, pageLimit: 2 }, makeFakeFetch(maxTime));
  assert.strictEqual(again, 0, 'idempotent re-run inserts 0');

  const stored = await repo.getCandles('BTCUSDT', '1H', from, maxTime);
  assert.strictEqual(stored.length, 6);
  assert.strictEqual(stored[0].time, from);
  assert.strictEqual(stored[5].time, from + TF * 5);

  await db.close();
  fs.unlinkSync(tmp);
  console.log('✅ download loop tests passed');
};

run().catch(e => { console.error('❌', e); process.exit(1); });
