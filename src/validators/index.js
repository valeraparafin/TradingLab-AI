import * as rules from './safety-rules.js';

export class SafetyValidator {
  /**
   * Runs all safety checks defined in the strategy configuration.
   *
   * @param {number} price - Current market price
   * @param {number} open - Current candle open price
   * @param {Object} strategyData - Data produced by logic executors
   * @param {Object} strategyConfig - Full strategy configuration
   * @returns {Object} { results: Array, allPass: boolean, gci: number }
   */
  run(price, open, strategyData, strategyConfig) {
    const results = [];
    const safetyChecks = strategyConfig.logic?.safetyChecks;

    if (!safetyChecks || !Array.isArray(safetyChecks)) {
      return { results, allPass: false, gci: 0 };
    }

    // Keyed by snake_case check.id to match the safety-rules export names and the
    // ids stored in strategyConfig.logic.safetyChecks. (Previously camelCase, which
    // never matched check.id, so every check silently fell back to the 1.0 default.)
    const weights = {
      // Critical Rules
      confirmation_break: 2.0,
      structure_shift: 2.0,
      trend_filter: 2.0,
      htf_trend_filter: 2.0,
      rf_trend_align: 2.0,
      confirmation_choch: 2.0,
      ob_entry: 2.0,
      // Support Rules
      wt_oversold: 0.5,
      wt_overbought: 0.5,
      mfi_bullish: 0.5,
      mfi_bearish: 0.5,
      stoch_rsi_oversold: 0.5,
      stc_bullish: 0.5,
      zone_filter: 0.5,
      unhealthy_move: 0.5,
      momentum_shift: 1.5,
    };

    let totalWeightedScore = 0;
    let totalWeight = 0;

    for (const check of safetyChecks) {
      // Validators in safety-rules.js are exported under the same snake_case ids
      // stored in safetyChecks, so check.id keys both the validator and weight maps.
      const validator = rules[check.id];
      if (validator) {
        const result = validator(price, open, strategyData, strategyConfig);
        results.push(result);

        const weight = weights[check.id] || 1.0;
        totalWeightedScore += result.score * weight;
        totalWeight += weight;
      } else {
        console.warn(`[SafetyValidator] No validator found for rule ID: ${check.id}`);
      }
    }

    const allPass = results.length > 0 && results.every((r) => r.pass);
    const gci = totalWeight > 0 ? totalWeightedScore / totalWeight : 0;

    return { results, allPass, gci };
  }
}
