// tests/test_rf_regime_adx.mjs
// Live ADX regime gate as a safety check — the proven core lever, ported from the backtest
// simulator's regimeGate into the live engine. Admits a trade only when decision-bar ADX clears
// the per-strategy threshold (config.logic.indicators.adxMin, default 30). Reads data.adx, which
// the RangeFilter executor now emits. Missing adx (warmup) => N/A pass, mirroring htf_trend_filter.
import assert from 'node:assert';
import { rf_regime_adx } from '../src/validators/safety-rules.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

const cfg = (adxMin) => ({ logic: { indicators: { adxMin } } });

// --- ADX above threshold → pass ---
{
  const res = rf_regime_adx(101, 100, { adx: 35 }, cfg(30));
  assert.strictEqual(res.pass, true, 'adx 35 >= 30 → pass');
  ok('rf_regime_adx passes when ADX clears the threshold');
}

// --- ADX below threshold → fail (the gate prunes low-ADX chop) ---
{
  const res = rf_regime_adx(101, 100, { adx: 22 }, cfg(30));
  assert.strictEqual(res.pass, false, 'adx 22 < 30 → fail');
  ok('rf_regime_adx fails in low-ADX chop');
}

// --- per-strategy threshold is honored (15m uses 40) ---
{
  const res = rf_regime_adx(101, 100, { adx: 35 }, cfg(40));
  assert.strictEqual(res.pass, false, 'adx 35 < 40 → fail with 15m threshold');
  ok('rf_regime_adx honors the configured adxMin (15m=40)');
}

// --- default threshold 30 when unconfigured ---
{
  assert.strictEqual(rf_regime_adx(101, 100, { adx: 31 }, {}).pass, true, 'default 30: 31 → pass');
  assert.strictEqual(rf_regime_adx(101, 100, { adx: 29 }, {}).pass, false, 'default 30: 29 → fail');
  ok('rf_regime_adx defaults to adxMin 30');
}

// --- missing adx (warmup) → N/A pass, does not block ---
{
  const res = rf_regime_adx(101, 100, { adx: null }, cfg(30));
  assert.strictEqual(res.pass, true, 'null adx → N/A pass');
  ok('rf_regime_adx is N/A-pass when ADX is unavailable (warmup)');
}

console.log(`\n${passed} passed`);
