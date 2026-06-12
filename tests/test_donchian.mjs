// tests/test_donchian.mjs
import assert from 'node:assert';
import { Technicals } from '../src/indicators/technical.js';
import DonchianTrend from '../src/indicators/donchianTrend.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };
const mk = (h, l) => ({ time: 0, open: l, high: h, low: l, close: (h + l) / 2, volume: 1 });

// --- donchian: latest highest-high / lowest-low over the last `period` candles ---
{
  const candles = [mk(10, 5), mk(12, 6), mk(11, 4), mk(13, 7)];
  const ch = Technicals.donchian(candles, 3); // last 3: highs 12,11,13 lows 6,4,7
  assert.strictEqual(ch.upper, 13, 'upper = max high of last 3');
  assert.strictEqual(ch.lower, 4, 'lower = min low of last 3');
  ok('donchian latest channel over last period candles');
}

// --- donchian: null when fewer than `period` candles ---
{
  assert.strictEqual(Technicals.donchian([mk(10, 5)], 3), null, 'null below period');
  ok('donchian null when insufficient candles');
}

const bar = (h, l, c) => ({ time: 0, open: c, high: h, low: l, close: c, volume: 1 });

// --- breakout above prior 20-bar high → BUY ---
{
  const candles = [];
  for (let i = 0; i < 20; i++) candles.push(bar(100, 95, 98)); // prior channel high = 100
  candles.push(bar(102, 99, 101));                              // close 101 > 100 → BUY
  const raw = DonchianTrend.execute(candles, { indicators: { entryLookback: 20 } });
  assert.strictEqual(raw.side, 'BUY', `close above prior high → BUY (got ${raw.side})`);
  ok('donchian breakout up → BUY');
}

// --- breakdown below prior 20-bar low → SELL ---
{
  const candles = [];
  for (let i = 0; i < 20; i++) candles.push(bar(100, 95, 98)); // prior channel low = 95
  candles.push(bar(96, 90, 94));                               // close 94 < 95 → SELL
  const raw = DonchianTrend.execute(candles, { indicators: { entryLookback: 20 } });
  assert.strictEqual(raw.side, 'SELL', `close below prior low → SELL (got ${raw.side})`);
  ok('donchian breakdown → SELL');
}

// --- inside the channel → HOLD ---
{
  const candles = [];
  for (let i = 0; i < 20; i++) candles.push(bar(100, 95, 98));
  candles.push(bar(99, 96, 98));                               // close 98 inside [95,100] → HOLD
  const raw = DonchianTrend.execute(candles, { indicators: { entryLookback: 20 } });
  assert.strictEqual(raw.side, 'HOLD', `close inside channel → HOLD (got ${raw.side})`);
  ok('donchian inside channel → HOLD');
}

// --- not enough candles → HOLD ---
{
  const raw = DonchianTrend.execute([bar(100, 95, 98)], { indicators: { entryLookback: 20 } });
  assert.strictEqual(raw.side, 'HOLD', 'insufficient candles → HOLD');
  ok('donchian insufficient candles → HOLD');
}

console.log(`\n${passed} passed`);
