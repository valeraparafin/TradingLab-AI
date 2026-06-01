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
    const { symbol, side, sizeUSD, price, marketType, strategyId } = tradeDetails;

    if (this.tradeMode === 'REAL') {
      return await this._executeReal(symbol, side, sizeUSD, price, marketType);
    } else {
      return await this._executePaper(symbol, side, sizeUSD, price, marketType, strategyId);
    }
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
 idea internal method to handle PAPER execution simulation.
   */
  async _executePaper(symbol, side, sizeUSD, price, marketType, strategyId) {
    console.log(`[TradeExecutor] Simulating PAPER trade: ${side} ${symbol} @ ${price} ($${sizeUSD})`);

    // 1. Simulate random slippage (between -0.05% and 0.05%)
    const slippage = 1 + (Math.random() * 0.001 - 0.0005);
    const executedPrice = side.toLowerCase() === 'buy'
      ? price * slippage
      : price / slippage;

    const result = {
      symbol,
      side,
      price: executedPrice,
      size_usd: sizeUSD,
      strategy_id: strategyId,
      status: 'EXECUTED',
      timestamp: new Date().toISOString(),
      mode: 'PAPER'
    };

    // 2. Record to paper_trades table in DB
    try {
      const db = getDB();

      // Ensure paper_trades table exists (simplified approach for this implementation)
      await db.exec(`
        CREATE TABLE IF NOT EXISTS paper_trades (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          strategy_id INTEGER,
          symbol TEXT,
          side TEXT,
          price REAL,
          size_usd REAL,
          status TEXT,
          timestamp DATETIME,
          mode TEXT
        )
      `);

      await db.run(
        `INSERT INTO paper_trades (strategy_id, symbol, side, price, size_usd, status, timestamp, mode)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [result.strategy_id, result.symbol, result.side, result.price, result.size_usd, result.status, result.timestamp, result.mode]
      );

      return {
        success: true,
        mode: 'PAPER',
        executedPrice,
        slippage: (slippage - 1) * 100,
        data: result
      };
    } catch (error) {
      console.error(`[TradeExecutor] PAPER trade recording failed: ${error.message}`);
      throw error;
    }
  }
}

export const tradeExecutor = new TradeExecutor({});
