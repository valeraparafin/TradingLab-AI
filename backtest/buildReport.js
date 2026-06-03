// backtest/buildReport.js

const pct = (x) => (x == null || !Number.isFinite(x) ? '   n/a' : (x * 100).toFixed(2).padStart(6) + '%').padStart(7);
const num = (x, d = 2) => (x == null || !Number.isFinite(x) ? 'n/a' : x.toFixed(d));
const pf = (x) => (x === Infinity ? '∞' : Number.isFinite(x) ? x.toFixed(2) : 'n/a');
const pad = (s, w) => String(s).padEnd(w).slice(0, w);

/**
 * Build a deterministic comparison report over matrix cell summaries.
 * PURE — no I/O. Sorted by net PnL % descending.
 *
 * @param {Array<{riskId:string, logicType:string, symbol:string, tf:string, leverage:number, metrics:object}>} cells
 * @returns {{rows: Array<object>, table: string}} rows = normalized (JSON/dashboard ready); table = console string.
 */
export function buildReport(cells = []) {
  const rows = cells.map(c => ({
    riskId: c.riskId,
    logicType: c.logicType,
    symbol: c.symbol,
    tf: c.tf,
    leverage: c.leverage,
    trades: c.metrics.trades.count,
    winRate: c.metrics.trades.winRate,
    profitFactor: c.metrics.trades.profitFactor,
    netPnlPct: c.metrics.return.netPnlPct,
    finalEquity: c.metrics.return.finalEquity,
    maxDrawdownPct: c.metrics.risk.maxDrawdownPct,
    sharpe: c.metrics.risk.sharpe,
    totalFunding: c.metrics.costs.totalFunding,
    liquidations: c.metrics.costs.liquidationCount,
  })).sort((a, b) => (b.netPnlPct ?? -Infinity) - (a.netPnlPct ?? -Infinity));

  const header = [
    pad('Logic', 10), pad('Risk', 12), pad('Symbol', 9), pad('TF', 4), pad('Lev', 4),
    pad('Trades', 7), pad('WinRate', 8), pad('PF', 6), pad('NetPnl%', 9),
    pad('MaxDD%', 8), pad('Sharpe', 7), pad('Funding', 9), pad('Liq', 4),
  ].join(' ');
  const sep = '─'.repeat(header.length);

  const lines = rows.map(r => [
    pad(r.logicType, 10), pad(r.riskId, 12), pad(r.symbol, 9), pad(r.tf, 4), pad(r.leverage + 'x', 4),
    pad(r.trades, 7), pad(pct(r.winRate).trim(), 8), pad(pf(r.profitFactor), 6), pad(pct(r.netPnlPct).trim(), 9),
    pad(pct(r.maxDrawdownPct).trim(), 8), pad(num(r.sharpe), 7), pad(num(r.totalFunding), 9), pad(r.liquidations ?? 0, 4),
  ].join(' '));

  const body = rows.length ? lines.join('\n') : '(no runs)';
  const table = `\n══════════ MATRIX COMPARISON ══════════\n${header}\n${sep}\n${body}\n${sep}`;
  return { rows, table };
}
