import assert from 'assert';
import { evaluateBar } from '../src/core/pipeline.js';

console.log('Running pipeline tests...');

// 5 candles is far below SMC's pivot window → no structure → trend 0 → HOLD → DENY.
const candles = [];
for (let i = 0; i < 5; i++) {
  candles.push({ time: i, open: 100, high: 101, low: 99, close: 100, volume: 10 });
}
const ctx = { symbol: 'BTCUSDT', timeframe: '1h', config: { logicType: 'SMC', logic: {} }, candles };

const result = evaluateBar(ctx, { guardrails: {}, portfolio: {} });

assert.ok('signal' in result && 'decision' in result, 'returns {signal, decision}');
assert.strictEqual(result.signal.side, 'HOLD', 'flat market → HOLD');
assert.strictEqual(result.decision.decision, 'DENY', 'HOLD signal is denied by RiskPolicy');

console.log('✅ pipeline tests passed');
