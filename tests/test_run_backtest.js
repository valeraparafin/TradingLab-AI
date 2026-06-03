import assert from 'assert';
import { buildGuardrails, buildCosts, parseDate } from '../backtest/run-backtest.js';

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
  assert.strictEqual(g.maxTradeSizeUSD, Infinity);
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

add('buildGuardrails: maxTradeSizeUSD override', () => {
  assert.strictEqual(buildGuardrails({ maxTradeSizeUSD: '500' }).maxTradeSizeUSD, 500);
});

add('parseDate: valid ISO, fallback on absent, throws on garbage', () => {
  assert.strictEqual(parseDate('2024-01-01', 0), Date.parse('2024-01-01'));
  assert.strictEqual(parseDate(undefined, 42), 42);
  assert.strictEqual(parseDate(null, 7), 7);
  assert.throws(() => parseDate('not-a-date', 0), /Invalid date/);
});

let failed = 0;
for (const t of tests) { try { t.fn(); console.log(`✅ ${t.n}`); } catch (e) { failed++; console.error(`❌ ${t.n}\n   ${e.message}`); } }
if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log('\nAll run-backtest tests passed!');

// ---- Phase 4: futures builders ----
import { buildGuardrails as bg4, buildCosts as bc4 } from '../backtest/run-backtest.js';
import assertR from 'node:assert';

// leverage + mmr flow into guardrails; defaults are spot.
const gSpot = bg4({});
assertR.strictEqual(gSpot.leverage, 1, 'default leverage 1');
const gFut = bg4({ leverage: '5' });
assertR.strictEqual(gFut.leverage, 5, 'leverage parsed');

// mmr falls back to the contract spec.
const gMmr = bg4({}, { mmr: 0.004 });
assertR.strictEqual(gMmr.mmr, 0.004, 'mmr from spec');
const gMmrArg = bg4({ mmr: '0.01' }, { mmr: 0.004 });
assertR.strictEqual(gMmrArg.mmr, 0.01, 'mmr arg overrides spec');

// liqFeeRate defaults to taker fee, overridable.
const c1 = bc4({}, { taker_fee: 0.0006 });
assertR.strictEqual(c1.liqFeeRate, 0.0006, 'liqFeeRate defaults to taker');
const c2 = bc4({ liqFee: '0.001' }, { taker_fee: 0.0006 });
assertR.strictEqual(c2.liqFeeRate, 0.001, 'liqFee arg overrides');

console.log('test_run_backtest.js futures cases OK');
