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
    const safetyChecks = strategyConfig.logic?.safety_checks;

    if (!safetyChecks || !Array.isArray(safetyChecks)) {
      return { results, allPass: false, gci: 0 };
    }

    const weights = {
      // Critical Rules
      confirmation_break: 2.0,
      structure_shift: 2.0,
      trend_filter: 2.0,
      // Support Rules
      wt_oversold: 0.5,
      wt_overbought: 0.5,
      mfi_bullish: 0.5,
      mfi_bearish: 0.5,
      stoch_rsi_oversold: 0.5,
      stc_bullish: 0.5,
      zone_filter: 0.5,
      unhealthy_move: 0.5,
    };

    let totalWeightedScore = 0;
    let totalWeight = 0;

    for (const check of safetyChecks) {
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
