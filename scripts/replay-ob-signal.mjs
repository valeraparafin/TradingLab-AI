// scripts/replay-ob-signal.mjs
// Offline replay: recorded SP1 JSONL + candles → breakout signals (no live wiring, no orders).
// Usage: node scripts/replay-ob-signal.mjs --fut <fut.jsonl> --candles <ohlc.json> [--spot <spot.jsonl>] [--symbol SYM]
import fs from 'node:fs';
import { framesToSnapshots, replaySignals } from '../src/marketdata/orderbook/replaySignals.js';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const futFile = arg('fut');
const spotFile = arg('spot');           // optional
const candlesFile = arg('candles');
const symbol = arg('symbol', 'UNKNOWN');

if (!futFile || !candlesFile) {
  console.error('usage: node scripts/replay-ob-signal.mjs --fut <fut.jsonl> --candles <ohlc.json> [--spot <spot.jsonl>] [--symbol SYM]');
  process.exit(1);
}

const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

let frames = readJsonl(futFile);
if (spotFile) frames = frames.concat(readJsonl(spotFile));
frames.sort((a, b) => a.t - b.t);

const candles = JSON.parse(fs.readFileSync(candlesFile, 'utf8'));
const snapshots = framesToSnapshots(frames, { symbol });
const signals = replaySignals(snapshots, candles);

console.log(`symbol=${symbol} frames=${frames.length} snapshots=${snapshots.length} signals=${signals.length}`);
for (const s of signals) {
  console.log(`${new Date(s.ts).toISOString()} ${s.side} conv=${s.conviction.toFixed(2)} :: ${s.rationale}`);
}
