// scripts/sweep-ob-thresholds.mjs
// Pooled threshold sweep for the order-book breakout edge: replay recorded L2 across a basket at a
// grid of imbalance/aggressor thresholds, score forward outcome net of costs. Answers "which
// selectivity fires enough AND stays positive after costs". No live wiring, no orders.
// Usage:
//   node scripts/sweep-ob-thresholds.mjs --symbols SUIUSDT,GPSUSDT,TONUSDT,WIFUSDT,WLDUSDT
//       [--horizon 60] [--minVel 0.2] [--costBps 5] [--imb 0.03,0.06,0.10,0.15] [--agg 0.03,0.10,0.15]
import fs from 'node:fs';
import { framesToSnapshots, replaySignals } from '../src/marketdata/orderbook/replaySignals.js';
import { scoreSignals } from '../src/marketdata/orderbook/replayScore.js';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
const nums = (s) => s.split(',').map((x) => Number(x.trim())).filter((x) => !Number.isNaN(x));

const symbols = arg('symbols', 'SUIUSDT,GPSUSDT,TONUSDT,WIFUSDT,WLDUSDT').split(',').map((s) => s.trim()).filter(Boolean);
const horizonMs = Number(arg('horizon', '60')) * 1000;
const minVelocity = Number(arg('minVel', '0.2'));
const costBps = Number(arg('costBps', '5'));
const imbGrid = nums(arg('imb', '0.03,0.06,0.10,0.15'));
const aggGrid = nums(arg('agg', '0.03,0.10,0.15'));

const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

// Build snapshots + candles once per symbol (the expensive part), reuse across the grid.
const data = [];
for (const s of symbols) {
  const futF = `data/orderbook/${s}/fut/2026-06-14.jsonl`;
  if (!fs.existsSync(futF)) { console.error(`skip ${s}: no fut data`); continue; }
  let frames = readJsonl(futF);
  const spotF = `data/orderbook/${s}/spot/2026-06-14.jsonl`;
  if (fs.existsSync(spotF)) frames = frames.concat(readJsonl(spotF));
  frames.sort((a, b) => a.t - b.t);
  const snaps = framesToSnapshots(frames, { symbol: s });
  const candles = JSON.parse(fs.readFileSync(`data/orderbook/${s}/candles-1m.json`, 'utf8'));
  data.push({ s, snaps, candles });
}

const span = data.reduce((m, d) => Math.max(m, d.snaps.length ? (d.snaps[d.snaps.length - 1].ts - d.snaps[0].ts) / 60000 : 0), 0);
console.log(`pooled sweep | symbols=${data.map((d) => d.s).join(',')} | span~${span.toFixed(0)}min h=${horizonMs / 1000}s minVel=${minVelocity} costBps=${costBps}`);
console.log('imb   agg   |  signals  resolved  hitRate  avgNetBps');
for (const imbThresh of imbGrid) {
  for (const aggThresh of aggGrid) {
    let nSig = 0, wins = 0, resolved = 0, sum = 0;
    for (const d of data) {
      const sigs = replaySignals(d.snaps, d.candles, { rolling: true, signal: { imbThresh, aggThresh, minVelocity } });
      const r = scoreSignals(d.snaps, sigs, { horizonMs, costBps });
      nSig += sigs.length; wins += r.wins; resolved += r.resolved; sum += r.totalNetBps;
    }
    const hr = resolved ? (wins / resolved * 100) : 0;
    const avg = resolved ? (sum / resolved) : 0;
    console.log(`${imbThresh.toFixed(2)}  ${aggThresh.toFixed(2)}  |  ${String(nSig).padStart(6)}  ${String(resolved).padStart(7)}  ${hr.toFixed(0).padStart(6)}%  ${avg.toFixed(1).padStart(8)}`);
  }
}
