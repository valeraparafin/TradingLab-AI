// scripts/fetch-candles.mjs
// Throwaway helper: fetch recent Binance FUTURES 1m klines for the replay harness.
// Writes data/orderbook/<sym>/candles-<interval>.json as [{time,open,high,low,close,volume}].
// Usage: node scripts/fetch-candles.mjs --symbols SUIUSDT,GPSUSDT --interval 1m --limit 120
import fs from 'node:fs';
import path from 'node:path';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const symbols = arg('symbols', 'SUIUSDT').split(',').map((s) => s.trim()).filter(Boolean);
const interval = arg('interval', '1m');
const limit = Number(arg('limit', '120'));

for (const sym of symbols) {
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`${sym}: HTTP ${res.status}`);
    continue;
  }
  const raw = await res.json();
  const candles = raw.map((k) => ({
    time: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5],
  }));
  const dir = path.join('data', 'orderbook', sym);
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `candles-${interval}.json`);
  fs.writeFileSync(out, JSON.stringify(candles));
  console.log(`${sym}: ${candles.length} ${interval} candles → ${out}`);
}
