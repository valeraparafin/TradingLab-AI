// tests/test_pump_dump.mjs
import assert from 'node:assert';
import { isPumpDumpShort } from '../src/backtest/pumpDump.js';
let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

const bar = (h, l, c) => ({ time: 0, open: (h + l) / 2, high: h, low: l, close: c, volume: 1 });
const opts = { pumpWindow: 10, pumpPct: 0.5, dumpPct: 0.15 };

// base ~100 (bars 0-3), pump to peak 200 (bar 6), then roll over to 160 (bar 9): -20% off peak.
const dumped = [
  bar(101, 99, 100), bar(102, 99, 101), bar(101, 99, 100), bar(103, 100, 102),
  bar(140, 110, 138), bar(180, 140, 178), bar(200, 175, 198), // peak high=200 at idx6
  bar(190, 175, 185), bar(180, 165, 172), bar(170, 158, 160), // close 160
];
let r = isPumpDumpShort(dumped, opts);
assert.strictEqual(r.eligible, true, 'pumped then dumped → eligible'); ok('eligible when pumped+rolled+pulled');
assert.ok(Math.abs(r.peak - 200) < 1e-9, 'peak detected'); ok('peak');
assert.ok(r.pumpRet >= 0.5 && r.drawdown >= 0.15, 'thresholds met'); ok('thresholds');

// still pumping: peak is the LAST bar → not rolled over → ineligible
const pumping = [
  bar(101, 99, 100), bar(102, 99, 101), bar(101, 99, 100), bar(103, 100, 102),
  bar(140, 110, 138), bar(150, 140, 148), bar(160, 150, 158),
  bar(175, 160, 173), bar(185, 172, 183), bar(205, 188, 204), // peak at last idx
];
assert.strictEqual(isPumpDumpShort(pumping, opts).eligible, false, 'peak at last bar → ineligible'); ok('not rolled over → ineligible');

// pumped but only ~4% off peak → drawdown too small
const shallow = [...dumped.slice(0, 9), bar(196, 190, 192)]; // close 192 vs peak 200 = 4%
assert.strictEqual(isPumpDumpShort(shallow, opts).eligible, false, 'shallow pullback → ineligible'); ok('shallow pullback → ineligible');

// no pump (flat) → ineligible
const flat = Array.from({ length: 10 }, () => bar(101, 99, 100));
assert.strictEqual(isPumpDumpShort(flat, opts).eligible, false, 'flat → ineligible'); ok('flat → ineligible');

// too few bars → ineligible
assert.strictEqual(isPumpDumpShort(dumped.slice(0, 5), opts).eligible, false, 'short input → ineligible'); ok('short input → ineligible');

console.log(`\n${p} checks passed`);
