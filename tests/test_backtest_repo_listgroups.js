// tests/test_backtest_repo_listgroups.js
import assert from 'node:assert';
import { openBacktestDb } from '../src/backtest/backtestSchema.js';
import { BacktestRepo } from '../src/backtest/BacktestRepo.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

const db = await openBacktestDb(':memory:');
const repo = new BacktestRepo(db);
const base = { logicType: 'SMC', symbol: 'BTCUSDT', timeframe: '1H', periodFrom: 5, periodTo: 50, leverage: 1, params: {}, costs: {}, metrics: {} };
try {
  await repo.saveRun({ ...base, strategyLabel: 'a', group: 'g1' });
  await repo.saveRun({ ...base, strategyLabel: 'b', group: 'g1' });
  await repo.saveRun({ ...base, strategyLabel: 'c', group: 'g2' });
  await repo.saveRun({ ...base, strategyLabel: 'd', group: null });

  // 1. aggregates per run_group (NULLs collapse into one bucket)
  {
    const rows = await repo.listGroups();
    const g1 = rows.find(r => r.group === 'g1');
    assert.strictEqual(g1.run_count, 2);
    assert.strictEqual(g1.period_from, 5);
    assert.strictEqual(g1.period_to, 50);
    assert.ok(rows.some(r => r.group === null && r.run_count === 1), 'null group bucket present');
    ok('listGroups aggregates counts/period per group');
  }
  // 2. ordered by latest run id descending
  {
    const rows = await repo.listGroups();
    assert.ok(rows[0].latest_run_id >= rows[rows.length - 1].latest_run_id, 'ordered desc');
    ok('listGroups ordered by latest run desc');
  }
  // 3. listUngroupedRuns returns only null-group runs
  {
    const rows = await repo.listUngroupedRuns();
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].strategy_label, 'd');
    ok('listUngroupedRuns returns null-group runs only');
  }
} finally {
  await db.close();
}
console.log(`\n${passed} checks passed`);
