// tests/test_ob_signal_log.mjs
import assert from 'node:assert';
import { signalRecord, outcomeRecord, outcomeBps } from '../src/marketdata/orderbook/obSignalLog.js';

let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

// outcomeBps: BUY winner net of cost.
const buy = outcomeBps({ entryMid: 100, exitMid: 100.5, side: 'BUY', costBps: 5 });
assert.ok(Math.abs(buy.grossBps - 50) < 1e-9, 'gross 50'); ok('BUY gross bps');
assert.ok(Math.abs(buy.netBps - 45) < 1e-9, 'net 45'); ok('BUY net bps (cost subtracted)');
assert.equal(buy.win, true); ok('BUY win flag');

// SELL: price down is a win.
const sell = outcomeBps({ entryMid: 100, exitMid: 99.5, side: 'SELL', costBps: 5 });
assert.ok(Math.abs(sell.grossBps - 50) < 1e-9, 'sell gross 50'); ok('SELL gross bps mirrored');
assert.equal(sell.win, true); ok('SELL win flag');

// signalRecord shape.
const sig = { side: 'BUY', setup: 'breakout', conviction: 0.6, rationale: 'x', invalidation: { backInsideRange: 99 } };
const sr = signalRecord({ t: 1000, sym: 'SUIUSDT', sig, entryMid: 100, level: { resistance: 99.8, support: 98 } });
assert.equal(sr.type, 'signal'); assert.equal(sr.sym, 'SUIUSDT'); assert.equal(sr.entryMid, 100);
assert.equal(sr.invalidation, 99); ok('signalRecord extracts numeric invalidation');

// outcomeRecord shape.
const or = outcomeRecord({ t: 2000, sym: 'SUIUSDT', side: 'BUY', entryMid: 100, exitMid: 100.5, horizonMs: 60000, costBps: 5 });
assert.equal(or.type, 'outcome'); assert.ok(Math.abs(or.netBps - 45) < 1e-9); assert.equal(or.win, true);
ok('outcomeRecord computes net bps');

console.log(`\n${p} checks passed`);
