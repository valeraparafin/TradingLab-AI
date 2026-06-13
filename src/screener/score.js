// src/screener/score.js
/** Midrank percentile in [0,1]; ties share the midpoint. n<=1 → 0.5. */
function pctRank(values, v) {
  let less = 0, eq = 0;
  for (const x of values) { if (x < v) less++; else if (x === v) eq++; }
  const n = values.length;
  if (n <= 1) return 0.5;
  return (less + 0.5 * (eq - 1)) / (n - 1);
}

/**
 * Rank-composite universe selection. Pure. Rows carry pre-computed metrics.
 * @param {{symbol:string, volatility:number, momentum:number, liquidity:number}[]} rows
 * @param {{minLiquidity?:number, denylist?:string[], topN?:number, weights?:{vol:number,mom:number,liq:number}}} [opts]
 * @returns {{symbol:string, score:number, rank:number, volatility:number, momentum:number, liquidity:number}[]}
 */
export function scoreUniverse(rows, opts = {}) {
  const { minLiquidity = 0, denylist = [], topN = 15,
          weights = { vol: 0.5, mom: 0.3, liq: 0.2 } } = opts;
  const deny = new Set(denylist);
  const survivors = rows.filter(r => r.liquidity >= minLiquidity && !deny.has(r.symbol));
  if (survivors.length === 0) return [];
  const vols = survivors.map(r => r.volatility);
  const moms = survivors.map(r => r.momentum);
  const liqs = survivors.map(r => r.liquidity);
  const scored = survivors.map(r => ({
    symbol: r.symbol, volatility: r.volatility, momentum: r.momentum, liquidity: r.liquidity,
    score: weights.vol * pctRank(vols, r.volatility)
         + weights.mom * pctRank(moms, r.momentum)
         + weights.liq * pctRank(liqs, r.liquidity),
  }));
  scored.sort((a, b) => (b.score - a.score) || (b.liquidity - a.liquidity));
  return scored.slice(0, topN).map((r, i) => ({ ...r, rank: i + 1 }));
}
