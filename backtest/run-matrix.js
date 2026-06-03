// backtest/run-matrix.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { openMarketDb } from '../src/data/marketDataSchema.js';
import { MarketDataRepo } from '../src/data/MarketDataRepo.js';
import { openBacktestDb } from '../src/backtest/backtestSchema.js';
import { BacktestRepo } from '../src/backtest/BacktestRepo.js';
import { toCamel } from '../src/utils/casing.js';
import { riskProfileToGuardrails } from '../src/agents/riskProfileToGuardrails.js';
import { runOne, buildCosts, parseDate } from './run-backtest.js';
import { buildReport } from './buildReport.js';
import { parseArgs } from './download-data.js';

/** Cross product of matrix dimensions, in stable risk→logic→symbol→tf order. */
export function expandMatrix({ risks, logics, symbols, tfs }) {
  const cells = [];
  for (const riskId of risks)
    for (const logicType of logics)
      for (const symbol of symbols)
        for (const tf of tfs)
          cells.push({ riskId, logicType, symbol, tf });
  return cells;
}

/** Load a file risk template (templates/risk/<id>.json) into camelCase *Percent settings. */
export function loadRiskProfile(riskId) {
  const p = path.join(process.cwd(), 'templates', 'risk', `${riskId}.json`);
  if (!fs.existsSync(p)) throw new Error(`Risk template not found: ${riskId} (expected ${p})`);
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  return toCamel(raw.content?.settings || raw.settings || raw);
}

const csv = (v, d) => String(v ?? d).split(',').map(s => s.trim()).filter(Boolean);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // CLI flags (camelCase, comma-separated lists):
  //   --risks aggressive,conservative  --logics SMC,breakout
  //   --symbols BTCUSDT,ETHUSDT         --tfs 1H,4H
  //   shared: --leverage --mmr --fundingMode --fundingRate --lookback --from --to --group
  const dims = {
    risks: csv(args.risks, 'aggressive'),
    logics: csv(args.logics, 'SMC'),
    symbols: csv(args.symbols, 'BTCUSDT'),
    tfs: csv(args.tfs, '1H'),
  };
  const leverage = args.leverage != null ? Number(args.leverage) : 1;
  const fundingMode = String(args.fundingMode || 'real-mean');
  const fundingRate = args.fundingRate != null ? Number(args.fundingRate) : 0;
  const lookback = args.lookback != null ? Number(args.lookback) : 250;
  const from = parseDate(args.from, 0);
  const to = parseDate(args.to, Number.MAX_SAFE_INTEGER);
  const group = String(args.group || `m_${Date.now()}`);

  const cells = expandMatrix(dims);
  console.log(`[matrix] group=${group}: ${cells.length} cells (${dims.risks.length}r × ${dims.logics.length}l × ${dims.symbols.length}s × ${dims.tfs.length}tf), leverage ${leverage}`);

  const marketDb = await openMarketDb(path.join(process.cwd(), 'market_data.db'));
  const marketRepo = new MarketDataRepo(marketDb);
  const btDb = await openBacktestDb(path.join(process.cwd(), 'backtest.db'));
  const btRepo = new BacktestRepo(btDb);

  const summaries = [];
  try {
    for (const cell of cells) {
      const candles = await marketRepo.getCandles(cell.symbol, cell.tf, from, to);
      if (candles.length < lookback + 2) {
        console.warn(`[matrix] SKIP ${cell.symbol} ${cell.tf}: ${candles.length} candles (< ${lookback + 2}). Download more first.`);
        continue;
      }
      const spec = await marketRepo.getContractSpec(cell.symbol);
      const settings = loadRiskProfile(cell.riskId);
      const mmr = args.mmr != null ? Number(args.mmr) : (spec && spec.mmr != null ? spec.mmr : null);
      const guardrails = riskProfileToGuardrails(settings, { leverage, mmr });
      const costs = buildCosts(args, spec);

      let realRows = [];
      if (leverage > 1) {
        realRows = await marketRepo.getFunding(cell.symbol, candles[0].time, candles[candles.length - 1].time);
      }

      const label = `${cell.logicType}/${cell.riskId} ${cell.symbol} ${cell.tf}`;
      const { metrics } = await runOne(btRepo, {
        label, logicType: cell.logicType, symbol: cell.symbol, tf: cell.tf,
        lookback, leverage, candles, spec, realRows, guardrails, costs,
        fundingMode, fundingRate, group,
      });
      summaries.push({ ...cell, leverage, metrics });
    }
  } finally {
    await marketDb.close();
    await btDb.close();
  }

  const report = buildReport(summaries);
  console.log(report.table);

  const outDir = path.join(process.cwd(), 'backtest', 'reports');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${group}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ group, generatedAt: Date.now(), dims, leverage, rows: report.rows }, null, 2));
  console.log(`\n[matrix] ${summaries.length}/${cells.length} cells completed. Report: ${outFile}`);
}

// Run only when invoked directly (Windows-safe).
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch(e => { console.error('[run-matrix] FAILED:', e.message); process.exit(1); });
}
