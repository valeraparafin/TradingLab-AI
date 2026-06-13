const BINANCE_BASE = 'https://api.binance.com';
const BINANCE_FUTURES_BASE = 'https://fapi.binance.com';
const BITGET_BASE = 'https://api.bitget.com';
const PRODUCT = 'USDT-FUTURES';

/** Internal timeframe → milliseconds. */
export const TF_MS = Object.freeze({
  '1m': 60000, '5m': 300000, '15m': 900000, '30m': 1800000,
  '1H': 3600000, '4H': 14400000, '1D': 86400000, '1W': 604800000,
});

/** Internal timeframe → Binance `interval` string (Binance is lowercase). */
export const BINANCE_INTERVAL = Object.freeze({
  '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m',
  '1H': '1h', '4H': '4h', '1D': '1d', '1W': '1w',
});

// ---- Binance candles ----

/** Binance kline array [openTime,o,h,l,c,volume,closeTime,...] → numeric Candle. */
export function parseCandle(arr) {
  return {
    time: Number(arr[0]),
    open: Number(arr[1]),
    high: Number(arr[2]),
    low: Number(arr[3]),
    close: Number(arr[4]),
    volume: Number(arr[5]),
  };
}

export function candlesUrl({ symbol, timeframe, limit = 1000, startTime, endTime, market = 'spot' }) {
  const interval = BINANCE_INTERVAL[timeframe];
  if (!interval) throw new Error(`Unknown timeframe: ${timeframe}`);
  const p = new URLSearchParams({ symbol, interval, limit: String(limit) });
  if (startTime != null) p.set('startTime', String(startTime));
  if (endTime != null) p.set('endTime', String(endTime));
  return market === 'futures'
    ? `${BINANCE_FUTURES_BASE}/fapi/v1/klines?${p.toString()}`
    : `${BINANCE_BASE}/api/v3/klines?${p.toString()}`;
}

// ---- BitGet funding + contracts ----

/** BitGet funding row {fundingTime, fundingRate} → {time, rate}. */
export function parseFunding(obj) {
  return { time: Number(obj.fundingTime), rate: Number(obj.fundingRate) };
}

/**
 * BitGet contract object → contract_specs row. `mmr` is injected (not in the API).
 * tick_size = priceEndStep * 10^-pricePlace.
 */
export function parseContract(obj, mmr) {
  const pricePlace = Number(obj.pricePlace);
  return {
    symbol: obj.symbol,
    mmr,
    max_leverage: Number(obj.maxLever),
    min_leverage: Number(obj.minLever),
    taker_fee: Number(obj.takerFeeRate),
    maker_fee: Number(obj.makerFeeRate),
    fund_interval_h: Number(obj.fundInterval),
    tick_size: Number(obj.priceEndStep) * Math.pow(10, -pricePlace),
    qty_step: Number(obj.sizeMultiplier),
    price_precision: pricePlace,
    qty_precision: Number(obj.volumePlace),
    min_trade_num: Number(obj.minTradeNum),
    min_trade_usdt: Number(obj.minTradeUSDT),
  };
}

export function fundingUrl({ symbol, pageSize = 100, pageNo = 1 }) {
  const p = new URLSearchParams({ symbol, productType: PRODUCT, pageSize: String(pageSize), pageNo: String(pageNo) });
  return `${BITGET_BASE}/api/v2/mix/market/history-fund-rate?${p.toString()}`;
}

export function contractsUrl({ symbol }) {
  const p = new URLSearchParams({ symbol, productType: PRODUCT });
  return `${BITGET_BASE}/api/v2/mix/market/contracts?${p.toString()}`;
}
