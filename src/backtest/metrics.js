import { TF_MS } from '../data/marketParse.js';

const YEAR_MS = 365.25 * 86400000;

/** Per-side trade aggregates. */
function sideStats(trades) {
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const netPnl = trades.reduce((s, t) => s + t.pnl, 0);
  return {
    count: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0),
    netPnl,
    avgWin: wins.length ? grossProfit / wins.length : 0,
    avgLoss: losses.length ? -grossLoss / losses.length : 0,
    expectancy: trades.length ? netPnl / trades.length : 0,
  };
}

/**
 * Compute the full per-run metrics set from trades + per-bar equity curve. Pure.
 * Funding/liquidation report as 0 (spot); the shape is already futures-ready.
 *
 * @param {object} p
 * @param {object[]} p.trades
 * @param {{time:number,equity:number}[]} p.equityCurve
 * @param {number} p.startEquity
 * @param {number} [p.slippageCost=0]
 * @param {string} p.timeframe
 * @returns {object}
 */
export function computeMetrics({ trades, equityCurve, startEquity, slippageCost = 0, timeframe }) {
  const finalEquity = equityCurve.length ? equityCurve[equityCurve.length - 1].equity : startEquity;
  const netPnl = finalEquity - startEquity;
  const netPnlPct = startEquity ? netPnl / startEquity : 0;

  const spanMs = equityCurve.length >= 2 ? equityCurve[equityCurve.length - 1].time - equityCurve[0].time : 0;
  const years = spanMs / YEAR_MS;
  const cagr = years > 0 && startEquity > 0 ? Math.pow(finalEquity / startEquity, 1 / years) - 1 : 0;

  // Drawdown + longest underwater stretch.
  let peak = -Infinity, peakTime = null, maxDrawdownPct = 0, maxDrawdownDurationMs = 0;
  for (const pt of equityCurve) {
    if (pt.equity >= peak) { peak = pt.equity; peakTime = pt.time; }
    else {
      const dd = peak > 0 ? (peak - pt.equity) / peak : 0;
      if (dd > maxDrawdownPct) maxDrawdownPct = dd;
      const dur = pt.time - peakTime;
      if (dur > maxDrawdownDurationMs) maxDrawdownDurationMs = dur;
    }
  }

  // Bar returns → Sharpe / Sortino (annualized by timeframe).
  const rets = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].equity, cur = equityCurve[i].equity;
    rets.push(prev !== 0 ? (cur - prev) / prev : 0);
  }
  const mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
  const variance = rets.length ? rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length : 0;
  const std = Math.sqrt(variance);
  const downside = rets.filter(r => r < 0);
  const dStd = Math.sqrt(downside.length ? downside.reduce((a, b) => a + b * b, 0) / downside.length : 0);
  const ppy = TF_MS[timeframe] ? YEAR_MS / TF_MS[timeframe] : 0;
  const ann = Math.sqrt(ppy);
  const sharpe = std > 0 ? (mean / std) * ann : 0;
  const sortino = dStd > 0 ? (mean / dStd) * ann : 0;
  const calmar = maxDrawdownPct > 0 ? cagr / maxDrawdownPct : 0;

  const all = sideStats(trades);
  const totalFees = trades.reduce((s, t) => s + (t.fees || 0), 0);
  const inPosMs = trades.reduce((s, t) => s + (t.exitTime - t.entryTime), 0);
  const avgHoldMs = trades.length ? inPosMs / trades.length : 0;
  const exposurePct = spanMs > 0 ? inPosMs / spanMs : 0;

  return {
    return: { netPnl, netPnlPct, finalEquity, cagr },
    risk: { maxDrawdownPct, maxDrawdownDurationMs, sharpe, sortino, calmar },
    trades: {
      count: all.count, wins: all.wins, losses: all.losses,
      winRate: all.winRate, profitFactor: all.profitFactor, expectancy: all.expectancy,
      avgWin: all.avgWin, avgLoss: all.avgLoss, avgHoldMs, exposurePct,
    },
    costs: { totalFees, totalFunding: 0, liquidationCount: 0, slippageCost },
    breakdown: {
      long: sideStats(trades.filter(t => t.side === 'BUY')),
      short: sideStats(trades.filter(t => t.side === 'SELL')),
    },
  };
}
