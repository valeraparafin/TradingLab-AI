import assert from 'assert';
import { findPivots } from '../src/indicators/pivots.js';

const tests = [];
const add = (name, fn) => tests.push({ name, fn });

function makeCandles(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const base = 100 + i * 0.25 + Math.sin(i / 13) * 8;
    out.push({ open: base - 1, high: base + 2, low: base - 2, close: base, volume: 1000 });
  }
  return out;
}

function referenceFindPivots(candles, length) {
  const pivots = { high: [], low: [] };
  for (let i = length; i < candles.length - length; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - length; j <= i + length; j++) {
      if (i === j) continue;
      if (candles[j].high > candles[i].high) isHigh = false;
      if (candles[j].low < candles[i].low) isLow = false;
    }
    if (isHigh) pivots.high.push({ index: i, price: candles[i].high });
    if (isLow) pivots.low.push({ index: i, price: candles[i].low });
  }
  return pivots;
}

add('findPivots matches reference for length 20', () => {
  const c = makeCandles(250);
  assert.deepStrictEqual(findPivots(c, 20), referenceFindPivots(c, 20));
});

add('findPivots matches reference for length 2', () => {
  const c = makeCandles(60);
  assert.deepStrictEqual(findPivots(c, 2), referenceFindPivots(c, 2));
});

let failed = 0;
for (const t of tests) {
  try { t.fn(); console.log(`PASS ${t.name}`); }
  catch (e) { failed++; console.error(`FAIL ${t.name}\n   ${e.message}`); }
}
if (failed) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
console.log('\nAll pivots tests passed!');
