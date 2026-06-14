// scripts/score-ob-signal.mjs
// Offline edge test: recorded SP1 JSONL + candles → rolling-level breakout signals → forward-outcome
// score at several horizons, net of a cost assumption. No live wiring, no orders. This is the
// go/no-go number for the order-book pivot.
// Usage:
//   node scripts/score-ob-signal.mjs --fut <fut.jsonl> --candles <ohlc.json> [--spot <spot.jsonl>]
//       [--symbol SYM] [--horizons 30,60,300] [--costBps 5] [--static]
import fs from 'node:fs';
import { framesToSnapshots, replaySignals } from '../src/marketdata/orderbook/replaySignals.js';
import { scoreSignals } from '../src/marketdata/orderbook/replayScore.js';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
const has = (name) => process.argv.includes(`--${name}`);

const futFile = arg('fut');
const spotFile = arg('spot');
const candlesFile = arg('candles');
const symbol = arg('symbol', 'UNKNOWN');
const horizons = arg('horizons', '30,60,300').split(',').map((s) => Number(s.trim())).filter((n) => n > 0);
const costBps = Number(arg('costBps', '5'));
const rolling = !has('static'); // rolling level by default; --static for the SP2a single-level behavior

if (!futFile || !candlesFile) {
  console.error('usage: node scripts/score-ob-signal.mjs --fut <fut.jsonl> --candles <ohlc.json> [--spot <spot.jsonl>] [--symbol SYM] [--horizons 30,60,300] [--costBps 5] [--static]');
  process.exit(1);
}

const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

let frames = readJsonl(futFile);
if (spotFile && fs.existsSync(spotFile)) frames = frames.concat(readJsonl(spotFile));
frames.sort((a, b) => a.t - b.t);

const candles = JSON.parse(fs.readFileSync(candlesFile, 'utf8'));
const snapshots = framesToSnapshots(frames, { symbol });
const signals = replaySignals(snapshots, candles, { rolling });

const span = snapshots.length ? (snapshots[snapshots.length - 1].ts - snapshots[0].ts) / 60000 : 0;
console.log(`symbol=${symbol} level=${rolling ? 'rolling' : 'static'} frames=${frames.length} snapshots=${snapshots.length} span=${span.toFixed(0)}min signals=${signals.length} costBps=${costBps}`);

if (signals.length) {
  const buys = signals.filter((s) => s.side === 'BUY').length;
  console.log(`  sides: BUY=${buys} SELL=${signals.length - buys}`);
}

for (const hSec of horizons) {
  const r = scoreSignals(snapshots, signals, { horizonMs: hSec * 1000, costBps });
  console.log(
    `  h=${String(hSec).padStart(4)}s  resolved=${String(r.resolved).padStart(3)}/${r.n}` +
    `  hitRate=${(r.hitRate * 100).toFixed(0).padStart(3)}%` +
    `  avgNet=${r.avgNetBps.toFixed(1).padStart(7)}bps` +
    `  totalNet=${r.totalNetBps.toFixed(0).padStart(7)}bps`
  );
}
