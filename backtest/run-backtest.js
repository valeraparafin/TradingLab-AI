import path from 'path';
import { fileURLToPath } from 'url';
import { openMarketDb } from '../src/data/marketDataSchema.js';
import { MarketDataRepo } from '../src/data/MarketDataRepo.js';
import { openBacktestDb } from '../src/backtest/backtestSchema.js';
import { BacktestRepo } from '../src/backtest/BacktestRepo.js';
import { simulate } from '../src/backtest/simulator.js';
import { computeMetrics } from '../src/backtest/metrics.js';
import { parseArgs } from './download-data.js';
import { buildFundingSeries } from '../src/backtest/funding.js';

/** Build RiskPolicy guardrails from CLI args (fixed-notional sizing; spot defaults). */
export function buildGuardrails(args, spec = null) {
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
    leverage: num(args.leverage, 1),
    mmr: args.mmr != null ? Number(args.mmr) : (spec && spec.mmr != null ? spec.mmr : null),
  };
}

/** Build cost config from CLI args, falling back to the stored contract spec, then constants. */
export function buildCosts(args, spec = null) {
  const taker = args.takerFee != null ? Number(args.takerFee) : (spec && spec.taker_fee != null ? spec.taker_fee : 0.0006);
  return {
    takerFee: taker,
    makerFee: args.makerFee != null ? Number(args.makerFee) : (spec && spec.maker_fee != null ? spec.maker_fee : 0.0002),
    slippageBps: args.slippageBps != null ? Number(args.slippageBps) : 5,
    liqFeeRate: args.liqFee != null ? Number(args.liqFee) : taker,
  };
}

/** Parse an ISO date arg to epoch ms; returns `fallback` if absent, throws on a bad value. */
export function parseDate(s, fallback) {
  if (s == null) return fallback;
  const t = Date.parse(s);
  if (Number.isNaN(t)) throw new Error(`Invalid date: "${s}". Use ISO format, e.g. 2024-01-01`);
  return t;
}

function fmtPct(x) { return (x * 100).toFixed(2) + '%'; }

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const symbol = String(args.symbol || 'BTCUSDT');
  const tf = String(args.tf || '1H');
  const logicType = String(args.logic || 'SMC');
  const leverage = args.leverage != null ? Number(args.leverage) : 1;
  const fundingMode = String(args.fundingMode || 'real-mean');
  const fundingRateArg = args.fundingRate != null ? Number(args.fundingRate) : 0;
  const lookback = args.lookback != null ? Number(args.lookback) : 250;
  const from = parseDate(args.from, 0);
  const to = parseDate(args.to, Number.MAX_SAFE_INTEGER);
  const label = String(args.label || `${logicType} ${symbol} ${tf}`);

  const marketDb = await openMarketDb(path.join(process.cwd(), 'market_data.db'));
  const marketRepo = new MarketDataRepo(marketDb);
  const candles = await marketRepo.getCandles(symbol, tf, from, to);
  const spec = await marketRepo.getContractSpec(symbol);
  await marketDb.close();

  if (candles.length < lookback + 2) {
    throw new Error(`Not enough candles for ${symbol} ${tf}: ${candles.length} (need > ${lookback + 1}). Download more via backtest/download-data.js.`);
  }

  const guardrails = buildGuardrails(args, spec);
  const costs = buildCosts(args, spec);
  const config = { logicType, logic: {} };

  let funding = null;
  if (leverage > 1) {
    if (guardrails.mmr == null) throw new Error(`No MMR for ${symbol} (need contract spec or --mmr) for futures.`);
    const fundIntervalH = (spec && spec.fund_interval_h) || 8;
    const intervalMs = fundIntervalH * 3600000;
    const mdb = await openMarketDb(path.join(process.cwd(), 'market_data.db'));
    const realRows = await new MarketDataRepo(mdb).getFunding(symbol, candles[0].time, candles[candles.length - 1].time);
    await mdb.close();
    const rateAt = buildFundingSeries({ realRows, mode: fundingMode, constantRate: fundingRateArg });
    funding = { rateAt, intervalMs };
    console.log(`[backtest] funding mode=${fundingMode}, real rows=${realRows.length}, interval=${fundIntervalH}h`);
  }

  console.log(`[backtest] ${label}: ${candles.length} candles, lookback ${lookback}, leverage ${leverage}${leverage > 1 ? ' (futures)' : ' (spot)'}`);
  const sim = simulate({ candles, config, guardrails, costs, symbol, timeframe: tf, lookback, startEquity: guardrails.portfolioValue, funding });
  const metrics = computeMetrics({ trades: sim.trades, equityCurve: sim.equityCurve, startEquity: guardrails.portfolioValue, slippageCost: sim.slippageCost, timeframe: tf, totalFunding: sim.totalFunding, liquidationCount: sim.liquidationCount });

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
  console.log(`Costs         : fees ${m.costs.totalFees.toFixed(2)}, slippage ${m.costs.slippageCost.toFixed(2)}, funding ${m.costs.totalFunding.toFixed(2)}`);
  if (leverage > 1) console.log(`Liquidations  : ${m.costs.liquidationCount}  (leverage ${leverage}x)`);
  console.log(`Long / Short  : ${m.breakdown.long.count} / ${m.breakdown.short.count}`);
  console.log('═════════════════════════════════════');
}

// Run only when invoked directly (Windows-safe).
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch(e => { console.error('[run-backtest] FAILED:', e.message); process.exit(1); });
}
