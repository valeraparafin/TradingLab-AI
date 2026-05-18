/**
 * Base class for exchange services.
 * Defines the abstract interface that all exchange implementations must follow.
 */
export class BaseExchange {
  /**
   * Places a new order on the exchange.
   * @param {string} symbol - The trading pair (e.g., 'BTCUSDT').
   * @param {string} side - 'buy' or 'sell'.
   * @param {number} sizeUSD - The amount to trade in USD.
   * @param {number} price - The price of the asset.
   * @param {string} tradeMode - 'spot' or 'futures'.
   * @returns {Promise<Object>} The order response from the exchange.
   */
  async placeOrder(symbol, side, sizeUSD, price, tradeMode) {
    throw new Error("Method 'placeOrder' must be implemented");
  }

  /**
   * Cancels an existing order.
   * @param {string} orderId - The ID of the order to cancel.
   * @returns {Promise<Object>} The cancellation response.
   */
  async cancelOrder(orderId) {
    throw new Error("Method 'cancelOrder' must be implemented");
  }

  /**
   * Fetches the balance for a specific coin.
   * @param {string} coin - The coin symbol (e.g., 'USDT').
   * @returns {Promise<number>} The balance.
   */
  async getBalance(coin) {
    throw new Error("Method 'getBalance' must be implemented");
  }
}
