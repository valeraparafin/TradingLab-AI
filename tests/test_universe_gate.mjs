// tests/test_universe_gate.mjs
import assert from 'node:assert';
import { withUniverseGate } from '../src/backtest/universeGate.js';
let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

const D = Date.UTC(2025, 0, 2, 12, 0); // 2025-01-02
const permit = () => ({ signal: { side: 'BUY' }, decision: { decision: 'PERMIT', order: { side: 'BUY' } } });
const ctx = { candles: [{ time: D }] };
const picks = { '2025-01-02': ['SEL'] };

let g = withUniverseGate(permit, picks, 'SEL');
assert.strictEqual(g(ctx, {}).decision.decision, 'PERMIT', 'selected symbol passes'); ok('selected → PERMIT');

g = withUniverseGate(permit, picks, 'OTHER');
assert.strictEqual(g(ctx, {}).decision.decision, 'DENY', 'unselected symbol vetoed'); ok('unselected → DENY');

// inner DENY passes through untouched
const deny = () => ({ signal: {}, decision: { decision: 'DENY', reason: 'x' } });
g = withUniverseGate(deny, picks, 'SEL');
assert.strictEqual(g(ctx, {}).decision.decision, 'DENY', 'inner DENY preserved'); ok('inner DENY preserved');

console.log(`\n${p} checks passed`);
