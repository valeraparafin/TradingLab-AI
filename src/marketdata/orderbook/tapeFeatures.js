/**
 * Pure tape (trade-print) features over a trailing window.
 * @param {{t:number,p:number,q:number,m:boolean}[]} trades aggTrades; m=true → buyer is maker → SELL aggressor
 * @param {number} now current time (ms)
 * @param {{windowMs?:number}} [opts]
 */
export function computeTapeFeatures(trades, now, { windowMs = 5000 } = {}) {
  const recent = (trades || []).filter((tr) => now - tr.t <= windowMs);
  if (!recent.length) {
    return { lastPrice: null, printVelocity: 0, aggressorImbalance: 0, buyVolUsd: 0, sellVolUsd: 0 };
  }
  let buyVolUsd = 0, sellVolUsd = 0;
  for (const tr of recent) {
    const usd = tr.p * tr.q;
    if (tr.m) sellVolUsd += usd; // buyer maker → seller aggressed
    else buyVolUsd += usd;       // buyer taker → buyer aggressed
  }
  const total = buyVolUsd + sellVolUsd;
  return {
    lastPrice: recent[recent.length - 1].p,
    printVelocity: recent.length / (windowMs / 1000),
    aggressorImbalance: total > 0 ? (buyVolUsd - sellVolUsd) / total : 0,
    buyVolUsd, sellVolUsd,
  };
}
