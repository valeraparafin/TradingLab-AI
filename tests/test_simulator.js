import assert from 'assert';
import { simulate } from '../src/backtest/simulator.js';

const near = (a, b, t = 1e-6) => Math.abs(a - b) < t;
const TF = 3600000;
const c = (i, o, h, l, cl) => ({ time: i * TF, open: o, high: h, low: l, close: cl, volume: 1 });

// A scripted decision fn: PERMIT a BUY on the first flat decision, HOLD afterwards.
function makeDecide(order) {
  let calls = 0;
  return () => {
    calls++;
    if (calls === 1) return { signal: { side: 'BUY', conviction: 1, reason: 't' }, decision: { decision: 'PERMIT', order } };
    return { signal: { side: 'HOLD', conviction: 0, reason: 'h' }, decision: { decision: 'DENY', reason: 'HOLD' } };
  };
}

const tests = [];
const add = (n, fn) => tests.push({ n, fn });

add('BUY filled at next-bar open, exits at TP; pnl & equity correct (no costs)', () => {
  // i:0 warmup; i:1 decide PERMIT (pending); i:2 fill at open; i:3 hits TP.
  const candles = [
    c(0, 100, 100, 100, 100),
    c(1, 100, 101, 99, 100),     // decision bar (flat)
    c(2, 100, 105, 99, 102),     // entry bar: fill at open=100; no SL/TP touched intrabar
    c(3, 102, 112, 101, 108),    // TP 110 hit (high 112)
    c(4, 108, 109, 107, 108),    // flat afterwards
  ];
  const order = { side: 'BUY', sizeUSD: 1000, entryPrice: 100, slPrice: 90, tpPrice: 110 };
  const res = simulate(
    { candles, config: { logicType: 'X' }, guardrails: { portfolioValue: 10000 }, costs: { takerFee: 0, makerFee: 0, slippageBps: 0 }, symbol: 'BTCUSDT', timeframe: '1H', lookback: 1, startEquity: 10000 },
    makeDecide(order)
  );
  assert.strictEqual(res.trades.length, 1, 'one trade');
  const t = res.trades[0];
  assert.strictEqual(t.side, 'BUY');
  assert.strictEqual(t.reason, 'TP');
  assert.ok(near(t.entryPrice, 100), `entry ${t.entryPrice}`);
  assert.ok(near(t.exitPrice, 110), `exit ${t.exitPrice}`);
  assert.ok(near(t.pnl, 100), `pnl ${t.pnl}`);          // 1000 * (110-100)/100 = 100, no fees
  assert.ok(near(res.finalEquity, 10100), `equity ${res.finalEquity}`);
  assert.strictEqual(res.equityCurve.length, 4, 'curve has one point per iterated bar (i=1..4)');
});

add('fees + slippage are applied (BUY -> TP)', () => {
  const candles = [
    c(0, 100, 100, 100, 100),
    c(1, 100, 101, 99, 100),
    c(2, 100, 105, 99, 102),
    c(3, 102, 112, 101, 108),
    c(4, 108, 109, 107, 108),
  ];
  const order = { side: 'BUY', sizeUSD: 1000, entryPrice: 100, slPrice: 90, tpPrice: 110 };
  const res = simulate(
    { candles, config: { logicType: 'X' }, guardrails: { portfolioValue: 10000 }, costs: { takerFee: 0.0006, makerFee: 0.0002, slippageBps: 5 }, symbol: 'BTCUSDT', timeframe: '1H', lookback: 1, startEquity: 10000 },
    makeDecide(order)
  );
  const t = res.trades[0];
  // entry fill = 100 * (1 + 0.0005) = 100.05 ; TP exit = 110 (limit, no slip)
  assert.ok(near(t.entryPrice, 100.05), `entry ${t.entryPrice}`);
  assert.strictEqual(t.exitPrice, 110);
  const ret = (110 - 100.05) / 100.05;
  const fees = 1000 * 0.0006 + 1000 * 0.0002; // entry taker + exit maker
  assert.ok(near(t.fees, fees), `fees ${t.fees}`);
  assert.ok(near(t.pnl, 1000 * ret - fees), `pnl ${t.pnl}`);
  assert.ok(res.slippageCost > 0, 'slippage cost accrued on the market entry');
});

add('SL exit (market) on a BUY', () => {
  const candles = [
    c(0, 100, 100, 100, 100),
    c(1, 100, 101, 99, 100),
    c(2, 100, 102, 99, 101),     // entry at open 100; intrabar low 99 > SL 90 -> no exit
    c(3, 101, 102, 85, 88),      // low 85 <= SL 90 -> SL
    c(4, 88, 89, 87, 88),
  ];
  const order = { side: 'BUY', sizeUSD: 1000, entryPrice: 100, slPrice: 90, tpPrice: 200 };
  const res = simulate(
    { candles, config: { logicType: 'X' }, guardrails: { portfolioValue: 10000 }, costs: { takerFee: 0, makerFee: 0, slippageBps: 0 }, symbol: 'BTCUSDT', timeframe: '1H', lookback: 1, startEquity: 10000 },
    makeDecide(order)
  );
  assert.strictEqual(res.trades[0].reason, 'SL');
  assert.ok(near(res.trades[0].exitPrice, 90));
  assert.ok(near(res.trades[0].pnl, 1000 * (90 - 100) / 100), `pnl ${res.trades[0].pnl}`); // -100
});

add('determinism: same input -> identical output', () => {
  const candles = [c(0,100,100,100,100), c(1,100,101,99,100), c(2,100,105,99,102), c(3,102,112,101,108), c(4,108,109,107,108)];
  const order = { side: 'BUY', sizeUSD: 1000, entryPrice: 100, slPrice: 90, tpPrice: 110 };
  const params = { candles, config: { logicType: 'X' }, guardrails: { portfolioValue: 10000 }, costs: { takerFee: 0.0006, makerFee: 0.0002, slippageBps: 5 }, symbol: 'BTCUSDT', timeframe: '1H', lookback: 1, startEquity: 10000 };
  const a = simulate(params, makeDecide(order));
  const b = simulate(params, makeDecide(order));
  assert.deepStrictEqual(a, b, 'two runs identical');
});

let failed = 0;
for (const t of tests) { try { t.fn(); console.log(`✅ ${t.n}`); } catch (e) { failed++; console.error(`❌ ${t.n}\n   ${e.message}`); } }
if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log('\nAll simulator tests passed!');
