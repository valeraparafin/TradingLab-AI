import { OrderBookFeed } from '../src/marketdata/orderbook/OrderBookFeed.js';

// Usage: node scripts/record-orderbook.mjs --symbols GPSUSDT,SUIUSDT --minutes 2 [--no-spot]
function parseArgs(argv) {
  const out = { symbols: ['GPSUSDT'], minutes: 2, spot: true };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--symbols') out.symbols = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--minutes') out.minutes = Number(argv[++i]);
    else if (a === '--no-spot') out.spot = false;
  }
  return out;
}

const args = parseArgs(process.argv);
const symbols = args.symbols.map((s) => ({ futures: s, spot: args.spot ? s : null }));
const feed = new OrderBookFeed({ symbols, record: true });
feed.start();
console.log(`Recording ${args.symbols.join(', ')} for ${args.minutes} min (spot=${args.spot})...`);

const printTimer = setInterval(() => {
  for (const s of args.symbols) {
    const f = feed.getFeatures(s);
    console.log(`${s} ready=${f.ready} spotReady=${f.spotReady}`, f.futures ? { mid: f.futures.mid, imbalance: f.futures.imbalance, wallBid: f.futures.nearWallBid?.sizeUsd } : null);
  }
}, 10000);

setTimeout(() => {
  clearInterval(printTimer);
  feed.stop();
  console.log('Done. Frames written under data/orderbook/.');
  process.exit(0);
}, args.minutes * 60 * 1000);
