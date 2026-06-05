import assert from 'assert';
import WaveTrend from '../src/indicators/wave-trend.js';
import { toCamel } from '../src/utils/casing.js';

/**
 * Proves that WaveTrend reads its channel/average lengths from the strategy
 * template (config.indicators.*) instead of silently running on hardcoded
 * defaults.
 *
 * Data-flow reminder: logic templates store snake_case keys under
 * `indicators` (e.g. channel_length / average_length). At runtime,
 * resolveConfig() deep-converts them to camelCase via toCamel() before the
 * config reaches IndicatorManager. So the live config carries
 * `indicators.channelLength` / `indicators.averageLength`.
 *
 * VMC Cipher B (VuManChu / LazyBear) reference:
 *   n1 = "Channel Length"  -> esa/d EMA period  -> wave-trend.js wtLen
 *   n2 = "Average Length"  -> tci (wt1) EMA period -> wave-trend.js wtAvg
 */

const tests = [];
const add = (name, fn) => tests.push({ name, fn });

// Deterministic candles (no Math.random) so output is reproducible.
function makeCandles(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const base = 100 + Math.sin(i / 7) * 12 + Math.cos(i / 3) * 4 + i * 0.03;
    out.push({
      open: base - 1,
      high: base + 3,
      low: base - 3,
      close: base + Math.sin(i / 2) * 1.5,
      volume: 1000 + (i % 13) * 40,
    });
  }
  return out;
}

const candles = makeCandles(250);

// The real web template body (templates/logic/vmc_cipher_web.json).
const WEB_TEMPLATE_INDICATORS = { channel_length: 20, average_length: 9 };

add('non-default template params change WaveTrend output', () => {
  // Simulate the live pipeline: template -> resolveConfig/toCamel -> indicators.
  const resolved = toCamel({ indicators: WEB_TEMPLATE_INDICATORS });

  const def = WaveTrend.execute(candles, {});
  const custom = WaveTrend.execute(candles, resolved);

  assert.ok(
    Math.abs(custom.wt.wt1 - def.wt.wt1) > 1e-6,
    `expected template params to change wt1, but both were ${def.wt.wt1}`
  );
});

add('channel_length maps to wtLen, average_length maps to wtAvg', () => {
  // camelCase (post-resolveConfig) descriptive names must be equivalent to the
  // legacy short keys used by the older VMC templates.
  const fromTemplate = WaveTrend.execute(
    candles,
    toCamel({ indicators: WEB_TEMPLATE_INDICATORS })
  );
  const fromLegacy = WaveTrend.execute(candles, {
    indicators: { wtLen: 20, wtAvg: 9 },
  });

  assert.deepStrictEqual(fromTemplate, fromLegacy);
});

add('snake_case indicators are accepted even without resolveConfig', () => {
  // A caller may build IndicatorManager from a raw (un-resolved) template.
  const rawSnake = WaveTrend.execute(candles, {
    indicators: WEB_TEMPLATE_INDICATORS,
  });
  const camel = WaveTrend.execute(
    candles,
    toCamel({ indicators: WEB_TEMPLATE_INDICATORS })
  );

  assert.deepStrictEqual(rawSnake, camel);
});

add('legacy short-key templates still drive the calculation', () => {
  const def = WaveTrend.execute(candles, {});
  const legacy = WaveTrend.execute(candles, {
    indicators: { wtLen: 5, wtAvg: 5 },
  });

  assert.ok(
    Math.abs(legacy.wt.wt1 - def.wt.wt1) > 1e-6,
    'legacy wtLen/wtAvg under indicators should still change output'
  );
});

// ===== runner =====
let failed = 0;
for (const t of tests) {
  try { t.fn(); console.log(`PASS ${t.name}`); }
  catch (e) { failed++; console.error(`FAIL ${t.name}\n   ${e.message}`); }
}
if (failed) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
console.log('\nAll WaveTrend param tests passed!');
