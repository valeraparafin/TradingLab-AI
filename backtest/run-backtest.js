import path from 'path';
import { fileURLToPath } from 'url';
import { openMarketDb } from '../src/data/marketDataSchema.js';
import { MarketDataRepo } from '../src/data/MarketDataRepo.js';
import { openBacktestDb } from '../src/backtest/backtestSchema.js';
import { BacktestRepo } from '../src/backtest/BacktestRepo.js';
import { simulate } from '../src/backtest/simulator.js';
import { computeMetrics } from '../src/backtest/metrics.js';
import { parseArgs } from './download-data.js';

/** Build RiskPolicy guardrails from CLI args (fixed-notional sizing; spot defaults). */
export function buildGuardrails(args) {
  const num = (v, d) => (v != null ? Number(v) : d);
  return {
    portfolioValue: num(args.equity, 10000),
    riskPerTrade: num(args.riskPerTrade, 0.1),
    maxTradeSizeUSD: args.maxTradeSizeUSD != null ? Number(args.maxTradeSizeUSD) : Infinity,
    stopLossPct: num(args.sl, 0.02),
    takeProfitPct: num(args.tp, 0.04),
    minRiskRewardRatio: num(args.minRR, 1.5),
    maxOpenPositions: num(args.maxOpen, 1),
    maxPortfolioHeatPct: num(args.maxHeat, 100),
    dailyLossLimitPct: num(args.dailyLoss, 1),
    dailyProfitTargetPct: null,
    maxTradesPerDay: num(args.maxTrades, 999999),
  };
}

/** Build cost config from CLI args, falling back to the stored contract spec, then constants. */
export function buildCosts(args, spec = null) {
  return {
    takerFee: args.takerFee != null ? Number(args.takerFee) : (spec && spec.taker_fee != null ? spec.taker_fee : 0.0006),
    makerFee: args.makerFee != null ? Number(args.makerFee) : (spec && spec.maker_fee != null ? spec.maker_fee : 0.0002),
    slippageBps: args.slippageBps != null ? Number(args.slippageBps) : 5,
  };
}

function fmtPct(x) { return (x * 100).toFixed(2) + '%'; }

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const symbol = String(args.symbol || 'BTCUSDT');
  const tf = String(args.tf || '1H');
  const logicType = String(args.logic || 'SMC');
  const leverage = args.leverage != null ? Number(args.leverage) : 1;
  if (leverage !== 1) throw new Error('Phase 3 supports spot only (leverage = 1). Futures arrive in Phase 4.');
  const lookback = args.lookback != null ? Number(args.lookback) : 250;
  const from = args.from ? Date.parse(args.from) : 0;
  const to = args.to ? Date.parse(args.to) : Number.MAX_SAFE_INTEGER;
  const label = String(args.label || `${logicType} ${symbol} ${tf}`);

  const marketDb = await openMarketDb(path.join(process.cwd(), 'market_data.db'));
  const marketRepo = new MarketDataRepo(marketDb);
  const candles = await marketRepo.getCandles(symbol, tf, from, to);
  const spec = await marketRepo.getContractSpec(symbol);
  await marketDb.close();

  if (candles.length < lookback + 2) {
    throw new Error(`Not enough candles for ${symbol} ${tf}: ${candles.length} (need > ${lookback + 1}). Download more via backtest/download-data.js.`);
  }

  const guardrails = buildGuardrails(args);
  const costs = buildCosts(args, spec);
  const config = { logicType, logic: {} };

  console.log(`[backtest] ${label}: ${candles.length} candles, lookback ${lookback}, leverage 1 (spot)`);
  const sim = simulate({ candles, config, guardrails, costs, symbol, timeframe: tf, lookback, startEquity: guardrails.portfolioValue });
  const metrics = computeMetrics({ trades: sim.trades, equityCurve: sim.equityCurve, startEquity: guardrails.portfolioValue, slippageCost: sim.slippageCost, timeframe: tf });

  const btDb = await openBacktestDb(path.join(process.cwd(), 'backtest.db'));
  const btRepo = new BacktestRepo(btDb);
  const runId = await btRepo.saveRun({
    strategyLabel: label, logicType, symbol, timeframe: tf,
    periodFrom: candles[0].time, periodTo: candles[candles.length - 1].time,
    leverage, params: { lookback, guardrails }, costs, metrics,
  });
  await btRepo.saveTrades(runId, sim.trades);
  await btRepo.saveEquityCurve(runId, sim.equityCurve);
  await btDb.close();

  const m = metrics;
  console.log('\n══════════ BACKTEST RESULT ══════════');
  console.log(`Run id        : ${runId}`);
  console.log(`Strategy      : ${label} (${logicType})`);
  console.log(`Trades        : ${m.trades.count}  (W ${m.trades.wins} / L ${m.trades.losses})`);
  console.log(`Win rate      : ${fmtPct(m.trades.winRate)}`);
  console.log(`Profit factor : ${m.trades.profitFactor === Infinity ? '∞' : m.trades.profitFactor.toFixed(2)}`);
  console.log(`Net PnL       : ${m.return.netPnl.toFixed(2)} USD (${fmtPct(m.return.netPnlPct)})`);
  console.log(`Final equity  : ${m.return.finalEquity.toFixed(2)} USD`);
  console.log(`Max drawdown  : ${fmtPct(m.risk.maxDrawdownPct)}`);
  console.log(`Sharpe/Sortino: ${m.risk.sharpe.toFixed(2)} / ${m.risk.sortino.toFixed(2)}`);
  console.log(`Costs         : fees ${m.costs.totalFees.toFixed(2)}, slippage ${m.costs.slippageCost.toFixed(2)}`);
  console.log(`Long / Short  : ${m.breakdown.long.count} / ${m.breakdown.short.count}`);
  console.log('═════════════════════════════════════');
}

// Run only when invoked directly (Windows-safe).
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch(e => { console.error('[run-backtest] FAILED:', e.message); process.exit(1); });
}
