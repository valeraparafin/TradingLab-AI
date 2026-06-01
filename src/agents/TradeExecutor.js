import { BitGetService } from '../services/exchange/bitget.js';
import { getDB } from '../../db.js';

/**
 * TradeExecutor is responsible for the final execution of trades.
 * It handles the distinction between PAPER and REAL trading modes.
 */
export class TradeExecutor {
  /**
   * @param {Object} config - Application configuration.
   * @param {Object} config.bitget - BitGet API credentials.
   * @param {string} config.tradeMode - 'PAPER' or 'REAL' (should be mapped from process.env.TRADE_MODE)
   */
  constructor(config) {
    this.tradeMode = config.tradeMode || 'PAPER';
    this.agentId = config.agentId ?? null;
    this.bitgetService = new BitGetService(config.bitget);
  }

  /**
   * Executes a trade based on the current mode.
   *
   * @param {Object} tradeDetails - Details of the trade to execute.
   * @param {string} tradeDetails.symbol - Trading pair (e.g., 'BTCUSDT').
   * @param {string} tradeDetails.side - 'buy' or 'sell'.
   * @param {number} tradeDetails.sizeUSD - Amount in USD to trade.
   * @param {number} tradeDetails.price - Current execution price.
   * @param {string} tradeDetails.marketType - 'spot' or 'futures'.
   * @param {number} tradeDetails.strategyId - ID of the strategy triggering the trade.
   * @returns {Promise<Object>} Result of the execution.
   */
  async executeTrade(tradeDetails) {
    const { symbol, side, sizeUSD, price, marketType } = tradeDetails;

    if (this.tradeMode === 'REAL') {
      return await this._executeReal(symbol, side, sizeUSD, price, marketType);
    }
    return await this._executePaper(symbol, side, sizeUSD, price, this.agentId);
  }

  /**
   * Internal method to handle REAL execution via BitGetService.
   */
  async _executeReal(symbol, side, sizeUSD, price, marketType) {
    console.log(`[TradeExecutor] Executing REAL trade: ${side} ${symbol} @ ${price} ($${sizeUSD})`);
    try {
      const result = await this.bitgetService.placeOrder(symbol, side, sizeUSD, price, marketType);
      return {
        success: true,
        mode: 'REAL',
        orderId: result.orderId || result.id,
        data: result
      };
    } catch (error) {
      console.error(`[TradeExecutor] REAL trade failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Internal method to handle PAPER execution simulation.
   */
  async _executePaper(symbol, side, sizeUSD, price, agentId) {
    console.log(`[TradeExecutor] PAPER ${side} ${symbol} @ ${price} ($${sizeUSD}) agent=${agentId}`);
    const slippage = 1 + (Math.random() * 0.001 - 0.0005);
    const executedPrice = side.toLowerCase() === 'buy' ? price * slippage : price / slippage;
    const result = {
      symbol, side, price: executedPrice, size_usd: sizeUSD, strategy_id: agentId,
      status: 'EXECUTED', timestamp: new Date().toISOString(), mode: 'PAPER',
    };
    try {
      const db = getDB('ai'); // AI contour DB — NOT the manual paper_trades
      await db.run(
        `INSERT INTO ai_paper_trades (strategy_id, symbol, side, price, size_usd, status, timestamp, mode)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [result.strategy_id, result.symbol, result.side, result.price, result.size_usd, result.status, result.timestamp, result.mode]
      );
      return { success: true, mode: 'PAPER', executedPrice, slippage: (slippage - 1) * 100, data: result };
    } catch (error) {
      console.error(`[TradeExecutor] PAPER recording failed: ${error.message}`);
      throw error;
    }
  }
}
