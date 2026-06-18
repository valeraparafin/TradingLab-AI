// backtest/phase0-moex-feasibility.mjs
//
// Phase 0 feasibility: does RangeFilter or SMC have any OOS edge on Russian equities?
// Pure offline research spike on free MOEX ISS daily data (fetched via fetch-moex.js).
// NOTHING here touches T-Bank, tokens, or execution — it only answers "стоит ли игра свеч"
// before we invest effort in a broker integration.
//
//   node backtest/phase0-moex-feasibility.mjs
//
// Method: per symbol, time-ordered 70/30 train/test split (test slice carries `lookback` bars
// of warmup so the first real decision lands exactly at the split). Equity cost model: leverage
// 1 (spot), no funding, taker 0.05% / maker 0.02%, 10 bps slippage (conservative for liquid MOEX
// names). RangeFilter runs in signal mode (stop-and-reverse) with the validated multiplier 6 and
// an ADX regime-gate sweep; SMC runs in its fixed SL/TP mode over a couple of SL/TP combos.
import path from 'path';
import { openMarketDb } from '../src/data/marketDataSchema.js';
import { MarketDataRepo } from '../src/data/MarketDataRepo.js';
import { simulate } from '../src/backtest/simulator.js';
import { computeMetrics } from '../src/backtest/metrics.js';
import { buildGuardrails, buildCosts } from './run-backtest.js';

// IMOEX constituents (liquid universe, fetched via fetch-moex.js). Preferred-share duplicates
// (SBERP/SNGSP/TATNP) dropped — they track their ordinaries. Short-history names (HEAD, OZON,
// X5, T, SVCB, POSI, CNRU, DOMRF, UGLD, RENI…) are skipped automatically by the min-candle guard.
const SYMBOLS = [
  'AFKS', 'AFLT', 'ALRS', 'BSPB', 'CBOM', 'CHMF', 'CNRU', 'DOMRF', 'ENPG', 'FLOT',
  'GAZP', 'GMKN', 'HEAD', 'IRAO', 'LENT', 'LKOH', 'MAGN', 'MDMG', 'MOEX', 'MSNG',
  'MTSS', 'NLMK', 'NVTK', 'OZON', 'PHOR', 'PIKK', 'PLZL', 'POSI', 'RENI', 'ROSN',
  'RTKM', 'RUAL', 'SBER', 'SNGS', 'SVCB', 'T', 'TATN', 'TRNFP', 'UGLD', 'VKCO',
  'VTBR', 'X5',
];
const TF = process.argv.includes('--tf') ? process.argv[process.argv.indexOf('--tf') + 1] : '1D';
const LOOKBACK = 250;
const SPLIT = 0.7;

// Equity cost model (per side): T-Bank-ish commission + conservative slippage on liquid names.
const COST_ARGS = { takerFee: 0.0005, makerFee: 0.0002, slippageBps: 10 };

// Configurations to evaluate. Each yields { logicType, logic, guardrails, regimeGate }.
function buildConfigs() {
  const baseG = { equity: 100000, riskPerTrade: 0.1, leverage: 1, maxOpen: 1 };
  const configs = [];

  // RangeFilter signal mode (stop-and-reverse), multiplier 6, protective SL floor 12%.
  const rfLogic = { indicators: { source: 'close', period: 20, multiplier: 6 }, exit_mode: 'signal' };
  for (const adx of [null, 20, 25, 30]) {
    configs.push({
      name: `RF mult6 ADX${adx ?? '-'}`,
      logicType: 'RangeFilter',
      logic: rfLogic,
      guardrails: buildGuardrails({ ...baseG, sl: 0.12, tp: 0.60 }),
      regimeGate: adx == null ? undefined : { adxMin: adx, adxPeriod: 14 },
    });
  }

  // SMC fixed SL/TP over a couple of combos (daily equities).
  for (const [sl, tp] of [[0.04, 0.08], [0.05, 0.10]]) {
    configs.push({
      name: `SMC sl${sl * 100}/tp${tp * 100}`,
      logicType: 'SMC',
      logic: {},
      guardrails: buildGuardrails({ ...baseG, sl, tp, minRR: 1.5 }),
      regimeGate: undefined,
    });
  }
  return configs;
}

function runSeg(candles, cfg) {
  const sim = simulate({
    candles,
    config: { logicType: cfg.logicType, logic: cfg.logic },
    guardrails: cfg.guardrails,
    costs: buildCosts(COST_ARGS),
    symbol: 'X',
    timeframe: TF,
    lookback: LOOKBACK,
    startEquity: cfg.guardrails.portfolioValue,
    funding: null,
    regimeGate: cfg.regimeGate,
  });
  const m = computeMetrics({
    trades: sim.trades,
    equityCurve: sim.equityCurve,
    startEquity: cfg.guardrails.portfolioValue,
    slippageCost: sim.slippageCost,
    timeframe: TF,
    totalFunding: 0,
    liquidationCount: 0,
  });
  return { pf: m.trades.profitFactor, net: m.return.netPnlPct, n: m.trades.count, wr: m.trades.winRate };
}

const fmtPf = (x) => (x === Infinity ? '∞' : Number.isFinite(x) ? x.toFixed(2) : 'n/a');
const pct = (x) => (x * 100).toFixed(1) + '%';

async function main() {
  const db = await openMarketDb(path.join(process.cwd(), 'market_data.db'));
  const repo = new MarketDataRepo(db);
  const configs = buildConfigs();

  // Per-config accumulators across the basket (sum net%, equal-weight; collect train/test PF).
  const agg = new Map(configs.map((c) => [c.name, { trainNet: 0, testNet: 0, trainN: 0, testN: 0, testPFs: [], symbols: 0, winPF: 0, winNet: 0, tradedSyms: 0 }]));

  for (const sym of SYMBOLS) {
    const candles = await repo.getCandles(sym, TF, 0, Number.MAX_SAFE_INTEGER);
    if (candles.length < LOOKBACK + 50) { console.warn(`SKIP ${sym}: ${candles.length} candles`); continue; }
    const splitIdx = Math.floor(candles.length * SPLIT);
    const train = candles.slice(0, splitIdx);
    const test = candles.slice(splitIdx - LOOKBACK); // carry warmup into test

    console.log(`\n=== ${sym} (${candles.length} candles, split @${splitIdx}) ===`);
    console.log('config'.padEnd(20), 'train PF/net/n', '  ', 'test PF/net/n  wr');
    for (const cfg of configs) {
      const tr = runSeg(train, cfg);
      const te = runSeg(test, cfg);
      const a = agg.get(cfg.name);
      a.trainNet += tr.net; a.testNet += te.net; a.trainN += tr.n; a.testN += te.n; a.symbols++;
      if (Number.isFinite(te.pf)) a.testPFs.push(te.pf);
      // Breadth: how many names actually traded OOS, and of those how many had PF>1 / net>0.
      if (te.n > 0) { a.tradedSyms++; if (te.pf > 1) a.winPF++; if (te.net > 0) a.winNet++; }
      console.log(
        cfg.name.padEnd(20),
        `${fmtPf(tr.pf)}/${pct(tr.net)}/${tr.n}`.padEnd(20),
        `${fmtPf(te.pf)}/${pct(te.net)}/${te.n}`.padEnd(20),
        pct(te.wr),
      );
    }
  }

  console.log('\n\n══════════ BASKET SUMMARY (equal-weight) ══════════');
  console.log('config'.padEnd(20), 'avg train net', 'avg test net', 'median test PF', 'PF>1 / net>0 (of traded)', 'test n');
  for (const cfg of configs) {
    const a = agg.get(cfg.name);
    const med = a.testPFs.length ? [...a.testPFs].sort((x, y) => x - y)[Math.floor(a.testPFs.length / 2)] : NaN;
    console.log(
      cfg.name.padEnd(20),
      pct(a.trainNet / a.symbols).padEnd(14),
      pct(a.testNet / a.symbols).padEnd(13),
      fmtPf(med).padEnd(15),
      `${a.winPF}/${a.winNet} of ${a.tradedSyms}`.padEnd(25),
      String(a.testN),
    );
  }
  await db.close();
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
