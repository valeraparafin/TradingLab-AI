import assert from 'assert';
import { slip, checkExit } from '../src/backtest/execution.js';

const tests = [];
const add = (n, fn) => tests.push({ n, fn });
const near = (a, b, t = 1e-9) => Math.abs(a - b) < t;

add('slip worsens fill: BUY pays more, SELL receives less', () => {
  assert.ok(near(slip(100, 'BUY', 5), 100.05));   // +0.05%
  assert.ok(near(slip(100, 'SELL', 5), 99.95));    // -0.05%
  assert.strictEqual(slip(100, 'BUY', 0), 100);    // no slippage
});

add('checkExit BUY intrabar SL (market, slippage) takes priority over TP', () => {
  const pos = { side: 'BUY', slPrice: 90, tpPrice: 110 };
  const bar = { open: 100, high: 111, low: 89 }; // both SL and TP touched -> SL wins
  const ex = checkExit(pos, bar, { slippageBps: 10 }, false);
  assert.strictEqual(ex.reason, 'SL');
  assert.ok(near(ex.idealPrice, 90));
  assert.ok(near(ex.exitPrice, slip(90, 'SELL', 10))); // 89.91
  assert.strictEqual(ex.market, true);
});

add('checkExit BUY intrabar TP (limit, no slippage)', () => {
  const pos = { side: 'BUY', slPrice: 90, tpPrice: 110 };
  const bar = { open: 100, high: 111, low: 95 };
  const ex = checkExit(pos, bar, { slippageBps: 10 }, false);
  assert.strictEqual(ex.reason, 'TP');
  assert.strictEqual(ex.exitPrice, 110);
  assert.strictEqual(ex.market, false);
});

add('checkExit BUY gap-on-open below SL exits at slipped open', () => {
  const pos = { side: 'BUY', slPrice: 90, tpPrice: 110 };
  const bar = { open: 85, high: 88, low: 80 };
  const ex = checkExit(pos, bar, { slippageBps: 10 }, false);
  assert.strictEqual(ex.reason, 'SL_GAP');
  assert.ok(near(ex.idealPrice, 85));
  assert.ok(near(ex.exitPrice, slip(85, 'SELL', 10)));
});

add('checkExit skips gap-on-open on the entry bar', () => {
  const pos = { side: 'BUY', slPrice: 90, tpPrice: 110 };
  const bar = { open: 85, high: 88, low: 86 }; // open below SL, but it is the entry bar
  const ex = checkExit(pos, bar, { slippageBps: 10 }, true);
  // entry bar: no gap check; intrabar low 86 <= 90 -> SL at slPrice 90 (market)
  assert.strictEqual(ex.reason, 'SL');
  assert.ok(near(ex.idealPrice, 90));
});

add('checkExit SELL intrabar SL and TP mirror correctly', () => {
  const pos = { side: 'SELL', slPrice: 110, tpPrice: 90 };
  const slBar = { open: 100, high: 111, low: 99 };
  const slEx = checkExit(pos, slBar, { slippageBps: 10 }, false);
  assert.strictEqual(slEx.reason, 'SL');
  assert.ok(near(slEx.exitPrice, slip(110, 'BUY', 10))); // buy-back slips up
  const tpBar = { open: 100, high: 101, low: 89 };
  const tpEx = checkExit(pos, tpBar, { slippageBps: 10 }, false);
  assert.strictEqual(tpEx.reason, 'TP');
  assert.strictEqual(tpEx.exitPrice, 90);
});

add('checkExit TP_GAP: open gaps past TP fills at tpPrice (limit, no slippage)', () => {
  // BUY: open gaps up through TP 110
  const buyPos = { side: 'BUY', slPrice: 90, tpPrice: 110 };
  const buyBar = { open: 115, high: 116, low: 112 };
  const buyEx = checkExit(buyPos, buyBar, { slippageBps: 10 }, false);
  assert.strictEqual(buyEx.reason, 'TP_GAP');
  assert.strictEqual(buyEx.exitPrice, 110);
  assert.strictEqual(buyEx.market, false);

  // SELL: open gaps down through TP 90
  const sellPos = { side: 'SELL', slPrice: 110, tpPrice: 90 };
  const sellBar = { open: 85, high: 88, low: 84 };
  const sellEx = checkExit(sellPos, sellBar, { slippageBps: 10 }, false);
  assert.strictEqual(sellEx.reason, 'TP_GAP');
  assert.strictEqual(sellEx.exitPrice, 90);
  assert.strictEqual(sellEx.market, false);
});

add('checkExit returns null when no level is touched', () => {
  const pos = { side: 'BUY', slPrice: 90, tpPrice: 110 };
  const bar = { open: 100, high: 105, low: 95 };
  assert.strictEqual(checkExit(pos, bar, { slippageBps: 5 }, false), null);
});

let failed = 0;
for (const t of tests) { try { t.fn(); console.log(`✅ ${t.n}`); } catch (e) { failed++; console.error(`❌ ${t.n}\n   ${e.message}`); } }
if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log('\nAll execution tests passed!');

// ---- Phase 4: liquidation level ----
import { checkExit as checkExit4 } from '../src/backtest/execution.js';
import assertL from 'node:assert';

const noCost = { slippageBps: 0 };

// Long, liq below SL is irrelevant; here liq (95) is ABOVE sl (90) → liq triggers first on a fall.
const lpos = { side: 'BUY', slPrice: 90, tpPrice: 110, liqPrice: 95 };
const liqHit = checkExit4(lpos, { open: 100, high: 100, low: 94 }, noCost, false);
assertL.strictEqual(liqHit.reason, 'LIQUIDATION', 'long: liq above SL triggers first');
assertL.strictEqual(liqHit.exitPrice, 95, 'liq fills at liq price');

// Long, SL (96) above liq (90): SL triggers first (normal, tight SL).
const slFirst = checkExit4({ side: 'BUY', slPrice: 96, tpPrice: 110, liqPrice: 90 }, { open: 100, high: 100, low: 95 }, noCost, false);
assertL.strictEqual(slFirst.reason, 'SL', 'long: SL above liq triggers first');

// Long gap down through liq on the open (non-entry) → LIQ_GAP.
const liqGap = checkExit4(lpos, { open: 93, high: 96, low: 92 }, noCost, false);
assertL.strictEqual(liqGap.reason, 'LIQ_GAP', 'long: open gaps past liq → LIQ_GAP');

// Short mirror: liq (105) below sl (110) → liq triggers first on a rise.
const spos = { side: 'SELL', slPrice: 110, tpPrice: 90, liqPrice: 105 };
const sLiq = checkExit4(spos, { open: 100, high: 106, low: 100 }, noCost, false);
assertL.strictEqual(sLiq.reason, 'LIQUIDATION', 'short: liq below SL triggers first');

// Spot parity: no liqPrice on pos → behaves exactly as before (SL).
const spot = checkExit4({ side: 'BUY', slPrice: 96, tpPrice: 110 }, { open: 100, high: 100, low: 95 }, noCost, false);
assertL.strictEqual(spot.reason, 'SL', 'no liqPrice → spot SL behavior unchanged');

// Tie-break: liqPrice === slPrice → LIQUIDATION (pessimistic).
const tie = checkExit4({ side: 'BUY', slPrice: 95, tpPrice: 110, liqPrice: 95 }, { open: 100, high: 100, low: 94 }, noCost, false);
assertL.strictEqual(tie.reason, 'LIQUIDATION', 'long: liq==SL tie → LIQUIDATION');

// Short gap up through liq on the open → LIQ_GAP.
const sLiqGap = checkExit4(spos, { open: 106, high: 108, low: 104 }, noCost, false);
assertL.strictEqual(sLiqGap.reason, 'LIQ_GAP', 'short: open gaps past liq → LIQ_GAP');

// Intrabar crossing both liq and TP → liquidation takes precedence (adverse before favorable).
const liqOverTp = checkExit4({ side: 'BUY', slPrice: 90, tpPrice: 110, liqPrice: 95 }, { open: 100, high: 112, low: 94 }, noCost, false);
assertL.strictEqual(liqOverTp.reason, 'LIQUIDATION', 'long: liq precedes TP when both touched');

console.log('test_execution.js liquidation cases OK');
