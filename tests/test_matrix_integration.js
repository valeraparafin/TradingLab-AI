// tests/test_matrix_integration.js
import assert from 'node:assert';
import path from 'path';
import { openMarketDb } from '../src/data/marketDataSchema.js';
import { MarketDataRepo } from '../src/data/MarketDataRepo.js';
import { openBacktestDb } from '../src/backtest/backtestSchema.js';
import { BacktestRepo } from '../src/backtest/BacktestRepo.js';
import { riskProfileToGuardrails } from '../src/agents/riskProfileToGuardrails.js';
import { runOne, buildCosts } from '../backtest/run-backtest.js';
import { expandMatrix, loadRiskProfile } from '../backtest/run-matrix.js';
import { buildReport } from '../backtest/buildReport.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

const marketDb = await openMarketDb(path.join(process.cwd(), 'market_data.db'));
const marketRepo = new MarketDataRepo(marketDb);
const btDb = await openBacktestDb(':memory:');
const btRepo = new BacktestRepo(btDb);

const lookback = 250;
const group = 'm_integ_test';
// 2 risk profiles × 1 logic × 1 symbol × 1 tf = 2 cells (spot, leverage 1).
const cells = expandMatrix({ risks: ['aggressive', 'conservative'], logics: ['SMC'], symbols: ['BTCUSDT'], tfs: ['1H'] });
assert.strictEqual(cells.length, 2);

const summaries = [];
for (const cell of cells) {
  const candles = await marketRepo.getCandles(cell.symbol, cell.tf, 0, Number.MAX_SAFE_INTEGER);
  assert.ok(candles.length > lookback + 2, `enough candles for ${cell.symbol} ${cell.tf}`);
  const spec = await marketRepo.getContractSpec(cell.symbol);
  const guardrails = riskProfileToGuardrails(loadRiskProfile(cell.riskId), { leverage: 1, mmr: null });
  const costs = buildCosts({}, spec);
  const { runId, metrics } = await runOne(btRepo, {
    label: `${cell.logicType}/${cell.riskId} ${cell.symbol} ${cell.tf}`,
    logicType: cell.logicType, symbol: cell.symbol, tf: cell.tf,
    lookback, leverage: 1, candles, spec, realRows: [], guardrails, costs,
    fundingMode: 'real-mean', fundingRate: 0, group,
  });
  assert.ok(runId > 0);
  assert.strictEqual(metrics.costs.totalFunding, 0, 'spot funding zero');
  summaries.push({ ...cell, leverage: 1, metrics });
}

// 1. all cells persisted under one group
{
  const rows = await btRepo.listRunsByGroup(group);
  assert.strictEqual(rows.length, 2, 'two runs persisted under group');
  assert.ok(rows.every(r => r.run_group === group));
  ok('matrix cells persisted under shared group');
}

// 2. report has one row per cell, sorted by netPnlPct desc
{
  const report = buildReport(summaries);
  assert.strictEqual(report.rows.length, 2);
  assert.ok(report.rows[0].netPnlPct >= report.rows[1].netPnlPct, 'sorted desc');
  assert.ok(report.table.includes('aggressive') && report.table.includes('conservative'));
  ok('report lists both cells, sorted');
}

await marketDb.close();
await btDb.close();
console.log(`\n${passed} checks passed`);
