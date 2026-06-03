import assert from 'node:assert';
import { buildFundingSeries, fundingBetween } from '../src/backtest/funding.js';

const H8 = 8 * 3600000; // 8h in ms
// Real rows at three consecutive 8h boundaries.
const real = [
  { time: 2 * H8, rate: 0.0001 },
  { time: 3 * H8, rate: 0.0003 },
  { time: 4 * H8, rate: -0.0002 }, // mean = (0.0001+0.0003-0.0002)/3 = 0.0000666...
];

// real-mean: inside coverage → exact real rate; outside → mean of real.
const rm = buildFundingSeries({ realRows: real, mode: 'real-mean' });
assert.strictEqual(rm(3 * H8), 0.0003, 'real rate used inside coverage');
const mean = (0.0001 + 0.0003 - 0.0002) / 3;
assert.ok(Math.abs(rm(100 * H8) - mean) < 1e-12, 'mean used outside coverage');
assert.ok(Math.abs(rm(0) - mean) < 1e-12, 'mean used before coverage');

// constant: explicit rate everywhere.
const cn = buildFundingSeries({ realRows: real, mode: 'constant', constantRate: 0.001 });
assert.strictEqual(cn(3 * H8), 0.001, 'constant ignores real');
assert.strictEqual(cn(99 * H8), 0.001, 'constant everywhere');

// tile: inside coverage → real; outside → cyclic repeat of the real series by boundary index.
const tl = buildFundingSeries({ realRows: real, mode: 'tile' });
assert.strictEqual(tl(2 * H8), 0.0001, 'tile inside = real');
// boundary index 5 → 5 % 3 = 2 → real[2].rate
assert.strictEqual(tl(5 * H8), -0.0002, 'tile outside cycles by boundary index');

// empty real + no constant → 0 (never NaN).
const empty = buildFundingSeries({ realRows: [], mode: 'real-mean' });
assert.strictEqual(empty(3 * H8), 0, 'empty real → 0');

// fundingBetween: sum of rates at boundaries strictly in (prev, cur].
const sum = fundingBetween(2 * H8, 4 * H8, H8, rm); // boundaries 3*H8 and 4*H8
assert.ok(Math.abs(sum - (0.0003 + -0.0002)) < 1e-12, 'sums boundaries in (prev,cur]');
assert.strictEqual(fundingBetween(2 * H8, 2 * H8 + 1, H8, rm), 0, 'no boundary crossed → 0');

console.log('test_funding.js OK');
