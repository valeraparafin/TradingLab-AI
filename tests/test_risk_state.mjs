// tests/test_risk_state.mjs
import assert from 'node:assert';
import { deriveRiskState } from '../src/agents/riskState.js';

const g = { maxPortfolioHeatPct: 0.10, dailyLossLimitPct: 0.05 };

// heat-driven severity (heatFrac / 0.10); values kept off exact FP boundaries
assert.equal(deriveRiskState(0.00, 0, g), 'NORMAL');  // 0 sev
assert.equal(deriveRiskState(0.04, 0, g), 'NORMAL');  // 0.4 sev
assert.equal(deriveRiskState(0.065, 0, g), 'CAUTION'); // 0.65 sev
assert.equal(deriveRiskState(0.095, 0, g), 'PANIC');   // 0.95 sev
assert.equal(deriveRiskState(0.20, 0, g), 'PANIC');    // over limit

// loss-driven severity (|drawdown| / 0.05); profit never escalates
assert.equal(deriveRiskState(0, -0.035, g), 'CAUTION'); // 0.7 sev
assert.equal(deriveRiskState(0, -0.05, g), 'PANIC');    // 1.0 sev
assert.equal(deriveRiskState(0, 0.10, g), 'NORMAL');    // profit = calm

// worst-of the two dimensions wins
assert.equal(deriveRiskState(0.07, -0.01, g), 'CAUTION');

// no limits configured -> never escalates
assert.equal(deriveRiskState(0.99, -0.99, {}), 'NORMAL');

console.log('OK test_risk_state');
