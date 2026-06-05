import assert from 'assert';
import SMC from '../src/indicators/smc.js';
import { toCamel } from '../src/utils/casing.js';

/**
 * Proves that SMC reads its pivot length from the strategy template
 * (config.indicators.pivot_length) instead of silently running on the
 * hardcoded default of 50.
 *
 * Data-flow reminder: logic templates store snake_case keys under
 * `indicators` (e.g. pivot_length). At runtime, resolveConfig() deep-converts
 * them to camelCase via toCamel() before the config reaches IndicatorManager
 * (bot_engine.js / src/core/pipeline.js build `new IndicatorManager(toCamel(
 * logicTemplate))`). So the live config carries `indicators.pivotLength`.
 *
 * The bug masked here: templates/logic/smc_pro.json sets pivot_length: 20, but
 * because smc.js only read the snake_case key it never saw the resolved
 * camelCase value and always fell back to 50. smc.json's pivot_length: 50
 * coincidentally matched the default, hiding the bug.
 */

const tests = [];
const add = (name, fn) => tests.push({ name, fn });

// Deterministic candles (no Math.random) so output is reproducible.
// A steady uptrend with periodic bumps: with pivot_length 20 the most recent
// swing high is broken (bullish BOS), but with the default 50 no recent pivot
// qualifies, so the structure is empty. This makes the pivot length observable
// through execute()'s output.
function makeCandles(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const base = 100 + i * 0.25 + Math.sin(i / 13) * 8;
    out.push({
      open: base - 1,
      high: base + 2,
      low: base - 2,
      close: base,
      volume: 1000 + (i % 13) * 40,
    });
  }
  return out;
}

const candles = makeCandles(250);

// The real scalping template body (templates/logic/smc_pro.json).
const SMC_PRO_INDICATORS = { pivot_length: 20 };

// Compact, comparable view of the structural part of SMC output.
const shape = (o) => JSON.stringify(o.structure) + JSON.stringify(o.obs);

add('non-default template pivot_length changes SMC output', () => {
  // Simulate the live pipeline: template -> resolveConfig/toCamel -> indicators.
  const resolved = toCamel({ indicators: SMC_PRO_INDICATORS });

  const def = SMC.execute(candles, {});
  const custom = SMC.execute(candles, resolved);

  assert.notStrictEqual(
    shape(custom),
    shape(def),
    `expected resolved pivot_length=20 to change structure, but both were ${shape(def)}`
  );
});

add('pivot_length maps to pivotLength (resolved camelCase == raw snake)', () => {
  // The camelCase form produced by resolveConfig must drive the same
  // calculation as the raw snake_case template body.
  const resolved = SMC.execute(candles, toCamel({ indicators: SMC_PRO_INDICATORS }));
  const rawSnake = SMC.execute(candles, { indicators: SMC_PRO_INDICATORS });

  assert.deepStrictEqual(resolved, rawSnake);
});

add('snake_case indicators are accepted even without resolveConfig', () => {
  // A caller may build IndicatorManager from a raw (un-resolved) template.
  const rawSnake = SMC.execute(candles, { indicators: SMC_PRO_INDICATORS });
  const def = SMC.execute(candles, {});

  assert.notStrictEqual(
    shape(rawSnake),
    shape(def),
    'raw snake_case pivot_length should still change output'
  );
});

add('default pivot_length (50) is used when no param is supplied', () => {
  // Empty config and an explicit pivotLength: 50 must be identical.
  const empty = SMC.execute(candles, {});
  const explicit50 = SMC.execute(candles, { indicators: { pivotLength: 50 } });

  assert.deepStrictEqual(empty, explicit50);
});

// ===== runner =====
let failed = 0;
for (const t of tests) {
  try { t.fn(); console.log(`PASS ${t.name}`); }
  catch (e) { failed++; console.error(`FAIL ${t.name}\n   ${e.message}`); }
}
if (failed) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
console.log('\nAll SMC param tests passed!');
