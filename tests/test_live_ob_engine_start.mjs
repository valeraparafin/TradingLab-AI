// tests/test_live_ob_engine_start.mjs
import assert from 'node:assert';
import { LiveObEngine } from '../src/marketdata/orderbook/liveObEngine.js';

let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

// Candle provider returns a structure that yields a level via levelFromCandles (>= lookback+1 bars).
const bars = Array.from({ length: 25 }, (_, i) => ({ time: i, high: 100 + i * 0.01, low: 98, open: 99, close: 99, volume: 1 }));
let providerCalls = 0;
const feed = { started: false, start() { this.started = true; }, stop() {}, getFeatures: () => ({ ready: false }), getRawBooks: () => null };

const engine = new LiveObEngine({
  feed,
  candlesProvider: async (sym, tf) => { providerCalls++; assert.equal(tf, '15m'); return bars; },
  symbols: ['SUIUSDT'],
  opts: { baseTf: '5m', htfStep: 1, lookback: 20, record: false, tickMs: 999999, recordIntervalMs: 999999, candleRefreshMs: 999999 },
});

await engine._refreshCandles('SUIUSDT');
assert.equal(providerCalls, 1); ok('candle provider called with higher TF (15m)');
const level = engine.state.get('SUIUSDT').level;
assert.ok(level && level.resistance != null, 'level computed'); ok('level recomputed from higher-TF candles');

engine.start();
assert.equal(feed.started, true); ok('start() starts the feed');
engine.stop();
ok('stop() runs clean');

console.log(`\n${p} checks passed`);
