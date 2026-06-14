// src/marketdata/orderbook/levels.js
const rangeOf = (arr) => Math.max(...arr.map((c) => c.high)) - Math.min(...arr.map((c) => c.low));

/**
 * Candle-defined breakout level: resistance/support over the prior `lookback` bars
 * (current bar excluded) and whether the range has coiled (pinch). The order book
 * confirms the *break*; candles only define the level. Mirrors src/indicators/scalpBreakout.js.
 * @param {{high:number,low:number}[]} candles
 * @param {{lookback?:number, pinchBars?:number, pinchRatio?:number}} [opts]
 * @returns {{resistance:number|null, support:number|null, coiled:boolean}}
 */
export function levelFromCandles(candles, { lookback = 20, pinchBars = 6, pinchRatio = 0.7 } = {}) {
  if (!candles || candles.length < lookback + 1) {
    return { resistance: null, support: null, coiled: false };
  }
  const prior = candles.slice(candles.length - lookback - 1, candles.length - 1); // lookback bars, excl current
  const resistance = Math.max(...prior.map((c) => c.high));
  const support = Math.min(...prior.map((c) => c.low));
  const recent = prior.slice(-pinchBars);
  const earlier = prior.slice(-2 * pinchBars, -pinchBars);
  const coiled = earlier.length === 0 ? true : rangeOf(recent) <= pinchRatio * rangeOf(earlier);
  return { resistance, support, coiled };
}
