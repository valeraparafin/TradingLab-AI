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
    sizingMode: args.sizing === 'compound' ? 'compound' : 'fixed',
    maxTradeSizeUSD: args.maxTradeSizeUSD != null ? Number(args.maxTradeSizeUSD) : Infinity,
    stopLossPct: num(args.sl, 0.02),
    takeProfitPct: num(args.tp, 0.04),
    minRiskRewardRatio: num(args.minRR, 1.5),
    maxOpenPositions: num(args.maxOpen, 1),
    // CLI convention: 100 = effectively unbounded heat gate, intentionally un-normalized
    // (this is a raw CLI default, not a stored template percent — do not run it through normFraction).
    maxPortfolioHeatPct: num(args.maxHeat, 100),
    dailyLossLimitPct: num(args.dailyLoss, 1),
    dailyProfitTargetPct: null,
    maxTradesPerDay: num(args.maxTrades, 999999),
    leverage: num(args.leverage, 1),
    mmr: args.mmr != null ? Number(args.mmr) : (spec && spec.mmr != null ? spec.mmr : null),
    stopMode: args.stopMode || 'percent',
    atrPeriod: num(args.atrPeriod, 14),
    atrSL: num(args.atrSL, 2),
    atrTP: num(args.atrTP, 4),
    structuralRR: num(args.structuralRR, 2),
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

/**
 * Map known indicator CLI flags into a `config.logic` object ({ indicators: {...} }).
 * Only TrendPullback currently reads these; other logics use their own defaults, so an
 * empty object is returned when no indicator flag is present. All values coerced to Number.
 */
export function buildLogicConfig(args) {
  const KEYS = ['emaBias', 'slopeLen', 'adxPeriod', 'adxMin', 'emaFast', 'rsiPeriod', 'rsiPullback', 'htfRatio', 'entryLookback'];
  const indicators = {};
  for (const k of KEYS) if (args[k] != null) indicators[k] = Number(args[k]);
  return Object.keys(indicators).length ? { indicators } : {};
}

/** Parse an ISO date arg to epoch ms; returns `fallback` if absent, throws on a bad value. */
export function parseDate(s, fallback) {
  if (s == null) return fallback;
  const t = Date.parse(s);
  if (Number.isNaN(t)) throw new Error(`Invalid date: "${s}". Use ISO format, e.g. 2024-01-01`);
  return t;
}

function fmtPct(x) { return (x * 100).toFixed(2) + '%'; }

/**
 * Execute one backtest cell: build funding (futures only), simulate, compute metrics,
 * and persist the run + trades + equity curve. Returns { runId, metrics }.
 * Shared by the single-run CLI (main) and the matrix runner.
 *
 * @param {BacktestRepo} btRepo open backtest repository
 * @param {object} p { label, logicType, symbol, tf, lookback, leverage, candles, spec,
 *   realRows, guardrails, costs, fundingMode, fundingRate, group?, decide? }
 */
export async function runOne(btRepo, p) {
  let funding = null;
  if (p.leverage > 1) {
    if (p.guardrails.mmr == null) throw new Error(`No MMR for ${p.symbol} (need contract spec or --mmr) for futures.`);
    const fundIntervalH = (p.spec && p.spec.fund_interval_h) || 8;
    const rateAt = buildFundingSeries({ realRows: p.realRows || [], mode: p.fundingMode, constantRate: p.fundingRate });
    funding = { rateAt, intervalMs: fundIntervalH * 3600000 };
    console.log(`[backtest] funding mode=${p.fundingMode}, real rows=${(p.realRows || []).length}, interval=${fundIntervalH}h`);
  }

  console.log(`[backtest] ${p.label}: ${p.candles.length} candles, lookback ${p.lookback}, leverage ${p.leverage}${p.leverage > 1 ? ' (futures)' : ' (spot)'}`);
  const config = { logicType: p.logicType, logic: p.logicConfig || {} };
  // p.decide is optional; passing undefined uses simulate's default (evaluateBar).
  const sim = simulate(
    { candles: p.candles, config, guardrails: p.guardrails, costs: p.costs, symbol: p.symbol, timeframe: p.tf, lookback: p.lookback, startEquity: p.guardrails.portfolioValue, funding, exitPolicy: p.exitPolicy },
    p.decide,
  );
  const metrics = computeMetrics({ trades: sim.trades, equityCurve: sim.equityCurve, startEquity: p.guardrails.portfolioValue, slippageCost: sim.slippageCost, timeframe: p.tf, totalFunding: sim.totalFunding, liquidationCount: sim.liquidationCount });

  const runId = await btRepo.saveRun({
    strategyLabel: p.label, logicType: p.logicType, symbol: p.symbol, timeframe: p.tf,
    periodFrom: p.candles[0].time, periodTo: p.candles[p.candles.length - 1].time,
    leverage: p.leverage, params: { lookback: p.lookback, guardrails: p.guardrails }, costs: p.costs, metrics,
    group: p.group ?? null,
  });
  await btRepo.saveTrades(runId, sim.trades);
  await btRepo.saveEquityCurve(runId, sim.equityCurve);
  return { runId, metrics };
}

/** Print the single-run result block. */
export function printSummary({ runId, label, logicType, leverage, metrics }) {
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const symbol = String(args.symbol || 'BTCUSDT');
  const tf = String(args.tf || '1H');
  const logicType = String(args.logic || 'SMC');
  const leverage = args.leverage != null ? Number(args.leverage) : 1;
  // CLI flags use camelCase throughout (consistent with e.g. --riskPerTrade):
  //   --leverage, --mmr, --fundingMode (real-mean|tile|constant),
  //   --fundingRate (for constant mode), --liqFee
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
  let realRows = [];
  if (leverage > 1 && candles.length) {
    realRows = await marketRepo.getFunding(symbol, candles[0].time, candles[candles.length - 1].time);
  }
  await marketDb.close();

  if (candles.length < lookback + 2) {
    throw new Error(`Not enough candles for ${symbol} ${tf}: ${candles.length} (need > ${lookback + 1}). Download more via backtest/download-data.js.`);
  }

  const guardrails = buildGuardrails(args, spec);
  const costs = buildCosts(args, spec);

  // Opt-in HTF gate (backtest-only). Bare `--htf` parses to args.htf === true.
  let decide; // undefined → simulate() uses its default evaluateBar
  if (args.htf) {
    const { withHtfGate } = await import('../src/backtest/htfGate.js');
    const { evaluateBar } = await import('../src/core/pipeline.js');
    const htfOpts = {
      ratio: args.htfRatio != null ? Number(args.htfRatio) : 4,
      emaPeriod: args.htfEma != null ? Number(args.htfEma) : 50,
      band: args.htfBand != null ? Number(args.htfBand) : 0.005,
    };
    decide = withHtfGate(evaluateBar, htfOpts);
    console.log(`[backtest] HTF gate ON (emaBand, ratio=${htfOpts.ratio}, ema=${htfOpts.emaPeriod}, band=${htfOpts.band})`);
  }

  let exitPolicy;
  if (args.breakevenR != null || args.channelExit != null) {
    exitPolicy = {};
    if (args.breakevenR != null) exitPolicy.breakevenR = Number(args.breakevenR);
    if (args.channelExit != null) exitPolicy.channelExit = Number(args.channelExit);
  }
  const logicConfig = buildLogicConfig(args);

  const btDb = await openBacktestDb(path.join(process.cwd(), 'backtest.db'));
  const btRepo = new BacktestRepo(btDb);
  const { runId, metrics } = await runOne(btRepo, {
    label, logicType, symbol, tf, lookback, leverage,
    candles, spec, realRows, guardrails, costs,
    fundingMode, fundingRate: fundingRateArg, group: args.group ?? null,
    decide, exitPolicy, logicConfig,
  });
  await btDb.close();

  printSummary({ runId, label, logicType, leverage, metrics });
}

// Run only when invoked directly (Windows-safe).
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch(e => { console.error('[run-backtest] FAILED:', e.message); process.exit(1); });
}
