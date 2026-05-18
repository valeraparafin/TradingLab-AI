const Technicals = require('./technical');
const WaveTrend = require('./wave-trend');
const SMC = require('./smc');
const Breakout = require('./breakout');

class IndicatorManager {
  constructor(config) {
    this.config = config;
  }

  /**
   * Calculate indicators based on the logic type.
   * @param {string} type - The type of indicator logic ('SMC', 'Breakout', 'VMC_CipherB')
   * @param {Array} candles - The array of candle data
   * @returns {Object} The calculation results
   */
  calculate(type, candles) {
    switch (type) {
      case 'SMC':
        return SMC.execute(candles, this.config);
      case 'Breakout':
        return Breakout.execute(candles, this.config);
      case 'VMC_CipherB':
        return WaveTrend.execute(candles, this.config);
      default:
        throw new Error(`Unsupported indicator type: ${type}`);
    }
  }
}

module.exports = { IndicatorManager };
