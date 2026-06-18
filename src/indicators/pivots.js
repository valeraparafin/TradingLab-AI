// Swing-pivot detection shared by smc.js (trend filter) and smcZone.js (retracement entry).
// A bar i is a pivot high if no bar within ±length has a strictly higher high (equal allowed);
// pivot low is the mirror. Extracted verbatim from smc.js so behavior is byte-identical.
export function findPivots(candles, length) {
  const pivots = { high: [], low: [] };
  for (let i = length; i < candles.length - length; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - length; j <= i + length; j++) {
      if (i === j) continue;
      if (candles[j].high > candles[i].high) isHigh = false;
      if (candles[j].low < candles[i].low) isLow = false;
    }
    if (isHigh) pivots.high.push({ index: i, price: candles[i].high });
    if (isLow) pivots.low.push({ index: i, price: candles[i].low });
  }
  return pivots;
}
