// tests/test_ob_gate.mjs
import assert from 'node:assert';
import { withOrderBookGate } from '../src/marketdata/orderbook/obGate.js';
let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

const featOk = { ready: true, futures: { mid: 100, spread: 0.05, imbalance: 0.5 } };
const permitBuy = () => ({ signal: { side: 'BUY' }, decision: { decision: 'PERMIT', order: { side: 'BUY' } } });

let g = withOrderBookGate(permitBuy);
assert.strictEqual(g({ feat: featOk }, {}).decision.decision, 'PERMIT'); ok('clean PERMIT passes');

// BUY but imbalance < 0 → contradiction
assert.strictEqual(
  g({ feat: { ready: true, futures: { mid: 100, spread: 0.05, imbalance: -0.3 } } }, {}).decision.reason,
  'ob gate: book contradicts side'); ok('BUY + negative imbalance → DENY');

// book not ready
assert.strictEqual(g({ feat: { ready: false } }, {}).decision.decision, 'DENY'); ok('not ready → DENY');

// wide spread: 8bps of mid 100 = 0.08; spread 0.2 exceeds it
assert.strictEqual(
  g({ feat: { ready: true, futures: { mid: 100, spread: 0.2, imbalance: 0.5 } } }, {}).decision.reason,
  'ob gate: spread too wide'); ok('wide spread → DENY');

// inner HOLD / DENY pass through unchanged
g = withOrderBookGate(() => ({ signal: null, decision: { decision: 'HOLD' } }));
assert.strictEqual(g({ feat: featOk }, {}).decision.decision, 'HOLD'); ok('inner HOLD preserved');
g = withOrderBookGate(() => ({ signal: {}, decision: { decision: 'DENY', reason: 'x' } }));
assert.strictEqual(g({ feat: featOk }, {}).decision.reason, 'x'); ok('inner DENY preserved');

console.log(`\n${p} checks passed`);
