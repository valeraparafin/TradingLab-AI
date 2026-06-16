import { Technicals } from './technical.js';
import WaveTrend from './wave-trend.js';
import SMC from './smc.js';
import Breakout from './breakout.js';
import Reversal from './reversal.js';
import TrendPullback from './trendPullback.js';
import DonchianTrend from './donchianTrend.js';
import ScalpBreakout from './scalpBreakout.js';
import { marketDataService } from '../services/market-data.service.js';

export class IndicatorManager {
  constructor(config) {
    this.config = config;
  }

  /**
   * Calculate indicators based on the logic type.
   * @param {string} type - The type of indicator logic ('SMC', 'Breakout', 'VMC_CipherB', 'Reversal')
   * @param {Array} candles - The array of candle data
   * @param {string} symbol - The asset symbol (e.g., "BTCUSDT")
   * @param {Object} strategyConfig - Full strategy configuration for HTF lookups
   * @returns {Promise<Object>} The calculation results
   */
  async calculate(type, candles, symbol, strategyConfig = {}) {
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

    // HTF Bias Integration: If the strategy has an HTF timeframe defined,
    // fetch its data and calculate the HTF trend.
    const htfTf = strategyConfig.htf_timeframe || strategyConfig.htfTimeframe;
    if (htfTf && symbol) {
      try {
        const htfCandles = await marketDataService.fetchCandles(symbol, htfTf, 500);
        if (normalizedType === 'SMC') {
          // Reuse SMC's structural analysis for the HTF trend
          const htfSMC = SMC.execute(htfCandles, this.config);
          results.htf_trend = htfSMC.structure.trend;
        } else {
          // For other logic types, we could implement specific HTF logic.
          // Defaulting to null if not SMC.
          results.htf_trend = null;
        }
      } catch (error) {
        console.error(`[IndicatorManager] HTF Fetch Error for ${symbol} (${htfTf}): ${error.message}`);
        results.htf_trend = 0; // Neutral on error
      }
    }

    return results;
  }
}

