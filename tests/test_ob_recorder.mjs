import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Recorder, frameLine } from '../src/marketdata/orderbook/Recorder.js';
let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

// frameLine is pure: stamps t + serializes to one JSON line
const line = frameLine(1718380000123, 'GPSUSDT', 'fut', { k: 'trade', p: '0.0075', q: '14000', m: false });
const parsed = JSON.parse(line);
assert.strictEqual(parsed.t, 1718380000123, 'timestamp'); ok('frame t');
assert.strictEqual(parsed.sym, 'GPSUSDT', 'symbol'); ok('frame sym');
assert.strictEqual(parsed.v, 'fut', 'venue'); ok('frame venue');
assert.strictEqual(parsed.k, 'trade', 'kind passthrough'); ok('frame kind');

// Recorder writes one file per symbol/venue/day under root, appending lines.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'obrec-'));
const rec = new Recorder({ root });
rec.write('GPSUSDT', 'fut', 1718380000123, { k: 'trade', p: '0.0075', q: '14000', m: false });
rec.write('GPSUSDT', 'fut', 1718380000223, { k: 'state', state: 'STALE', reason: 'seq_gap' });
rec.close();

const file = path.join(root, 'GPSUSDT', 'fut', '2024-06-14.jsonl');
assert.ok(fs.existsSync(file), 'file at symbol/venue/day path'); ok('file path');
const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
assert.strictEqual(lines.length, 2, 'two appended lines'); ok('appended');
assert.strictEqual(JSON.parse(lines[1]).state, 'STALE', 'second line content'); ok('line content');

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${p} checks passed`);
