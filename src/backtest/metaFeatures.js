// src/backtest/metaFeatures.js
// Phase 3 meta-labeling features. Given the decision window (closed bars up to and including the
// decision bar i; entry fills next-bar open) and the primary signal side, produce a fixed feature
// vector with NO look-ahead. Features are DIRECTION-RELATIVE (expressed in the trade's own
// direction) so a linear model can judge signal QUALITY regardless of side, and so the structural
// features directly test the user's hypothesis: does favorable premium/discount positioning and
// room-to-target (SMC structure) predict a winning RangeFilter+ADX signal?
//
// Groups: momentum (adx, rsiDir, emaSlopeDir, recentRetDir), volatility (atrPct, realizedVol),
// participation (volRatio), structure/SMC (roomToTarget, zoneSigned, structTrendDir).
import { Technicals } from '../indicators/technical.js';
import SMC from '../indicators/smc.js';

export const FEATURE_NAMES = [
  'adx', 'rsiDir', 'emaSlopeDir', 'recentRetDir',
  'atrPct', 'realizedVol', 'volRatio',
  'roomToTarget', 'zoneSigned', 'structTrendDir',
];

const last = (a) => (a && a.length ? a[a.length - 1] : null);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Returns a feature vector aligned to FEATURE_NAMES, or null if the window is too short to compute.
export function extractFeatures(window, side, { pivotLength = 50 } = {}) {
  const n = window.length;
  if (n < 60) return null;
  const closes = window.map((c) => c.close);
  const vols = window.map((c) => c.volume || 0);
  const price = closes[n - 1];
  if (!(price > 0)) return null;
  const dir = side === 'BUY' ? 1 : -1;

  const adx = last(Technicals.adx(window, 14));
  const rsi = last(Technicals.rsi(closes, 14));
  const atr = last(Technicals.atr(window, 14));
  const emaS = Technicals.ema(closes, 20);
  if (adx == null || rsi == null || atr == null || emaS.length < 6) return null;

  // momentum, expressed in the trade direction
  const rsiDir = (dir === 1 ? rsi : 100 - rsi) / 100;
  const emaSlopeDir = dir * (emaS[emaS.length - 1] - emaS[emaS.length - 6]) / price;
  const k = Math.min(10, n - 1);
  const recentRetDir = dir * (price - closes[n - 1 - k]) / closes[n - 1 - k];

  // volatility / participation
  const atrPct = atr / price;
  const rets = [];
  for (let i = n - 20; i < n; i++) if (i > 0) rets.push(Math.log(closes[i] / closes[i - 1]));
  const mu = rets.reduce((a, b) => a + b, 0) / rets.length;
  const realizedVol = Math.sqrt(rets.reduce((a, b) => a + (b - mu) ** 2, 0) / rets.length);
  const volSma = vols.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const volRatio = volSma > 0 ? vols[n - 1] / volSma : 1;

  // structure / SMC (the orthogonal axis, now as learnable features not a hand-coded gate)
  const piv = SMC.findPivots(window, pivotLength);
  // room to the level the trade heads INTO (BUY -> nearest pivot-high above; SELL -> pivot-low below)
  let roomToTarget;
  if (dir === 1) {
    const above = piv.high.map((p) => p.price).filter((pr) => pr > price);
    roomToTarget = above.length ? (Math.min(...above) - price) / price
      : (Math.max(...window.map((c) => c.high)) - price) / price;
  } else {
    const below = piv.low.map((p) => p.price).filter((pr) => pr < price);
    roomToTarget = below.length ? (price - Math.max(...below)) / price
      : (price - Math.min(...window.map((c) => c.low))) / price;
  }
  roomToTarget = clamp(roomToTarget, 0, 0.5);

  // premium/discount position in the recent 100-bar range; "favorable" = entering from the side
  // with room to run (BUY from discount, SELL from premium).
  const win = window.slice(-100);
  const hi = Math.max(...win.map((c) => c.high));
  const lo = Math.min(...win.map((c) => c.low));
  const zonePos = hi > lo ? clamp((price - lo) / (hi - lo), 0, 1) : 0.5;
  const zoneSigned = dir === 1 ? 1 - zonePos : zonePos;

  const structTrendDir = dir * SMC.detectStructure(window, piv).trend;

  return [adx, rsiDir, emaSlopeDir, recentRetDir, atrPct, realizedVol, volRatio, roomToTarget, zoneSigned, structTrendDir];
}
