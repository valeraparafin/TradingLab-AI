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

    const weights = {
      // Critical Rules
      confirmationBreak: 2.0,
      structureShift: 2.0,
      trendFilter: 2.0,
      obEntry: 2.0,
      // Support Rules
      wtOversold: 0.5,
      wtOverbought: 0.5,
      mfiBullish: 0.5,
      mfiBearish: 0.5,
      stochRsiOversold: 0.5,
      stcBullish: 0.5,
      zoneFilter: 0.5,
      unhealthyMove: 0.5,
      momentumShift: 1.5,
    };

    let totalWeightedScore = 0;
    let totalWeight = 0;

    for (const check of safetyChecks) {
      const validator = rules[check.id === "momentum_shift" ? "momentum_shift" : check.id];
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
