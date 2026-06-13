// src/indicators/donchianTrend.js
import { Technicals } from './technical.js';

/**
 * Donchian channel-breakout trend entry. The current close breaking above the prior
 * `entryLookback`-bar high → BUY; below the prior low → SELL; inside → HOLD. The channel
 * is computed on candles EXCLUDING the current bar (slice(0, -1)), so the breakout level is
 * known before the current close — no look-ahead. The exit (2×ATR initial stop + M-bar
 * channel trailing stop) is handled by the backtest engine, not here. Pure/deterministic.
 */
const DonchianTrend = {
  execute(candles, config = {}) {
    const ind = config.indicators || {};
    const pick = (cam, sn, def) => {
      const v = [ind[cam], ind[sn]].find((x) => x !== undefined && x !== null);
      return v ?? def;
    };
    const entryLookback = pick('entryLookback', 'entry_lookback', 20);

    const HOLD = { side: 'HOLD', upper: null, lower: null, price: null, invalidation: null };
    if (!Array.isArray(candles) || candles.length < entryLookback + 1) return HOLD;

    const prior = candles.slice(0, -1);
    const ch = Technicals.donchian(prior, entryLookback);
    if (!ch) return HOLD;

    const price = candles[candles.length - 1].close;
    let side = 'HOLD';
    if (price > ch.upper) side = 'BUY';
    else if (price < ch.lower) side = 'SELL';

    return { side, upper: ch.upper, lower: ch.lower, price, invalidation: null };
  },
};

export default DonchianTrend;
