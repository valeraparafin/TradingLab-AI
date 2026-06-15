// tests/test_live_ob_engine_record.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LiveObEngine } from '../src/marketdata/orderbook/liveObEngine.js';

let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'obrec-'));

let trades = [{ t: 100, p: 1.5, q: 10, m: false }];
const feed = {
  start() {}, stop() {},
  getFeatures: () => ({ ready: true, ts: 1000, symbol: 'SUIUSDT', futures: { mid: 1.5, imbalance: 0.2, spread: 0.0001, microprice: 1.5, aggressorImbalance: 0.2, printVelocity: 2 }, spot: null }),
  getRawBooks: () => ({ fut: { bids: [['1.49', '10']], asks: [['1.51', '8']] }, spot: null, trades }),
};
const engine = new LiveObEngine({
  feed, candlesProvider: async () => [], symbols: ['SUIUSDT'],
  opts: { record: true, recorderRoot: root },
});

engine._recordTick('SUIUSDT');
const day = new Date(1000).toISOString().slice(0, 10);
const file = path.join(root, 'SUIUSDT', 'fut', `${day}.jsonl`);
let lines = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
assert.ok(lines.some((l) => l.k === 'obsnap'), 'obsnap written'); ok('obsnap frame written');
assert.ok(lines.some((l) => l.k === 'trade' && l.p === 1.5), 'trade written'); ok('new trade written');

// Second tick with no new trades -> obsnap added, trade NOT duplicated.
engine._recordTick('SUIUSDT');
lines = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
assert.equal(lines.filter((l) => l.k === 'trade').length, 1); ok('trade not duplicated');
assert.equal(lines.filter((l) => l.k === 'obsnap').length, 2); ok('second obsnap added');

// A newer trade is picked up on the next tick.
trades = trades.concat([{ t: 200, p: 1.52, q: 5, m: true }]);
engine._recordTick('SUIUSDT');
lines = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
assert.equal(lines.filter((l) => l.k === 'trade').length, 2); ok('new trade picked up');

engine.stop();
console.log(`\n${p} checks passed`);
