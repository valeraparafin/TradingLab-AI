// backtest/fetch-moex.js
//
// Phase 0 research fetcher: pulls free, public MOEX ISS historical candles into market_data.db
// so the EXISTING backtest harness can validate whether RangeFilter / SMC have any edge on
// Russian equities — BEFORE we touch the T-Bank API, tokens, or execution. No auth required.
//
//   node backtest/fetch-moex.js --symbols ALRS,SBER,GAZP --tf 1D --from 2018-01-01
//
// MOEX ISS candles endpoint returns columns [open, close, high, low, value, volume, begin, end].
// `begin` is Moscow local time ("YYYY-MM-DD HH:MM:SS"); we convert with the +03:00 offset so the
// epoch-ms `time` column is consistent. The strategy logic is TZ-agnostic (no intraday session
// rules), so a consistent offset is all that matters. Paged year-by-year (daily < 500 rows/yr).
import path from 'path';
import { fileURLToPath } from 'url';
import { openMarketDb } from '../src/data/marketDataSchema.js';
import { MarketDataRepo } from '../src/data/MarketDataRepo.js';
import { parseArgs } from './download-data.js';

// Our tf label -> MOEX ISS interval code. ISS has no native 4H (resample 1H if ever needed).
const TF_TO_INTERVAL = { '1D': 24, '1H': 60, '10m': 10, '1m': 1, '1W': 7, '1M': 31 };

const csv = (v, d) => String(v ?? d).split(',').map((s) => s.trim()).filter(Boolean);

/** Map one ISS candle row (by column index) to our schema shape. */
export function mapRow(row, col) {
  const begin = row[col.begin]; // "2024-01-03 00:00:00" Moscow
  const time = Date.parse(begin.replace(' ', 'T') + '+03:00');
  return {
    time,
    open: row[col.open],
    high: row[col.high],
    low: row[col.low],
    close: row[col.close],
    volume: row[col.volume],
  };
}

// ISS caps each candles response at 500 rows; page with the `start` cursor until a short page.
const PAGE = 500;

/** Fetch all candles for one symbol/interval from `fromDate` to now via start-cursor paging. */
async function fetchSymbol(secid, interval, fromDate) {
  const out = [];
  for (let start = 0; ; start += PAGE) {
    const url =
      `https://iss.moex.com/iss/engines/stock/markets/shares/securities/${secid}/candles.json` +
      `?from=${fromDate}&interval=${interval}&start=${start}&iss.meta=off`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ISS HTTP ${res.status} for ${secid} @${start}`);
    const j = await res.json();
    const c = j.candles;
    const col = Object.fromEntries(c.columns.map((name, i) => [name, i]));
    for (const row of c.data) out.push(mapRow(row, col));
    if (c.data.length < PAGE) break; // last page
  }
  // Dedup + sort ascending (be safe against any cursor overlap).
  const seen = new Set();
  return out
    .filter((k) => (seen.has(k.time) ? false : (seen.add(k.time), true)))
    .sort((a, b) => a.time - b.time);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const symbols = csv(args.symbols, 'ALRS,SBER,GAZP,LKOH,GMKN,ROSN,NVTK,MGNT');
  const tf = String(args.tf || '1D');
  const interval = TF_TO_INTERVAL[tf];
  if (!interval) throw new Error(`Unsupported --tf ${tf}. Use one of: ${Object.keys(TF_TO_INTERVAL).join(', ')}`);
  const fromDate = String(args.from || '2018-01-01');

  const db = await openMarketDb(path.join(process.cwd(), 'market_data.db'));
  const repo = new MarketDataRepo(db);
  try {
    for (const secid of symbols) {
      const candles = await fetchSymbol(secid, interval, fromDate);
      const inserted = await repo.upsertCandles(secid, tf, candles);
      const first = candles[0], last = candles[candles.length - 1];
      const span = first ? `${new Date(first.time).toISOString().slice(0, 10)}..${new Date(last.time).toISOString().slice(0, 10)}` : 'none';
      console.log(`  ${secid} ${tf}: fetched ${candles.length} (${span}), +${inserted} new`);
    }
  } finally {
    await db.close();
  }
  console.log('Done.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((e) => { console.error('[fetch-moex] FAILED:', e.message); process.exit(1); });
}
