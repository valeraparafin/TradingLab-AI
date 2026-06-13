// backtest/run-donchian-scout.mjs
// Frozen Donchian trend-following sweep. Configs are pre-registered (no tuning).
import path from 'path';
import { fileURLToPath } from 'url';
import { openMarketDb } from '../src/data/marketDataSchema.js';
import { MarketDataRepo } from '../src/data/MarketDataRepo.js';
import { simulate } from '../src/backtest/simulator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'LTCUSDT', 'SOLUSDT', 'XLMUSDT', 'XRPUSDT'];
const TFS = ['1H', '4H'];
const CONFIGS = [
  { name: 'fast', entry: 20, exit: 10 },
  { name: 'slow', entry: 55, exit: 20 },
];
const WINDOWS = {
  train: ['2024-06-01', '2025-06-01'],
  test:  ['2025-06-01', '2026-06-08'],
};
const COSTS = { takerFee: 0.0006, makerFee: 0.0002, slippageBps: 5 };

function guardrails() {
  return {
    portfolioValue: 10000, riskPerTrade: 0.02, sizingMode: 'fixed',
    stopLossPct: 0.02, takeProfitPct: 0.04, minRiskRewardRatio: 0,
    maxOpenPositions: 1, maxPortfolioHeatPct: 100, dailyLossLimitPct: 1,
    maxTradesPerDay: 999999, leverage: 1, stopMode: 'channel', atrPeriod: 14, atrSL: 2,
  };
}

function maxDrawdown(curve) {
  let peak = -Infinity, mdd = 0;
  for (const pt of curve) {
    if (pt.equity > peak) peak = pt.equity;
    if (peak > 0) mdd = Math.max(mdd, (peak - pt.equity) / peak);
  }
  return mdd;
}

async function main() {
  const db = await openMarketDb(path.join(path.dirname(__dirname), 'market_data.db'));
  const repo = new MarketDataRepo(db);
  const rows = [];

  for (const [win, [fromS, toS]] of Object.entries(WINDOWS)) {
    const from = Date.parse(fromS), to = Date.parse(toS);
    for (const cfg of CONFIGS) {
      for (const tf of TFS) {
        for (const symbol of SYMBOLS) {
          const candles = await repo.getCandles(symbol, tf, from, to);
          if (!candles || candles.length < 260) { rows.push({ win, cfg: cfg.name, tf, symbol, skip: candles?.length ?? 0 }); continue; }
          const config = { logicType: 'DonchianTrend', logic: { indicators: { entryLookback: cfg.entry } } };
          const res = simulate({
            candles, config, guardrails: guardrails(), costs: COSTS, symbol, timeframe: tf,
            lookback: 250, exitPolicy: { channelExit: cfg.exit },
          });
          const pnlPct = res.finalEquity / 10000 - 1;
          const bh = candles[candles.length - 1].close / candles[0].close - 1;
          rows.push({ win, cfg: cfg.name, tf, symbol, pnlPct, mdd: maxDrawdown(res.equityCurve), trades: res.trades.length, bh });
        }
      }
    }
  }

  // Print as TSV for easy tabulation into the research note.
  const pct = (x) => (x * 100).toFixed(1) + '%';
  console.log('window\tcfg\ttf\tsymbol\tpnl\tmaxdd\ttrades\tbuyhold\tbeatBH');
  for (const r of rows) {
    if (r.skip != null) { console.log(`${r.win}\t${r.cfg}\t${r.tf}\t${r.symbol}\tSKIP(${r.skip})`); continue; }
    console.log(`${r.win}\t${r.cfg}\t${r.tf}\t${r.symbol}\t${pct(r.pnlPct)}\t${pct(r.mdd)}\t${r.trades}\t${pct(r.bh)}\t${r.pnlPct > r.bh ? 'Y' : 'n'}`);
  }

  // Test-year breadth summary per (cfg, tf): how many of 6 symbols are positive AND beat buy-hold.
  console.log('\n-- test-year breadth (positive / beat-BH out of 6) --');
  for (const cfg of CONFIGS) for (const tf of TFS) {
    const cells = rows.filter((r) => r.win === 'test' && r.cfg === cfg.name && r.tf === tf && r.skip == null);
    const pos = cells.filter((r) => r.pnlPct > 0).length;
    const beat = cells.filter((r) => r.pnlPct > r.bh).length;
    const mddMax = cells.length ? Math.max(...cells.map((r) => r.mdd)) : 0;
    console.log(`${cfg.name}\t${tf}\tpositive ${pos}/6\tbeatBH ${beat}/6\tworstDD ${pct(mddMax)}`);
  }

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
