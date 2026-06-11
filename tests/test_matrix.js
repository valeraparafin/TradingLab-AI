// tests/test_matrix.js
import assert from 'node:assert';
import { expandMatrix, loadRiskProfile, buildHtfDecide } from '../backtest/run-matrix.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

// 1. expandMatrix produces the full cross product in stable order
{
  const cells = expandMatrix({ risks: ['aggressive', 'conservative'], logics: ['SMC'], symbols: ['BTCUSDT', 'ETHUSDT'], tfs: ['1H'] });
  assert.strictEqual(cells.length, 4); // 2 risks × 1 logic × 2 symbols × 1 tf
  assert.deepStrictEqual(cells[0], { riskId: 'aggressive', logicType: 'SMC', symbol: 'BTCUSDT', tf: '1H' });
  assert.deepStrictEqual(cells[3], { riskId: 'conservative', logicType: 'SMC', symbol: 'ETHUSDT', tf: '1H' });
  ok('expandMatrix cross product + order');
}

// 2. loadRiskProfile reads a real template into camelCase *Percent settings
{
  const s = loadRiskProfile('aggressive');
  // Whole-percent convention (units foundation): aggressive is risk 5% / SL 5% / TP 15%.
  assert.strictEqual(s.riskPerTradePercent, 5);
  assert.strictEqual(s.stopLossPercent, 5);
  assert.strictEqual(s.takeProfitPercent, 15);
  assert.strictEqual(s.maxTradeSizeUSD, 500);
  assert.strictEqual(s.portfolioValue, 1000);
  ok('loadRiskProfile reads aggressive template');
}

// 3. loadRiskProfile throws a clear error for an unknown id
{
  assert.throws(() => loadRiskProfile('does_not_exist'), /risk template/i);
  ok('loadRiskProfile rejects unknown id');
}

// 4. buildHtfDecide is off by default — undefined so simulate() uses its default evaluateBar
{
  assert.strictEqual(await buildHtfDecide({}), undefined);
  assert.strictEqual(await buildHtfDecide({ htf: false }), undefined);
  ok('buildHtfDecide off without --htf');
}

// 5. bare --htf builds a decision fn the matrix loop can pass into runOne
{
  const decide = await buildHtfDecide({ htf: true });
  assert.strictEqual(typeof decide, 'function');
  ok('buildHtfDecide on with --htf');
}

console.log(`\n${passed} checks passed`);
