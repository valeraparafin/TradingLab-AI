import { Technicals } from './technical.js';
import WaveTrend from './wave-trend.js';
import SMC from './smc.js';
import Breakout from './breakout.js';
import Reversal from './reversal.js';

export class IndicatorManager {
  constructor(config) {
    this.config = config;
  }

  /**
   * Calculate indicators based on the logic type.
   * @param {string} type - The type of indicator logic ('SMC', 'Breakout', 'VMC_CipherB', 'Reversal')
   * @param {Array} candles - The array of candle data
   * @returns {Object} The calculation results
   */
  calculate(type, candles) {
    if (!type) return {};
    const normalizedType = type.toUpperCase();

    switch (normalizedType) {
      case 'SMC':
        return SMC.execute(candles, this.config);
      case 'BREAKOUT':
        return { channel: Breakout.execute(candles, this.config) };
      case 'VMC_CIPHERB':
        return WaveTrend.execute(candles, this.config);
      case 'REVERSAL':
        return Reversal.execute(candles, this.config);
      default:
        throw new Error(`Unsupported indicator type: ${type}`);
    }
  }
}

