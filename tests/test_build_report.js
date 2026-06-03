// tests/test_build_report.js
import assert from 'node:assert';
import { buildReport } from '../backtest/buildReport.js';

const mk = (over) => ({
  riskId: 'aggressive', logicType: 'SMC', symbol: 'BTCUSDT', tf: '1H', leverage: 1,
  metrics: {
    trades: { count: 10, winRate: 0.6, profitFactor: 1.8 },
    return: { netPnlPct: 0.12, finalEquity: 11200 },
    risk: { maxDrawdownPct: 0.08, sharpe: 1.3 },
    costs: { totalFunding: 0, liquidationCount: 0 },
  },
  ...over,
});

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

// 1. rows sorted by netPnlPct descending
{
  const r = buildReport([
    mk({ symbol: 'A', metrics: { ...mk().metrics, return: { netPnlPct: 0.05, finalEquity: 1 } } }),
    mk({ symbol: 'B', metrics: { ...mk().metrics, return: { netPnlPct: 0.20, finalEquity: 1 } } }),
    mk({ symbol: 'C', metrics: { ...mk().metrics, return: { netPnlPct: 0.10, finalEquity: 1 } } }),
  ]);
  assert.deepStrictEqual(r.rows.map(x => x.symbol), ['B', 'C', 'A']);
  ok('rows sorted by netPnlPct desc');
}

// 2. table is a string with a header and one line per row
{
  const r = buildReport([mk({ symbol: 'A' }), mk({ symbol: 'B' })]);
  assert.strictEqual(typeof r.table, 'string');
  assert.ok(r.table.includes('WinRate'), 'header present');
  assert.ok(r.table.includes('A') && r.table.includes('B'), 'rows present');
  ok('table renders header + rows');
}

// 3. profitFactor Infinity renders without throwing
{
  const r = buildReport([mk({ metrics: { ...mk().metrics, trades: { count: 3, winRate: 1, profitFactor: Infinity } } })]);
  assert.ok(r.table.includes('∞') || r.table.toLowerCase().includes('inf'), 'infinity rendered');
  ok('infinite profit factor renders');
}

// 4. empty input yields empty rows + a header-only/empty-note table
{
  const r = buildReport([]);
  assert.deepStrictEqual(r.rows, []);
  assert.strictEqual(typeof r.table, 'string');
  ok('empty input handled');
}

// 5. null / non-finite metric fields render as n/a without throwing
{
  const r = buildReport([mk({
    metrics: {
      trades: { count: 0, winRate: null, profitFactor: NaN },
      return: { netPnlPct: undefined, finalEquity: 0 },
      risk: { maxDrawdownPct: null, sharpe: undefined },
      costs: { totalFunding: 0, liquidationCount: 0 },
    },
  })]);
  assert.strictEqual(r.rows.length, 1);
  assert.ok(r.table.includes('n/a'), 'non-finite fields surface as n/a');
  ok('null/non-finite metrics render n/a without throwing');
}

console.log(`\n${passed} checks passed`);
