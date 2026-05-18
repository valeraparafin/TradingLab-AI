import crypto from "crypto";
import { BaseExchange } from "./base-exchange.js";

/**
 * BitGet exchange service implementation.
 */
export class BitGetService extends BaseExchange {
  /**
   * @param {Object} config - Exchange configuration.
   * @param {string} config.apiKey - API Key.
   * @param {string} config.secretKey - Secret Key.
   * @param {string} config.passphrase - Passphrase.
   * @param {string} config.baseUrl - Base URL of the API.
   */
  constructor(config) {
    super();
    this.apiKey = config.apiKey;
    this.secretKey = config.secretKey;
    this.passphrase = config.passphrase;
    this.baseUrl = config.baseUrl;
  }

  /**
   * Internal helper to sign requests.
   */
  _sign(timestamp, method, path, body = "") {
    const message = `${timestamp}${method}${path}${body}`;
    return crypto
      .createHmac("sha256", this.secretKey)
      .update(message)
      .digest("base64");
  }

  /**
   * Places a market order on BitGet.
   */
  async placeOrder(symbol, side, sizeUSD, price, tradeMode) {
    const quantity = (sizeUSD / price).toFixed(6);
    const timestamp = Date.now().toString();
    const path =
      tradeMode === "spot"
        ? "/api/v2/spot/trade/placeOrder"
        : "/api/v2/mix/order/placeOrder";

    const bodyObj = {
      symbol,
      side,
      orderType: "market",
      quantity,
      ...(tradeMode === "futures" && {
        productType: "USDT-FUTURES",
        marginMode: "isolated",
        marginCoin: "USDT",
      }),
    };

    const body = JSON.stringify(bodyObj);
    const signature = this._sign(timestamp, "POST", path, body);

    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ACCESS-KEY": this.apiKey,
        "ACCESS-SIGN": signature,
        "ACCESS-TIMESTAMP": timestamp,
        "ACCESS-PASSPHRASE": this.passphrase,
      },
      body,
    });

    const data = await res.json();
    if (data.code !== "00000") {
      throw new Error(`BitGet order failed: ${data.msg}`);
    }
    return data.data;
  }

  async cancelOrder(orderId) {
    throw new Error("Method 'cancelOrder' is not yet implemented for BitGet");
  }

  async getBalance(coin) {
    throw new Error("Method 'getBalance' is not yet implemented for BitGet");
  }
}
