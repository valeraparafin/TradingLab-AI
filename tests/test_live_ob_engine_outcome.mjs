// tests/test_live_ob_engine_outcome.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LiveObEngine } from '../src/marketdata/orderbook/liveObEngine.js';

let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'obout-'));
let mid = 100;
const feed = {
  start() {}, stop() {},
  getFeatures: () => ({ ready: true, ts: 1000, symbol: 'SUIUSDT', futures: { mid, spread: 0.01, imbalance: 0.5, microprice: mid, aggressorImbalance: 0.5, printVelocity: 3 }, spot: null }),
  getRawBooks: () => ({ fut: { bids: [], asks: [] }, spot: null, trades: [] }),
};

// Synchronous schedule stub: capture the callback so the test fires it after moving the price.
let fire = null;
const schedule = (cb) => { fire = cb; return 0; };

const engine = new LiveObEngine({
  feed, candlesProvider: async () => [], symbols: ['SUIUSDT'],
  opts: { record: true, recorderRoot: root, signalsRoot: path.join(root, 'signals'), horizonMs: 60000, costBps: 5 },
  schedule,
});
engine.setLevel('SUIUSDT', { resistance: 100, support: 98, coiled: false });

engine._evaluate('SUIUSDT');          // seed prevMid (mid=100)
mid = 100.5;                          // cross above 100
engine._evaluate('SUIUSDT');          // PERMIT -> signal logged + outcome scheduled

const day = new Date(1000).toISOString().slice(0, 10);
const sigFile = path.join(root, 'signals', `${day}.jsonl`);
let lines = fs.readFileSync(sigFile, 'utf8').trim().split('\n').map(JSON.parse);
assert.ok(lines.some((l) => l.type === 'signal' && l.side === 'BUY'), 'signal logged'); ok('signal line written');

// Move price up, fire the horizon callback -> outcome line + stats update.
mid = 101;
assert.ok(typeof fire === 'function', 'outcome scheduled'); ok('outcome scheduled');
fire();
lines = fs.readFileSync(sigFile, 'utf8').trim().split('\n').map(JSON.parse);
const outcome = lines.find((l) => l.type === 'outcome');
assert.ok(outcome && outcome.netBps > 0, 'positive net bps outcome'); ok('outcome line written, net bps > 0');
assert.equal(engine.getStats().SUIUSDT.resolved, 1); ok('stats resolved incremented');
assert.equal(engine.getStats().SUIUSDT.wins, 1); ok('stats wins incremented');

engine.stop();
console.log(`\n${p} checks passed`);
