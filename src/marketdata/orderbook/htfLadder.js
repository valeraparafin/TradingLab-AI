// src/marketdata/orderbook/htfLadder.js
// Fixed timeframe ladder. The base TF is what the agent trades on; the level TF is `step`
// rungs higher (significant structure). `higherTf` clamps at the top rung.
const LADDER = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];

/**
 * @param {string} baseTf one of the ladder rungs (unknown values snap up to the next known rung)
 * @param {number} step rungs to climb (default 1; 0 returns the base unchanged)
 * @returns {string}
 */
export function higherTf(baseTf, step = 1) {
  const mins = (tf) => {
    const map = { '1m': 1, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '4h': 240, '1d': 1440 };
    if (map[tf]) return map[tf];
    // Parse unknown formats like '7m', '20m', '2h', etc.
    const match = tf.match(/^(\d+)([mhd])$/);
    if (!match) return null;
    const [, num, unit] = match;
    const n = parseInt(num, 10);
    return unit === 'm' ? n : unit === 'h' ? n * 60 : unit === 'd' ? n * 1440 : null;
  };

  let i = LADDER.indexOf(baseTf);
  if (i === -1) {
    // Unknown TF: find the first rung strictly above it by minute-size, fall back to base.
    const b = mins(baseTf);
    if (b == null) return baseTf;
    i = LADDER.findIndex((tf) => mins(tf) > b);
    if (i === -1) return '1d';
    return LADDER[Math.min(i + Math.max(0, step - 1), LADDER.length - 1)];
  }
  return LADDER[Math.min(i + Math.max(0, step), LADDER.length - 1)];
}
