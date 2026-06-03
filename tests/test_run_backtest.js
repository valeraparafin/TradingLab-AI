import assert from 'assert';
import { buildGuardrails, buildCosts } from '../backtest/run-backtest.js';

const tests = [];
const add = (n, fn) => tests.push({ n, fn });
const near = (a, b, t = 1e-9) => Math.abs(a - b) < t;

add('buildGuardrails: defaults', () => {
  const g = buildGuardrails({});
  assert.strictEqual(g.portfolioValue, 10000);
  assert.ok(near(g.riskPerTrade, 0.1));
  assert.ok(near(g.stopLossPct, 0.02));
  assert.ok(near(g.takeProfitPct, 0.04));
  assert.strictEqual(g.maxOpenPositions, 1);
});

add('buildGuardrails: overrides from args', () => {
  const g = buildGuardrails({ equity: '5000', riskPerTrade: '0.2', sl: '0.01', tp: '0.03', maxOpen: '2' });
  assert.strictEqual(g.portfolioValue, 5000);
  assert.ok(near(g.riskPerTrade, 0.2));
  assert.ok(near(g.stopLossPct, 0.01));
  assert.ok(near(g.takeProfitPct, 0.03));
  assert.strictEqual(g.maxOpenPositions, 2);
});

add('buildCosts: defaults when no spec', () => {
  const c = buildCosts({});
  assert.ok(near(c.takerFee, 0.0006));
  assert.ok(near(c.makerFee, 0.0002));
  assert.strictEqual(c.slippageBps, 5);
});

add('buildCosts: falls back to stored contract spec fees', () => {
  const c = buildCosts({}, { taker_fee: 0.001, maker_fee: 0.0004 });
  assert.ok(near(c.takerFee, 0.001));
  assert.ok(near(c.makerFee, 0.0004));
});

add('buildCosts: explicit args override spec', () => {
  const c = buildCosts({ takerFee: '0.002', slippageBps: '10' }, { taker_fee: 0.001 });
  assert.ok(near(c.takerFee, 0.002));
  assert.strictEqual(c.slippageBps, 10);
});

let failed = 0;
for (const t of tests) { try { t.fn(); console.log(`✅ ${t.n}`); } catch (e) { failed++; console.error(`❌ ${t.n}\n   ${e.message}`); } }
if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log('\nAll run-backtest tests passed!');
