import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { openMarketDb } from '../src/data/marketDataSchema.js';
import { MarketDataRepo } from '../src/data/MarketDataRepo.js';
import { verifyCandles, parseArgs } from '../backtest/download-data.js';

const tmp = path.join(os.tmpdir(), `mdverify_${Date.now()}.db`);

const run = async () => {
  // parseArgs is pure — test it directly.
  const a = parseArgs(['--symbol', 'BTCUSDT,ETHUSDT', '--tf', '1H', '--verify']);
  assert.strictEqual(a.symbol, 'BTCUSDT,ETHUSDT');
  assert.strictEqual(a.tf, '1H');
  assert.strictEqual(a.verify, true);

  const db = await openMarketDb(tmp);
  const repo = new MarketDataRepo(db);
  const TF = 3600000;
  const c = (t, close) => ({ time: t, open: close, high: close, low: close, close, volume: 1 });

  await repo.upsertCandles('BTCUSDT', '1H', [c(TF, 10), c(2 * TF, 11), c(3 * TF, 12)]);
  let report = await verifyCandles(repo, 'BTCUSDT', '1H');
  assert.strictEqual(report.gaps.length, 0, 'no gaps');
  assert.strictEqual(report.bad.length, 0, 'no bad candles');
  assert.strictEqual(report.count, 3);

  // add a gap (missing 5*TF) and a bad candle (zero price)
  await repo.upsertCandles('BTCUSDT', '1H', [c(4 * TF, 13), c(6 * TF, 0)]);
  report = await verifyCandles(repo, 'BTCUSDT', '1H');
  assert.deepStrictEqual(report.gaps, [5 * TF], `gaps ${JSON.stringify(report.gaps)}`);
  assert.deepStrictEqual(report.bad, [6 * TF], `bad ${JSON.stringify(report.bad)}`);

  await db.close();
  fs.unlinkSync(tmp);
  console.log('✅ verify tests passed');
};

run().catch(e => { console.error('❌', e); process.exit(1); });
