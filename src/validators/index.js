import * as rules from './safety-rules.js';

export class SafetyValidator {
  /**
   * Runs all safety checks defined in the strategy configuration.
   *
   * @param {number} price - Current market price
   * @param {number} open - Current candle open price
   * @param {Object} strategyData - Data produced by logic executors
   * @param {Object} strategyConfig - Full strategy configuration
   * @returns {Object} { results: Array, allPass: boolean }
   */
  run(price, open, strategyData, strategyConfig) {
    const results = [];
    const safetyChecks = strategyConfig.logic?.safety_checks;

    if (!safetyChecks || !Array.isArray(safetyChecks)) {
      return { results, allPass: false };
    }

    for (const check of safetyChecks) {
      const validator = rules[check.id];
      if (validator) {
        const result = validator(price, open, strategyData, strategyConfig);
        results.push(result);
      } else {
        console.warn(`[SafetyValidator] No validator found for rule ID: ${check.id}`);
      }
    }

    const allPass = results.length > 0 && results.every((r) => r.pass);
    return { results, allPass };
  }
}
