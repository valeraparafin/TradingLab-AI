import { findPivots } from './pivots.js';

const SMC = {
  execute(candles, config = {}) {
    // Params live under `config.indicators`. Templates store snake_case keys
    // (pivot_length) and resolveConfig() deep-converts them to camelCase before
    // runtime, so the canonical runtime key is camelCase per the repo casing
    // policy. Accept the camelCase form first (runtime/resolved), then the raw
    // snake_case form (un-resolved configs), then the hardcoded default. Mirror
    // of the tolerant lookup in src/indicators/wave-trend.js.
    const ind = config.indicators || {};
    const pivotLength = [ind.pivotLength, ind.pivot_length].find(
      (v) => v !== undefined && v !== null
    ) ?? 50;
    const pivots = findPivots(candles, pivotLength);
    const structure = this.detectStructure(candles, pivots);
    const obs = this.detectOrderBlocks(candles, structure.structure);
    const fvgs = this.detectFVG(candles);

    // CHoCH Confirmation Logic:
    // Check if a Change of Character occurred AFTER the price entered the most recent OB.
    let chochConfirmed = false;
    if (obs.length > 0) {
      const currentOb = obs[0];
      const { top, bottom } = currentOb.range;

      // Find the index where price first entered the current OB
      let entryIndex = -1;
      for (let i = candles.length - 1; i >= 0; i--) {
        if (candles[i].close >= bottom && candles[i].close <= top) {
          entryIndex = i;
        } else if (entryIndex !== -1) {
          // We found the start of the current visit to the zone
          break;
        }
      }

      if (entryIndex !== -1) {
        // Analyze candles from entryIndex to the end for a CHoCH
        const zoneCandles = candles.slice(entryIndex);
        const zonePivots = findPivots(zoneCandles, Math.floor(pivotLength / 2)); // Use tighter pivots for confirmation
        const zoneStructure = this.detectStructure(zoneCandles, zonePivots);

        // Confirmation is a trend shift that matches our expected direction
        if (zoneStructure.trend !== 0) {
          chochConfirmed = true;
        }
      }
    }

    return {
      structure,
      obs,
      fvgs,
      choch_confirmed: chochConfirmed,
    };
  },

  detectStructure(candles, pivots) {
    let trend = 0; // 1 bullish, -1 bearish
    const structure = [];
    let lastHigh =
      pivots.high.length > 0 ? pivots.high[pivots.high.length - 1].price : null;
    let lastLow =
      pivots.low.length > 0 ? pivots.low[pivots.low.length - 1].price : null;

    const currentClose = candles[candles.length - 1].close;

    if (lastHigh && currentClose > lastHigh) {
      const type = trend === -1 ? "CHoCH" : "BOS";
      trend = 1;
      structure.push({ type, bias: "bullish", price: lastHigh });
    } else if (lastLow && currentClose < lastLow) {
      const type = trend === 1 ? "CHoCH" : "BOS";
      trend = -1;
      structure.push({ type, bias: "bearish", price: lastLow });
    }

    return { trend, structure };
  },

  detectOrderBlocks(candles, structure) {
    if (structure.length === 0) return [];
    const lastBreak = structure[structure.length - 1];
    const ob = { type: lastBreak.bias, range: { top: 0, bottom: 0 }, index: 0 };

    for (let i = candles.length - 1; i >= 0; i--) {
      if (lastBreak.bias === "bullish") {
        if (candles[i].close < candles[i].open) {
          ob.range = { top: candles[i].high, bottom: candles[i].low };
          ob.index = i;
          break;
        }
      } else {
        if (candles[i].close > candles[i].open) {
          ob.range = { top: candles[i].high, bottom: candles[i].low };
          ob.index = i;
          break;
        }
      }
    }
    return [ob];
  },

  detectFVG(candles) {
    const fvgs = [];
    const len = candles.length;
    if (len < 3) return fvgs;

    const c1 = candles[len - 3];
    const c2 = candles[len - 2];
    const c3 = candles[len - 1];

    if (c3.low > c1.high) {
      fvgs.push({ type: "bullish", top: c3.low, bottom: c1.high });
    }
    if (c3.high < c1.low) {
      fvgs.push({ type: "bearish", top: c1.low, bottom: c3.high });
    }

    return fvgs;
  },
};

export default SMC;
