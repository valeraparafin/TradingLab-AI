// tests/test_backtest_repo_group.js
import assert from 'node:assert';
import { openBacktestDb } from '../src/backtest/backtestSchema.js';
import { BacktestRepo } from '../src/backtest/BacktestRepo.js';

const baseRun = (over = {}) => ({
  strategyLabel: 'X', logicType: 'SMC', symbol: 'BTCUSDT', timeframe: '1H',
  periodFrom: 1, periodTo: 2, leverage: 1, params: {}, costs: {}, metrics: {}, ...over,
});

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

const db = await openBacktestDb(':memory:');
const repo = new BacktestRepo(db);

// 1. group is persisted and round-trips
{
  const id = await repo.saveRun(baseRun({ group: 'm_test_1' }));
  const row = await repo.getRun(id);
  assert.strictEqual(row.run_group, 'm_test_1');
  ok('group persisted on saveRun');
}

// 2. omitting group stores NULL (single-run back-compat)
{
  const id = await repo.saveRun(baseRun());
  const row = await repo.getRun(id);
  assert.strictEqual(row.run_group, null);
  ok('absent group stores NULL');
}

// 3. listRunsByGroup returns only that group
{
  await repo.saveRun(baseRun({ group: 'm_test_2', symbol: 'ETHUSDT' }));
  await repo.saveRun(baseRun({ group: 'm_test_2', symbol: 'LTCUSDT' }));
  const rows = await repo.listRunsByGroup('m_test_2');
  assert.strictEqual(rows.length, 2);
  assert.ok(rows.every(r => r.run_group === 'm_test_2'));
  ok('listRunsByGroup filters by group');
}

await db.close();
console.log(`\n${passed} checks passed`);
