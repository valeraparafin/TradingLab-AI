import { SafetyValidator } from '../src/validators/index.js';
import assert from 'assert';

// Regression test for the snake_case/camelCase weight-lookup bug (introduced 85bcf38,
// 2026-05-26). SafetyValidator.run() looks up per-check weights with weights[check.id],
// where check.id is snake_case ("htf_trend_filter"). If the weights map is keyed
// camelCase, the lookup never matches and every configured check silently falls through
// to the default weight (1.0) instead of its intended weight. This asserts a configured
// critical check actually receives its non-default weight, observable via the GCI.
function test() {
  console.log('Running SafetyValidator Weight Tests...');

  const validator = new SafetyValidator();

  // Two checks with known, fixed scores under empty strategyData:
  //   htf_trend_filter  -> score 1.0 (htf_trend undefined => "disabled" pass), weight 2.0
  //   rejection_candle  -> score 0.0 (no rejection in data),  default weight 1.0
  // GCI = sum(score * weight) / sum(weight).
  //   Correct weighting (2.0 + 1.0): (1.0*2.0 + 0.0*1.0) / 3.0 = 0.6667
  //   Buggy uniform weighting (1.0): (1.0*1.0 + 0.0*1.0) / 2.0 = 0.5
  const strategyConfig = {
    logic: {
      safetyChecks: [
        { id: 'htf_trend_filter' },
        { id: 'rejection_candle' },
      ],
    },
  };

  console.log('Test 1: configured critical check receives its non-default weight...');
  const { gci } = validator.run(100, 100, {}, strategyConfig);

  const expected = 2.0 / 3.0;
  assert.ok(
    Math.abs(gci - expected) < 1e-9,
    `GCI should be ${expected.toFixed(4)} (htf_trend_filter weighted 2.0), got ${gci}. ` +
      `A value of 0.5 means the snake_case weight lookup is broken and weights fell back to 1.0.`,
  );
  console.log('✅ Test 1 Passed');

  console.log('\nAll SafetyValidator weight tests passed successfully!');
}

try {
  test();
} catch (err) {
  console.error('❌ Test failed:');
  console.error(err);
  process.exit(1);
}
