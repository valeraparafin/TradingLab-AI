import assert from 'assert';
import { TF_MS, BINANCE_INTERVAL, parseCandle, candlesUrl, parseFunding, parseContract, fundingUrl, contractsUrl } from '../src/data/marketParse.js';

const tests = [];
const add = (n, fn) => tests.push({ n, fn });

add('TF_MS maps known timeframes', () => {
  assert.strictEqual(TF_MS['1H'], 3600000);
  assert.strictEqual(TF_MS['1m'], 60000);
  assert.strictEqual(TF_MS['1D'], 86400000);
});

add('BINANCE_INTERVAL maps internal tf → binance interval (lowercase)', () => {
  assert.strictEqual(BINANCE_INTERVAL['1H'], '1h');
  assert.strictEqual(BINANCE_INTERVAL['4H'], '4h');
  assert.strictEqual(BINANCE_INTERVAL['1D'], '1d');
  assert.strictEqual(BINANCE_INTERVAL['5m'], '5m');
});

add('parseCandle: Binance kline array → numeric Candle (volume = idx5)', () => {
  const k = ['1499040000000', '0.01634790', '0.80000000', '0.01575800', '0.01577100', '148976.11427815', '1499644799999', '2434.19', 308];
  const c = parseCandle(k);
  assert.deepStrictEqual(c, { time: 1499040000000, open: 0.0163479, high: 0.8, low: 0.015758, close: 0.015771, volume: 148976.11427815 });
});

add('candlesUrl builds Binance klines query (interval mapped to lowercase)', () => {
  const u = candlesUrl({ symbol: 'BTCUSDT', timeframe: '1H', limit: 1000, startTime: 123 });
  assert.ok(u.startsWith('https://api.binance.com/api/v3/klines?'), u);
  assert.ok(u.includes('symbol=BTCUSDT'));
  assert.ok(u.includes('interval=1h'));
  assert.ok(u.includes('limit=1000'));
  assert.ok(u.includes('startTime=123'));
});

add('parseFunding: BitGet object → {time, rate}', () => {
  const f = parseFunding({ symbol: 'BTCUSDT', fundingRate: '0.0001', fundingTime: '1780387200000' });
  assert.deepStrictEqual(f, { time: 1780387200000, rate: 0.0001 });
});

add('parseContract: BitGet object + mmr default → spec row', () => {
  const raw = { symbol: 'BTCUSDT', takerFeeRate: '0.0006', makerFeeRate: '0.0002', maxLever: '150', minLever: '1', fundInterval: '8', pricePlace: '1', volumePlace: '4', sizeMultiplier: '0.0001', minTradeNum: '0.0001', minTradeUSDT: '5', priceEndStep: '1' };
  const s = parseContract(raw, 0.005);
  assert.strictEqual(s.symbol, 'BTCUSDT');
  assert.strictEqual(s.mmr, 0.005);
  assert.strictEqual(s.max_leverage, 150);
  assert.strictEqual(s.taker_fee, 0.0006);
  assert.strictEqual(s.maker_fee, 0.0002);
  assert.strictEqual(s.fund_interval_h, 8);
  assert.strictEqual(s.price_precision, 1);
  assert.strictEqual(s.qty_precision, 4);
  assert.strictEqual(s.min_trade_num, 0.0001);
  assert.strictEqual(s.min_trade_usdt, 5);
  assert.ok(Math.abs(s.tick_size - 0.1) < 1e-12, `tick ${s.tick_size}`); // priceEndStep * 10^-pricePlace = 1 * 10^-1
  assert.strictEqual(s.qty_step, 0.0001);
});

add('fundingUrl + contractsUrl build expected BitGet paths', () => {
  assert.ok(fundingUrl({ symbol: 'BTCUSDT', pageSize: 100, pageNo: 1 }).includes('/api/v2/mix/market/history-fund-rate?'));
  assert.ok(contractsUrl({ symbol: 'BTCUSDT' }).includes('/api/v2/mix/market/contracts?'));
});

add('candlesUrl futures uses fapi/v1 base', () => {
  const u = candlesUrl({ symbol: 'BTCUSDT', timeframe: '5m', limit: 1000, startTime: 1, market: 'futures' });
  assert.ok(u.startsWith('https://fapi.binance.com/fapi/v1/klines?'), `futures base, got ${u}`);
});
add('candlesUrl defaults to spot api/v3', () => {
  const u = candlesUrl({ symbol: 'BTCUSDT', timeframe: '5m', limit: 1000, startTime: 1 });
  assert.ok(u.startsWith('https://api.binance.com/api/v3/klines?'), `spot default, got ${u}`);
});

let failed = 0;
for (const t of tests) { try { t.fn(); console.log(`✅ ${t.n}`); } catch (e) { failed++; console.error(`❌ ${t.n}\n   ${e.message}`); } }
if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log('\nAll marketParse tests passed!');
