// scripts/run-ob-engine.mjs
// Standalone Layer-1 runner: live OB engine over a symbol set, thinned recording + signal/outcome
// log under data/orderbook/. Watch data/orderbook/signals/<day>.jsonl grow. Layer 2 wires this into
// /ai; this script just accumulates the validation dataset while it runs.
// Usage: node scripts/run-ob-engine.mjs --symbols SUIUSDT,GPSUSDT --base 5m --htfStep 1 --imb 0.10
import { OrderBookFeed } from '../src/marketdata/orderbook/OrderBookFeed.js';
import { LiveObEngine } from '../src/marketdata/orderbook/liveObEngine.js';
import { toolRegistry } from '../src/registry/ToolRegistry.js';

function arg(name, def) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; }

const symbols = arg('symbols', 'SUIUSDT,GPSUSDT,TONUSDT,WIFUSDT,WLDUSDT').split(',').map((s) => s.trim()).filter(Boolean);
const baseTf = arg('base', '5m');
const htfStep = Number(arg('htfStep', '1'));
const imbThresh = Number(arg('imb', '0.10'));

const feed = new OrderBookFeed({ symbols: symbols.map((s) => ({ futures: s, spot: s })), record: false });
// ToolRegistry.get_candles accepts { symbol, interval, limit } — NOT { symbol, timeframe, limit }.
// The `interval` key maps through an intervalMap inside ToolRegistry before hitting Binance.
const candlesProvider = async (sym, tf) => {
  const res = await toolRegistry.executeTool('get_candles', { symbol: sym, interval: tf, limit: 50 });
  return res.success ? res.data : [];
};

const engine = new LiveObEngine({ feed, candlesProvider, symbols, opts: { baseTf, htfStep, imbThresh, record: true } });
engine.start();
console.log(`[ob-engine] live on ${symbols.join(', ')} | base=${baseTf} htfStep=${htfStep} imb=${imbThresh}`);

setInterval(() => {
  const stats = engine.getStats();
  for (const s of symbols) {
    const st = stats[s];
    console.log(`  ${s} ticks=${st.ticks} signals=${st.signals} resolved=${st.resolved} wins=${st.wins} netBpsSum=${st.netBpsSum.toFixed(1)}`);
  }
}, 30_000);

process.on('SIGINT', () => { engine.stop(); console.log('\n[ob-engine] stopped.'); process.exit(0); });
