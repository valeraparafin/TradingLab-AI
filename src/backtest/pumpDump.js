// src/backtest/pumpDump.js
/**
 * Post-pump-dump SHORT detector. Pure. Evaluated on candles up to the current bar's close.
 * Over the trailing `pumpWindow` bars: find the peak high; require the run-up from the
 * pre-peak base to be >= pumpPct, the peak to be in the past (price rolled over), and the
 * pullback from the peak to be >= dumpPct. Uses only data up to the current bar (no look-ahead).
 *
 * @param {{high:number,low:number,close:number}[]} candles ascending
 * @param {{pumpWindow?:number, pumpPct?:number, dumpPct?:number}} [opts]
 * @returns {{eligible:boolean, peak:number|null, preLow:number|null, pumpRet:number, drawdown:number}}
 */
export function isPumpDumpShort(candles, opts = {}) {
  const { pumpWindow = 480, pumpPct = 0.5, dumpPct = 0.15 } = opts;
  const none = { eligible: false, peak: null, preLow: null, pumpRet: 0, drawdown: 0 };
  if (!Array.isArray(candles) || candles.length < pumpWindow) return none;

  const win = candles.slice(candles.length - pumpWindow);
  const last = win.length - 1;

  let peak = -Infinity, peakIdx = -1;
  for (let i = 0; i < win.length; i++) { if (win[i].high > peak) { peak = win[i].high; peakIdx = i; } }
  if (!(peak > 0)) return none;

  let preLow = Infinity;
  for (let i = 0; i <= peakIdx; i++) { if (win[i].low < preLow) preLow = win[i].low; }
  if (!(preLow > 0)) return none;

  const close = win[last].close;
  const pumpRet = (peak - preLow) / preLow;
  const drawdown = (peak - close) / peak;
  const rolledOver = peakIdx < last;
  const eligible = pumpRet >= pumpPct && rolledOver && drawdown >= dumpPct;
  return { eligible, peak, preLow, pumpRet, drawdown };
}
