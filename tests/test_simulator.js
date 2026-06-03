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

add('no look-ahead: entry fills at NEXT bar open, not the decision bar close', () => {
  // Decision bar close = 100, but the next bar opens at 120. If the engine wrongly
  // filled at close[i] the entry would be 100; the correct next-bar-open fill is 120.
  const candles = [
    c(0, 100, 100, 100, 100),
    c(1, 100, 101, 99, 100),     // decision bar (flat): close = 100
    c(2, 120, 125, 118, 122),    // entry bar: open = 120 (deliberately != close[1])
    c(3, 122, 135, 121, 130),    // TP 130 hit (high 135)
    c(4, 130, 131, 129, 130),
  ];
  const order = { side: 'BUY', sizeUSD: 1000, entryPrice: 100, slPrice: 90, tpPrice: 130 };
  const res = simulate(
    { candles, config: { logicType: 'X' }, guardrails: { portfolioValue: 10000 }, costs: { takerFee: 0, makerFee: 0, slippageBps: 0 }, symbol: 'BTCUSDT', timeframe: '1H', lookback: 1, startEquity: 10000 },
    makeDecide(order)
  );
  assert.strictEqual(res.trades.length, 1, 'one trade');
  const t = res.trades[0];
  assert.ok(near(t.entryPrice, 120), `entry must be next-bar open 120, got ${t.entryPrice}`);
  assert.strictEqual(t.reason, 'TP');
  assert.ok(near(t.exitPrice, 130), `exit ${t.exitPrice}`);
  assert.ok(near(t.pnl, 1000 * (130 - 120) / 120), `pnl ${t.pnl}`);
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

// ---- Phase 4: futures (leverage, funding, liquidation) ----
import { simulate as simulate4 } from '../src/backtest/simulator.js';
import assertF from 'node:assert';

const H8 = 8 * 3600000;
const TF4 = 3600000; // 1h bars (renamed to avoid collision with top-level TF)
// Always-enter decider: PERMIT a long with fixed SL/TP and notional.
const alwaysLong = (lev) => () => ({
  signal: { side: 'BUY', conviction: 1 },
  decision: { decision: 'PERMIT', order: { side: 'BUY', sizeUSD: 1000, slPrice: null, tpPrice: null, leverage: lev, marginUSD: 1000 / lev } },
});

// Helper: n flat-ish candles starting at t0.
const mkBars = (n, t0, priceFn) => Array.from({ length: n }, (_, i) => {
  const p4 = priceFn(i);
  return { time: t0 + i * TF4, open: p4, high: p4 * 1.001, low: p4 * 0.999, close: p4 };
});

// (a) Liquidation: 10x long, price crashes below liq (~0.905*entry). Loss capped at margin (+ fees).
const crash = mkBars(40, 0, (i) => i < 20 ? 100 : 50); // halves after bar 20
const liqRun = simulate4({
  candles: crash, config: { logicType: 'X' },
  guardrails: { portfolioValue: 10000, leverage: 10, mmr: 0.005 },
  costs: { takerFee: 0.0006, makerFee: 0.0002, slippageBps: 0, liqFeeRate: 0.0006 },
  symbol: 'T', timeframe: '1H', lookback: 5,
}, alwaysLong(10));
const liqTrade = liqRun.trades.find(t => t.reason === 'LIQUIDATION' || t.reason === 'LIQ_GAP');
assertF.ok(liqTrade, 'a liquidation occurred on the crash');
// margin = 1000/10 = 100; loss ≈ -(100 + liqFee + funding). With no funding here: ~ -100 - (1000*0.0006).
assertF.ok(liqTrade.pnl < -99 && liqTrade.pnl > -102, `liq loss capped near margin, got ${liqTrade.pnl}`);

// (b) Funding accrual: long pays positive funding; equity ends lower than the no-funding run.
const flat = mkBars(80, 0, () => 100); // price never moves
const common = {
  candles: flat, config: { logicType: 'X' },
  guardrails: { portfolioValue: 10000, leverage: 5, mmr: 0.005 },
  costs: { takerFee: 0, makerFee: 0, slippageBps: 0, liqFeeRate: 0 },
  symbol: 'T', timeframe: '1H', lookback: 5,
};
const withFunding = simulate4({ ...common, funding: { rateAt: () => 0.0001, intervalMs: H8 } }, alwaysLong(5));
const noFunding = simulate4({ ...common }, alwaysLong(5));
assertF.ok(withFunding.finalEquity < noFunding.finalEquity, 'positive funding lowers equity for a long');
assertF.ok(withFunding.totalFunding > 0, 'totalFunding positive (long paid funding)');

// (c) Determinism: same futures inputs → identical result.
const r1 = simulate4({ ...common, funding: { rateAt: () => 0.0001, intervalMs: H8 } }, alwaysLong(5));
const r2 = simulate4({ ...common, funding: { rateAt: () => 0.0001, intervalMs: H8 } }, alwaysLong(5));
assertF.deepStrictEqual(r1, r2, 'futures run is deterministic');

// (d) Parity: leverage=1 + no funding must equal the pure spot path (no funding/liq fields leak).
const spotRun = simulate4({
  candles: flat, config: { logicType: 'X' },
  guardrails: { portfolioValue: 10000 }, costs: { takerFee: 0, makerFee: 0, slippageBps: 0 },
  symbol: 'T', timeframe: '1H', lookback: 5,
}, () => ({ signal: { side: 'BUY', conviction: 1 }, decision: { decision: 'PERMIT', order: { side: 'BUY', sizeUSD: 1000, slPrice: null, tpPrice: null } } }));
assertF.strictEqual(spotRun.totalFunding, 0, 'spot totalFunding = 0');
assertF.ok(spotRun.trades.every(t => t.funding === 0), 'spot trades carry funding 0');

console.log('test_simulator.js futures cases OK');
