// tests/test_ob_guardrails.mjs
import assert from 'node:assert';
import { applyOrderBookGuardrails } from '../src/agents/obGuardrails.js';

let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

const base = { riskPerTrade: 0.01, stopLossPct: 0.02, takeProfitPct: 0.04, minRiskRewardRatio: 1.5, portfolioValue: 200 };
const g = applyOrderBookGuardrails(base);
assert.equal(g.stopMode, 'structural'); ok('stopMode structural');
assert.equal(g.minRiskRewardRatio, 0); ok('R:R gate disabled');
assert.equal(g.structuralRR, 2); ok('structuralRR default 2');
assert.equal(g.riskPerTrade, 0.01); ok('preserves sizing');
assert.equal(g.portfolioValue, 200); ok('preserves portfolioValue');
// Does not mutate the input.
assert.equal(base.stopMode, undefined); ok('pure — input untouched');
// Honors an explicit structuralRR override.
assert.equal(applyOrderBookGuardrails(base, { structuralRR: 3 }).structuralRR, 3); ok('structuralRR override');

console.log(`\n${p} checks passed`);
