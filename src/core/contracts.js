/**
 * Core decision contracts (the "narrow waist"). JSDoc-only types + the SIDE enum.
 *
 * @typedef {Object} Candle
 * @property {number} time
 * @property {number} open
 * @property {number} high
 * @property {number} low
 * @property {number} close
 * @property {number} volume
 *
 * @typedef {Object} StrategyContext
 * @property {Candle[]} candles
 * @property {{logicType: string, logic?: object}} config
 * @property {string} symbol
 * @property {string} timeframe
 *
 * @typedef {Object} Signal
 * @property {'BUY'|'SELL'|'HOLD'} side
 * @property {number} conviction - 0..1
 * @property {string} reason
 * @property {number|null} [invalidation] - price level that invalidates the idea
 *
 * @typedef {Object} AccountState
 * @property {number} entryPrice
 * @property {number} [openPositions]
 * @property {number} [portfolioHeatPct]
 * @property {number} [dailyPnlPct]
 * @property {number} [tradesToday]
 * @property {number} [freeEquity] - free equity available for margin (futures)
 *
 * @typedef {Object} Order
 * @property {'BUY'|'SELL'} side
 * @property {number} sizeUSD - position notional in USD
 * @property {number} entryPrice
 * @property {number|null} slPrice
 * @property {number|null} tpPrice
 * @property {number} [marginUSD] - reserved margin (futures only; sizeUSD/leverage)
 * @property {number} [leverage] - position leverage (futures only)
 *
 * @typedef {Object} Decision
 * @property {'PERMIT'|'DENY'} decision
 * @property {string} [reason]
 * @property {string} [warning] - non-blocking advisory (e.g. SL beyond liquidation)
 * @property {Order} [order]
 */

export const SIDE = Object.freeze({ BUY: 'BUY', SELL: 'SELL', HOLD: 'HOLD' });
