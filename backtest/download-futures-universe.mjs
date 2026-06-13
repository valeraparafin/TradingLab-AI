// backtest/download-futures-universe.mjs
// Select the top-N alt USDⓈ-M perps by 24h quote volume (+ 6 majors) and download 5m+15m klines.
import path from 'path';
import { openMarketDb } from '../src/data/marketDataSchema.js';
import { MarketDataRepo } from '../src/data/MarketDataRepo.js';
import { downloadCandles } from '../src/data/marketDataFetch.js';
import { verifyCandles, parseArgs } from './download-data.js';

const MAJORS = ['BTCUSDT', 'ETHUSDT', 'LTCUSDT', 'SOLUSDT', 'XLMUSDT', 'XRPUSDT'];
const STABLE_BASES = ['USDC', 'FDUSD', 'TUSD', 'DAI', 'BUSD'];

async function topAltPerps(n) {
  const res = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
  if (!res.ok) throw new Error(`fapi 24hr HTTP ${res.status}`);
  const rows = await res.json();
  return rows
    .filter(r => r.symbol.endsWith('USDT'))
    .filter(r => !STABLE_BASES.some(s => r.symbol.startsWith(s)))
    .filter(r => !MAJORS.includes(r.symbol))
    .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))
    .slice(0, n)
    .map(r => r.symbol);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const n = args.n ? Number(args.n) : 30;
  const from = args.from ? Date.parse(args.from) : Date.parse('2024-06-01');
  const tfs = String(args.tfs || '5m,15m').split(',').map(s => s.trim());
  const alts = await topAltPerps(n);
  const symbols = [...alts, ...MAJORS];
  console.log(`[universe] ${alts.length} alts + ${MAJORS.length} majors; tfs=${tfs.join(',')}`);

  const db = await openMarketDb(path.join(process.cwd(), 'market_data.db'));
  const repo = new MarketDataRepo(db);
  for (const symbol of symbols) {
    for (const tf of tfs) {
      try {
        const added = await downloadCandles(repo, { symbol, timeframe: tf, from, market: 'futures' });
        const v = await verifyCandles(repo, symbol, tf);
        console.log(`[dl] ${symbol} ${tf}: +${added} (total ${v.count}, gaps ${v.gaps.length})`);
      } catch (e) {
        console.warn(`[dl] ERROR ${symbol} ${tf}: ${e.message}`);
      }
    }
  }
  await db.close();
  // Persist the selected alt list for the scout to read.
  const fs = await import('fs');
  fs.writeFileSync(path.join(process.cwd(), 'backtest', 'bplus-universe.json'),
    JSON.stringify({ generatedAt: Date.now(), alts, majors: MAJORS }, null, 2));
  console.log('[universe] wrote backtest/bplus-universe.json');
}
main().catch(e => { console.error(e); process.exit(1); });
