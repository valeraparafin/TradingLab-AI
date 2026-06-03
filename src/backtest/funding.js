/**
 * Deterministic funding-rate series for the backtest. Real funding is used wherever
 * the DB has coverage; outside that window a synthetic fallback fills the gap.
 * NO randomness — determinism and cross-config comparability are required.
 *
 * Modes:
 *  - 'real-mean' (default): real rate inside coverage; mean of real rates outside (0 if none).
 *  - 'tile': real rate inside coverage; cyclic repeat of the real series (by 8h-boundary index) outside.
 *  - 'constant': constantRate everywhere (real ignored).
 *
 * @param {object} p
 * @param {{time:number,rate:number}[]} p.realRows sorted-or-not real funding rows
 * @param {'real-mean'|'tile'|'constant'} [p.mode='real-mean']
 * @param {number} [p.constantRate=0] used by 'constant' mode
 * @returns {(time:number)=>number} rateAt
 */
export function buildFundingSeries({ realRows = [], mode = 'real-mean', constantRate = 0 } = {}) {
  if (mode === 'constant') return () => constantRate;

  const rows = [...realRows].sort((a, b) => a.time - b.time);
  const byTime = new Map(rows.map(r => [r.time, r.rate]));
  const minT = rows.length ? rows[0].time : null;
  const maxT = rows.length ? rows[rows.length - 1].time : null;
  const mean = rows.length ? rows.reduce((s, r) => s + r.rate, 0) / rows.length : 0;

  if (mode === 'tile') {
    if (!rows.length) return () => 0;
    const H8 = 8 * 3600000;
    return (time) => {
      if (byTime.has(time)) return byTime.get(time);
      if (time >= minT && time <= maxT) return mean; // inside coverage but off-grid → mean (rare)
      const idx = ((Math.floor(time / H8) % rows.length) + rows.length) % rows.length;
      return rows[idx].rate;
    };
  }

  // 'real-mean' (default)
  return (time) => {
    if (byTime.has(time)) return byTime.get(time);
    return mean;
  };
}

/**
 * Sum funding rates at every funding boundary strictly within (prevTime, curTime].
 * A boundary is a timestamp where time % fundIntervalMs === 0.
 * @param {number} prevTime
 * @param {number} curTime
 * @param {number} fundIntervalMs e.g. 8h = 28800000
 * @param {(time:number)=>number} rateAt
 * @returns {number} summed rate
 */
export function fundingBetween(prevTime, curTime, fundIntervalMs, rateAt) {
  let sum = 0;
  let b = Math.floor(prevTime / fundIntervalMs) * fundIntervalMs + fundIntervalMs;
  for (; b <= curTime; b += fundIntervalMs) sum += rateAt(b);
  return sum;
}
