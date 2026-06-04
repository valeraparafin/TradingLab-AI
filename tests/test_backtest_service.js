// tests/test_backtest_service.js
import assert from 'node:assert';
import { openBacktestDb } from '../src/backtest/backtestSchema.js';
import { BacktestRepo } from '../src/backtest/BacktestRepo.js';
import { createBacktestService } from '../src/server/services/backtest.service.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

const db = await openBacktestDb(':memory:');
const repo = new BacktestRepo(db);
const svc = createBacktestService(repo);

const mkMetrics = (netPnlPct) => ({
  trades: { count: 5, wins: 3, losses: 2, winRate: 0.6, profitFactor: 1.5 },
  return: { netPnl: 100, netPnlPct, finalEquity: 10000 * (1 + netPnlPct) },
  risk: { maxDrawdownPct: 0.05, sharpe: 1.1, sortino: 1.4 },
  costs: { totalFees: 5, slippageCost: 1, totalFunding: 0, liquidationCount: 0 },
  breakdown: { long: { count: 3 }, short: { count: 2 } },
});
const base = { logicType: 'SMC', symbol: 'BTCUSDT', timeframe: '1H', periodFrom: 1, periodTo: 100, leverage: 1, costs: {} };

let a1, u1;
try {
  a1 = await repo.saveRun({ ...base, strategyLabel: 'SMC/aggressive BTCUSDT 1H', params: { lookback: 250 }, metrics: mkMetrics(0.05), group: 'gA' });
  await repo.saveRun({ ...base, strategyLabel: 'SMC/conservative BTCUSDT 1H', params: {}, metrics: mkMetrics(0.20), group: 'gA' });
  await repo.saveRun({ ...base, symbol: 'ETHUSDT', timeframe: '4H', leverage: 3, strategyLabel: 'SMC/aggressive ETHUSDT 4H', params: {}, metrics: mkMetrics(0.10), group: 'gB' });
  u1 = await repo.saveRun({ ...base, strategyLabel: 'SMC BTCUSDT 1H', params: {}, metrics: mkMetrics(0.01), group: null });
  await repo.saveTrades(a1, [{ side: 'BUY', entryTime: 10, entryPrice: 100, exitTime: 20, exitPrice: 110, sizeUSD: 50, pnl: 5, fees: 0.1, reason: 'tp' }]);
  await repo.saveEquityCurve(a1, [{ time: 10, equity: 10000 }, { time: 20, equity: 10050 }]);

  // 1. listGroups buckets runs incl. ungrouped, with labels
  {
    const groups = await svc.listGroups();
    const labels = groups.map(g => g.label);
    assert.ok(labels.includes('gA') && labels.includes('gB') && labels.includes('(ungrouped)'), 'all groups present');
    assert.strictEqual(groups.find(g => g.group === 'gA').runCount, 2);
    assert.strictEqual(groups.find(g => g.group === null).runCount, 1);
    ok('listGroups buckets runs incl. ungrouped');
  }
  // 2. getGroup returns camelCase DTO rows sorted by netPnlPct desc
  {
    const { runs } = await svc.getGroup('gA');
    assert.strictEqual(runs.length, 2);
    assert.ok(runs[0].netPnlPct >= runs[1].netPnlPct, 'sorted desc');
    assert.strictEqual(runs[0].netPnlPct, 0.20);
    assert.strictEqual(runs[0].logicType, 'SMC');
    assert.strictEqual(runs[0].trades, 5);
    ok('getGroup returns sorted camelCase DTO rows');
  }
  // 3. getGroup('ungrouped') maps to run_group IS NULL
  {
    const { group, runs } = await svc.getGroup('ungrouped');
    assert.strictEqual(group, null);
    assert.strictEqual(runs.length, 1);
    assert.strictEqual(runs[0].id, u1);
    ok('getGroup(ungrouped) selects null-group runs');
  }
  // 4. getRunDetail parses json + camelCases trades + returns equity
  {
    const d = await svc.getRunDetail(a1);
    assert.strictEqual(d.run.id, a1);
    assert.strictEqual(d.run.metrics.return.netPnlPct, 0.05, 'metrics parsed');
    assert.strictEqual(d.run.params.lookback, 250, 'params parsed');
    assert.strictEqual(d.equityCurve.length, 2);
    assert.strictEqual(d.trades.length, 1);
    assert.strictEqual(d.trades[0].entryTime, 10, 'trade camelCase entryTime');
    assert.strictEqual(d.trades[0].sizeUSD, 50, 'trade camelCase sizeUSD');
    ok('getRunDetail parses json and camelCases trades');
  }
  // 5. unknown id -> null
  {
    assert.strictEqual(await svc.getRunDetail(99999), null);
    ok('unknown run id returns null');
  }
} finally {
  await db.close();
}
console.log(`\n${passed} checks passed`);
