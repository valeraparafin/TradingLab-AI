import assert from 'assert';
import { computeMetrics } from '../src/backtest/metrics.js';

const near = (a, b, t = 1e-6) => Math.abs(a - b) < t;
const TF = 3600000;

const tests = [];
const add = (n, fn) => tests.push({ n, fn });

add('trade stats: win rate, profit factor, expectancy, breakdown', () => {
  const trades = [
    { side: 'BUY',  pnl: 100, fees: 1, entryTime: 0,      exitTime: 2 * TF, reason: 'TP' },
    { side: 'BUY',  pnl: -50, fees: 1, entryTime: 3 * TF, exitTime: 4 * TF, reason: 'SL' },
    { side: 'SELL', pnl: 30,  fees: 1, entryTime: 5 * TF, exitTime: 6 * TF, reason: 'TP' },
  ];
  const equityCurve = [
    { time: 0,      equity: 10000 },
    { time: 1 * TF, equity: 10100 },
    { time: 2 * TF, equity: 9900 },
    { time: 3 * TF, equity: 10200 },
  ];
  const m = computeMetrics({ trades, equityCurve, startEquity: 10000, slippageCost: 4, timeframe: '1H' });

  assert.strictEqual(m.trades.count, 3);
  assert.ok(near(m.trades.winRate, 2 / 3), `winRate ${m.trades.winRate}`);
  assert.ok(near(m.trades.profitFactor, 130 / 50), `pf ${m.trades.profitFactor}`); // (100+30)/50 = 2.6
  assert.ok(near(m.trades.expectancy, (100 - 50 + 30) / 3), `exp ${m.trades.expectancy}`);
  assert.ok(near(m.trades.avgWin, 130 / 2), `avgWin ${m.trades.avgWin}`);
  assert.ok(near(m.trades.avgLoss, -50), `avgLoss ${m.trades.avgLoss}`);
  assert.strictEqual(m.breakdown.long.count, 2);
  assert.strictEqual(m.breakdown.short.count, 1);
  assert.ok(near(m.breakdown.short.netPnl, 30));
});

add('return + drawdown from equity curve', () => {
  const equityCurve = [
    { time: 0,      equity: 10000 },
    { time: 1 * TF, equity: 10100 },
    { time: 2 * TF, equity: 9900 },  // drawdown from peak 10100
    { time: 3 * TF, equity: 10200 },
  ];
  const m = computeMetrics({ trades: [], equityCurve, startEquity: 10000, slippageCost: 0, timeframe: '1H' });
  assert.ok(near(m.return.netPnl, 200), `netPnl ${m.return.netPnl}`);
  assert.ok(near(m.return.netPnlPct, 0.02), `netPnlPct ${m.return.netPnlPct}`);
  assert.ok(near(m.return.finalEquity, 10200));
  // max drawdown = (10100 - 9900)/10100
  assert.ok(near(m.risk.maxDrawdownPct, (10100 - 9900) / 10100), `maxDD ${m.risk.maxDrawdownPct}`);
  assert.ok(m.risk.maxDrawdownDurationMs >= TF, `ddDur ${m.risk.maxDrawdownDurationMs}`);
});

add('costs group present (funding/liquidation zero for spot)', () => {
  const m = computeMetrics({ trades: [{ side: 'BUY', pnl: 10, fees: 2, entryTime: 0, exitTime: TF, reason: 'TP' }], equityCurve: [{ time: 0, equity: 10000 }, { time: TF, equity: 10010 }], startEquity: 10000, slippageCost: 1.5, timeframe: '1H' });
  assert.ok(near(m.costs.totalFees, 2));
  assert.strictEqual(m.costs.totalFunding, 0);
  assert.strictEqual(m.costs.liquidationCount, 0);
  assert.ok(near(m.costs.slippageCost, 1.5));
});

add('profit factor is Infinity for an all-win run (no losses)', () => {
  const trades = [
    { side: 'BUY', pnl: 50, fees: 1, entryTime: 0,       exitTime: 1 * TF, reason: 'TP' },
    { side: 'BUY', pnl: 20, fees: 1, entryTime: 2 * TF,  exitTime: 3 * TF, reason: 'TP' },
  ];
  const equityCurve = [
    { time: 0,      equity: 10000 },
    { time: 1 * TF, equity: 10050 },
    { time: 3 * TF, equity: 10070 },
  ];
  const m = computeMetrics({ trades, equityCurve, startEquity: 10000, slippageCost: 0, timeframe: '1H' });
  assert.strictEqual(m.trades.profitFactor, Infinity, 'no losses -> Infinity profit factor');
  assert.strictEqual(m.trades.winRate, 1);
  assert.strictEqual(m.trades.losses, 0);
});

add('empty run does not throw and yields zeros', () => {
  const m = computeMetrics({ trades: [], equityCurve: [], startEquity: 10000, slippageCost: 0, timeframe: '1H' });
  assert.strictEqual(m.trades.count, 0);
  assert.strictEqual(m.trades.profitFactor, 0);
  assert.strictEqual(m.return.netPnl, 0);
  assert.strictEqual(m.risk.maxDrawdownPct, 0);
});

let failed = 0;
for (const t of tests) { try { t.fn(); console.log(`✅ ${t.n}`); } catch (e) { failed++; console.error(`❌ ${t.n}\n   ${e.message}`); } }
if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log('\nAll metrics tests passed!');

// ---- Phase 4: funding + liquidation aggregation (explicit inputs from simulator) ----
import { computeMetrics as cm4 } from '../src/backtest/metrics.js';
import assertM from 'node:assert';

const eq = [{ time: 0, equity: 10000 }, { time: 3600000, equity: 9900 }];
const trades4 = [
  { side: 'BUY', entryTime: 0, exitTime: 3600000, pnl: -50, fees: 1, funding: 2, reason: 'LIQUIDATION' },
  { side: 'SELL', entryTime: 0, exitTime: 3600000, pnl: -50, fees: 1, funding: -1, reason: 'SL' },
];
// Explicit aggregates from the simulator flow through to costs.
const m = cm4({ trades: trades4, equityCurve: eq, startEquity: 10000, timeframe: '1H', totalFunding: 1, liquidationCount: 1 });
assertM.ok(Math.abs(m.costs.totalFunding - 1) < 1e-12, 'totalFunding passed through');
assertM.strictEqual(m.costs.liquidationCount, 1, 'liquidationCount passed through');

// Defaults to 0/0 when not provided (spot).
const spot = cm4({ trades: [{ side: 'BUY', entryTime: 0, exitTime: 3600000, pnl: 5, fees: 1, reason: 'TP' }], equityCurve: eq, startEquity: 10000, timeframe: '1H' });
assertM.strictEqual(spot.costs.totalFunding, 0, 'default totalFunding 0');
assertM.strictEqual(spot.costs.liquidationCount, 0, 'default liquidationCount 0');

console.log('test_metrics.js futures cases OK');
