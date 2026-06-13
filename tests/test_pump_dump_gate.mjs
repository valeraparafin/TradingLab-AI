// tests/test_pump_dump_gate.mjs
import assert from 'node:assert';
import { withPumpDumpGate } from '../src/backtest/pumpDumpGate.js';
let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

const bar = (h, l, c) => ({ time: 0, open: (h + l) / 2, high: h, low: l, close: c, volume: 1 });
// eligible window (pumped to 200 then pulled back to 160), pumpWindow 10
const eligible = [
  bar(101, 99, 100), bar(102, 99, 101), bar(101, 99, 100), bar(103, 100, 102),
  bar(140, 110, 138), bar(180, 140, 178), bar(200, 175, 198),
  bar(190, 175, 185), bar(180, 165, 172), bar(170, 158, 160),
];
const flat = Array.from({ length: 10 }, () => bar(101, 99, 100));
const opts = { pumpWindow: 10, pumpPct: 0.5, dumpPct: 0.15 };

const sell = () => ({ signal: { side: 'SELL' }, decision: { decision: 'PERMIT', order: { side: 'SELL' } } });
const buy  = () => ({ signal: { side: 'BUY'  }, decision: { decision: 'PERMIT', order: { side: 'BUY'  } } });

let g = withPumpDumpGate(sell, opts);
assert.strictEqual(g({ candles: eligible }, {}).decision.decision, 'PERMIT', 'SELL + eligible passes'); ok('SELL+eligible → PERMIT');

g = withPumpDumpGate(buy, opts);
assert.strictEqual(g({ candles: eligible }, {}).decision.decision, 'DENY', 'BUY vetoed (short only)'); ok('BUY → DENY');

g = withPumpDumpGate(sell, opts);
assert.strictEqual(g({ candles: flat }, {}).decision.decision, 'DENY', 'SELL but not post-pump-dump vetoed'); ok('SELL+ineligible → DENY');

// inner DENY passes through
const deny = () => ({ signal: {}, decision: { decision: 'DENY', reason: 'x' } });
g = withPumpDumpGate(deny, opts);
assert.strictEqual(g({ candles: eligible }, {}).decision.decision, 'DENY', 'inner DENY preserved'); ok('inner DENY preserved');

console.log(`\n${p} checks passed`);
