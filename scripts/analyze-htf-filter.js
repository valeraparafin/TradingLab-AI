// scripts/analyze-htf-filter.js
import path from 'path';
import { fileURLToPath } from 'url';
import { aggregateHTF } from '../src/core/aggregateHTF.js';
import { classifyHTFTrend } from '../src/core/classifyHTFTrend.js';

const DEFS = ['emaBand', 'emaSlope', 'adxRegime'];

/** Index of the last HTF bar with time <= entryTime, or -1 if none. (htf ascending) */
function lastClosedIndex(htf, entryTime) {
  let j = -1;
  for (let i = 0; i < htf.length; i++) {
    if (htf[i].time <= entryTime) j = i; else break;
  }
  return j;
}

/** with/against/neutral bucket for a side given an UP/DOWN/NEUTRAL verdict. */
function bucketOf(side, verdict) {
  if (verdict === 'NEUTRAL') return 'neutral';
  if (verdict === 'UP') return side === 'BUY' ? 'with' : 'against';
  return side === 'SELL' ? 'with' : 'against'; // DOWN
}

/**
 * Classify each trade's entry against the HTF trend (all three definitions) and tally
 * count / PnL / wins per with-against-neutral bucket. Pure and deterministic.
 *
 * @param {{side:'BUY'|'SELL', entryTime:number, pnl:number}[]} trades
 * @param {import('../src/core/contracts.js').Candle[]} htf closed HTF candles
 * @param {object} [opts] classifyHTFTrend options
 * @returns {Record<'emaBand'|'emaSlope'|'adxRegime', Record<'with'|'against'|'neutral', {count:number,pnl:number,wins:number}>>}
 */
export function analyzeTrades(trades, htf, opts = {}) {
  const z = () => ({ count: 0, pnl: 0, wins: 0 });
  const blank = () => ({ with: z(), against: z(), neutral: z() });
  const res = { emaBand: blank(), emaSlope: blank(), adxRegime: blank() };

  for (const t of trades) {
    const j = lastClosedIndex(htf, t.entryTime);
    const verdicts = j < 0
      ? { emaBand: 'NEUTRAL', emaSlope: 'NEUTRAL', adxRegime: 'NEUTRAL' }
      : classifyHTFTrend(htf.slice(0, j + 1), opts);
    for (const def of DEFS) {
      const cell = res[def][bucketOf(t.side, verdicts[def])];
      cell.count += 1;
      cell.pnl += t.pnl;
      if (t.pnl > 0) cell.wins += 1;
    }
  }
  return res;
}

/** Format one definition's tally as printable lines. */
export function formatTally(label, def, tally, startEquity) {
  const pct = (x) => (startEquity > 0 ? (x / startEquity * 100).toFixed(2) + '%' : x.toFixed(2));
  const wr = (cell) => (cell.count > 0 ? Math.round(cell.wins / cell.count * 100) + '%' : '—');
  const line = (name, cell) =>
    `  ${name.padEnd(8)} ${String(cell.count).padStart(4)}  PnL ${pct(cell.pnl).padStart(8)}  WR ${wr(cell)}`;
  return [
    `${label} [${def}]:`,
    line('with', tally.with),
    line('against', tally.against),
    line('neutral', tally.neutral),
  ].join('\n');
}

async function main() {
  // Lazy imports so the unit test never loads sqlite/backtest machinery.
  const { parseArgs } = await import('../backtest/download-data.js');
  const { simulate } = await import('../src/backtest/simulator.js');
  const { buildGuardrails, buildCosts } = await import('../backtest/run-backtest.js');
  const { openMarketDb } = await import('../src/data/marketDataSchema.js');
  const { MarketDataRepo } = await import('../src/data/MarketDataRepo.js');

  const args = parseArgs(process.argv.slice(2));
  const symbol = String(args.symbol || 'BTCUSDT');
  const tf = String(args.tf || '1H');
  const logicType = String(args.logic || 'SMC');
  const lookback = args.lookback != null ? Number(args.lookback) : 250;
  const ratio = args.ratio != null ? Number(args.ratio) : 4;
  const opts = {
    emaPeriod: args.emaPeriod != null ? Number(args.emaPeriod) : 50,
    band: args.band != null ? Number(args.band) : 0.005,
    slopeLookback: args.slopeLookback != null ? Number(args.slopeLookback) : 5,
    slopeThreshold: args.slopeThreshold != null ? Number(args.slopeThreshold) : 0.002,
    adxPeriod: args.adxPeriod != null ? Number(args.adxPeriod) : 14,
    adxThreshold: args.adxThreshold != null ? Number(args.adxThreshold) : 25,
  };

  const marketDb = await openMarketDb(path.join(process.cwd(), 'market_data.db'));
  const marketRepo = new MarketDataRepo(marketDb);
  const candles = await marketRepo.getCandles(symbol, tf, 0, Number.MAX_SAFE_INTEGER);
  const spec = await marketRepo.getContractSpec(symbol);
  await marketDb.close();

  if (candles.length < lookback + 2) {
    throw new Error(`Not enough candles for ${symbol} ${tf}: ${candles.length} (need > ${lookback + 1}).`);
  }

  const guardrails = buildGuardrails(args, spec);
  const costs = buildCosts(args, spec);
  const sim = simulate({
    candles, config: { logicType, logic: {} }, guardrails, costs,
    symbol, timeframe: tf, lookback, startEquity: guardrails.portfolioValue,
  });

  const htf = aggregateHTF(candles, ratio);
  const res = analyzeTrades(sim.trades, htf, opts);
  const label = `${logicType} ${symbol} ${tf} (HTF=${ratio}x, ${htf.length} bars, ${sim.trades.length} trades)`;

  console.log('\n══════════ HTF FILTER MEASUREMENT ══════════');
  console.log(label);
  for (const def of DEFS) {
    console.log(formatTally(label, def, res[def], guardrails.portfolioValue));
  }
  console.log('════════════════════════════════════════════');
}

// Run only when invoked directly (Windows-safe).
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((e) => { console.error('[analyze-htf-filter] FAILED:', e.message); process.exit(1); });
}
