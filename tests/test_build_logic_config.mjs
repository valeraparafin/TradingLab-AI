// tests/test_build_logic_config.mjs
import assert from 'node:assert';
import { buildLogicConfig } from '../backtest/run-backtest.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

// --- no indicator flags → empty object (other logics keep their defaults) ---
{
  assert.deepStrictEqual(buildLogicConfig({ symbol: 'BTCUSDT' }), {}, 'no flags → {}');
  ok('no flags → {}');
}

// --- known flags land under .indicators as numbers ---
{
  const cfg = buildLogicConfig({ adxMin: '25', htfRatio: '4', rsiPullback: '40' });
  assert.deepStrictEqual(cfg, { indicators: { adxMin: 25, htfRatio: 4, rsiPullback: 40 } }, 'flags → numeric indicators');
  ok('known flags → numeric indicators');
}

// --- unknown flags are ignored ---
{
  const cfg = buildLogicConfig({ adxMin: '20', leverage: '10', tf: '1H' });
  assert.deepStrictEqual(cfg, { indicators: { adxMin: 20 } }, 'only indicator keys kept');
  ok('unknown flags ignored');
}

// --- Donchian: entryLookback threads into indicators ---
{
  const cfg = buildLogicConfig({ entryLookback: 55 });
  assert.strictEqual(cfg.indicators.entryLookback, 55, 'entryLookback threaded as Number');
  ok('buildLogicConfig threads Donchian entryLookback');
}

console.log(`\n${passed} checks passed`);
