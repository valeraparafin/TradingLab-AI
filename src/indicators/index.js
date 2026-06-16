import { Technicals } from './technical.js';
import WaveTrend from './wave-trend.js';
import SMC from './smc.js';
import Breakout from './breakout.js';
import Reversal from './reversal.js';
import TrendPullback from './trendPullback.js';
import DonchianTrend from './donchianTrend.js';
import ScalpBreakout from './scalpBreakout.js';

export class IndicatorManager {
  constructor(config) {
    this.config = config;
  }

  /**
   * Calculate indicators for the given logic type. Pure & synchronous: any I/O
   * (e.g. fetching higher-timeframe candles) is the caller's responsibility and
   * passed in via opts.htfCandles.
   * @param {string} type - The type of indicator logic ('SMC', 'Breakout', 'VMC_CipherB', 'Reversal')
   * @param {Array} candles - The array of candle data
   * @param {{ htfCandles?: Array }} [opts]
   * @returns {Object} The calculation results
   */
  calculate(type, candles, opts = {}) {
    if (!type) return {};
    const normalizedType = type.toUpperCase();

    let results = {};
    switch (normalizedType) {
      case 'SMC':
        results = SMC.execute(candles, this.config);
        break;
      case 'BREAKOUT':
        results = { channel: Breakout.execute(candles, this.config) };
        break;
      case 'VMC_CIPHERB':
        results = WaveTrend.execute(candles, this.config);
        break;
      case 'REVERSAL':
        results = Reversal.execute(candles, this.config);
        break;
      case 'TRENDPULLBACK':
        results = TrendPullback.execute(candles, this.config);
        break;
      case 'DONCHIANTREND':
        results = DonchianTrend.execute(candles, this.config);
        break;
      case 'SCALPBREAKOUT':
        results = ScalpBreakout.execute(candles, this.config);
        break;
      default:
        throw new Error(`Unsupported indicator type: ${type}`);
    }

    // HTF bias: caller passes higher-timeframe candles; we derive the trend here
    // synchronously (SMC structural trend). No I/O in this method.
    if (Array.isArray(opts.htfCandles) && opts.htfCandles.length > 0) {
      if (normalizedType === 'SMC') {
        const htfSMC = SMC.execute(opts.htfCandles, this.config);
        results.htf_trend = htfSMC.structure.trend;
      } else {
        results.htf_trend = null;
      }
    }

    return results;
  }
}

