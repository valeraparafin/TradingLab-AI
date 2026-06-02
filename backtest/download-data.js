import path from 'path';
import { fileURLToPath } from 'url';
import { TF_MS } from '../src/data/marketParse.js';
import { openMarketDb } from '../src/data/marketDataSchema.js';
import { MarketDataRepo } from '../src/data/MarketDataRepo.js';
import { downloadCandles, fetchFundingPage, fetchContract } from '../src/data/marketDataFetch.js';

const DEFAULT_MMR = 0.005; // single-tier MMR approximation (BitGet public API has no MMR field)

/**
 * Integrity check: detect candle gaps and obviously bad candles (non-positive prices,
 * or high < low).
 * @returns {Promise<{count:number, gaps:number[], bad:number[]}>}
 */
export async function verifyCandles(repo, symbol, timeframe) {
  const tfMs = TF_MS[timeframe];
  const rows = await repo.getCandles(symbol, timeframe, 0, Number.MAX_SAFE_INTEGER);
  const gaps = await repo.findGaps(symbol, timeframe, tfMs);
  const bad = rows
    .filter(r => !(r.open > 0 && r.high > 0 && r.low > 0 && r.close > 0) || r.high < r.low)
    .map(r => r.time);
  return { count: rows.length, gaps, bad };
}

/** Parse `--key value` / `--flag` argv into an object. */
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) { out[key] = true; }
    else { out[key] = next; i++; }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const symbols = String(args.symbol || 'BTCUSDT').split(',').map(s => s.trim()).filter(Boolean);
  const tf = String(args.tf || '1H');
  const from = args.from ? Date.parse(args.from) : Date.now() - 30 * 86400000;
  const mmr = args.mmr ? Number(args.mmr) : DEFAULT_MMR;
  const dbPath = path.join(process.cwd(), 'market_data.db');

  const db = await openMarketDb(dbPath);
  const repo = new MarketDataRepo(db);

  for (const symbol of symbols) {
    if (args.verify) {
      const r = await verifyCandles(repo, symbol, tf);
      console.log(`[verify] ${symbol} ${tf}: ${r.count} candles, ${r.gaps.length} gaps, ${r.bad.length} bad`);
      continue;
    }
    console.log(`[download] ${symbol} ${tf} candles (Binance) from ${new Date(from).toISOString()}...`);
    const n = await downloadCandles(repo, { symbol, timeframe: tf, from });
    console.log(`[download] ${symbol} ${tf}: +${n} candles`);

    const funding = await fetchFundingPage({ symbol }); // BitGet
    const fn = await repo.upsertFunding(symbol, funding);
    console.log(`[download] ${symbol} funding (BitGet): +${fn} rows`);

    const spec = await fetchContract({ symbol, mmr }); // BitGet
    await repo.upsertContractSpec(spec);
    console.log(`[download] ${symbol} spec (BitGet): leverage≤${spec.max_leverage}, takerFee ${spec.taker_fee}, mmr ${spec.mmr}`);
  }

  await db.close();
}

// Run only when invoked directly (not when imported by tests).
// fileURLToPath is Windows-safe (avoids the leading-slash "/C:/..." pathname pitfall).
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch(e => { console.error('[download-data] FAILED:', e.message); process.exit(1); });
}
