import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { openBacktestDb } from '../src/backtest/backtestSchema.js';
import { BacktestRepo } from '../src/backtest/BacktestRepo.js';

const tmp = path.join(os.tmpdir(), `btrepo_${Date.now()}.db`);

const run = async () => {
  const db = await openBacktestDb(tmp);
  const repo = new BacktestRepo(db);

  const runId = await repo.saveRun({
    strategyLabel: 'SMC scalp', logicType: 'SMC', symbol: 'BTCUSDT', timeframe: '1H',
    periodFrom: 1000, periodTo: 5000, leverage: 1,
    params: { lookback: 250 }, costs: { takerFee: 0.0006 },
    metrics: { return: { netPnl: 123 }, trades: { profitFactor: Infinity } },
  });
  assert.ok(Number.isInteger(runId) && runId > 0, `runId ${runId}`);

  const nt = await repo.saveTrades(runId, [
    { side: 'BUY', entryTime: 1000, entryPrice: 100, exitTime: 2000, exitPrice: 110, sizeUSD: 1000, pnl: 100, fees: 1, reason: 'TP' },
    { side: 'SELL', entryTime: 3000, entryPrice: 120, exitTime: 4000, exitPrice: 115, sizeUSD: 1000, pnl: 41, fees: 1, reason: 'TP' },
  ]);
  assert.strictEqual(nt, 2, 'saved 2 trades');

  const ne = await repo.saveEquityCurve(runId, [{ time: 1000, equity: 10000 }, { time: 2000, equity: 10100 }]);
  assert.strictEqual(ne, 2, 'saved 2 equity points');

  const got = await repo.getRun(runId);
  assert.strictEqual(got.symbol, 'BTCUSDT');
  const parsed = JSON.parse(got.metrics_json);
  assert.strictEqual(parsed.return.netPnl, 123);
  assert.strictEqual(parsed.trades.profitFactor, null, 'Infinity profit factor persists as null (JSON-safe)');

  const trades = await repo.getTrades(runId);
  assert.strictEqual(trades.length, 2);
  assert.strictEqual(trades[0].reason, 'TP');
  assert.strictEqual(trades[0].idx, 0);

  const curve = await repo.getEquityCurve(runId);
  assert.strictEqual(curve.length, 2);
  assert.strictEqual(curve[1].equity, 10100);

  const list = await repo.listRuns();
  assert.ok(list.length >= 1);

  await db.close();
  fs.unlinkSync(tmp);
  console.log('✅ backtest repo tests passed');
};

run().catch(e => { console.error('❌', e); process.exit(1); });
