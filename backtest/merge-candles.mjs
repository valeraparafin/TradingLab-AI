// Incremental candle maintenance for the DONCHIANTREND sandbox forward-test.
// Avoids re-pulling 14 months of daily bars every run: the routine fetches only the
// recent tail and this script merges it into the master history, dedup by `time`.
//
//   node backtest/merge-candles.mjs from
//     -> prints ONE ISO-UTC date to use as `from` for every invest_get_candles call:
//        (latest COMPLETE bar across the universe) - OVERLAP_DAYS, or ~400d ago if empty.
//        Overlap re-pulls a few recent bars so a previously in-progress bar gets its
//        final values and any late exchange revision is picked up.
//
//   node backtest/merge-candles.mjs            (or: merge)
//     -> merges every data/live-candles/_incoming/{SYM}.json into the master
//        data/live-candles/{SYM}.json (incoming wins on equal `time`), sorts by time,
//        writes back, removes the consumed _incoming file. Pure/deterministic, no network.
import fs from 'node:fs';
import path from 'node:path';

const DIR = 'data/live-candles';
const INCOMING = path.join(DIR, '_incoming');
const OVERLAP_DAYS = 5;
const BOOTSTRAP_DAYS = 400;

const readCandles = (file) => {
  if (!fs.existsSync(file)) return [];
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return raw.candles || raw || [];
};

function cmdFrom() {
  let latestComplete = -Infinity;
  if (fs.existsSync(DIR)) {
    for (const f of fs.readdirSync(DIR)) {
      if (!f.endsWith('.json')) continue;
      for (const c of readCandles(path.join(DIR, f))) {
        if (c.isComplete === false) continue;
        const t = Date.parse(c.time);
        if (Number.isFinite(t) && t > latestComplete) latestComplete = t;
      }
    }
  }
  const fromMs = latestComplete > 0
    ? latestComplete - OVERLAP_DAYS * 864e5
    : Date.now() - BOOTSTRAP_DAYS * 864e5;
  process.stdout.write(new Date(fromMs).toISOString());
}

function cmdMerge() {
  if (!fs.existsSync(INCOMING)) { console.log('no _incoming dir — nothing to merge'); return; }
  const files = fs.readdirSync(INCOMING).filter((f) => f.endsWith('.json'));
  if (!files.length) { console.log('no incoming files'); return; }
  for (const f of files) {
    const sym = f.replace(/\.json$/, '');
    const master = path.join(DIR, f);
    const incoming = readCandles(path.join(INCOMING, f));
    const byTime = new Map();
    for (const c of readCandles(master)) byTime.set(c.time, c);
    let added = 0, updated = 0;
    for (const c of incoming) {
      if (!c || !c.time) continue;
      (byTime.has(c.time) ? () => updated++ : () => added++)();
      byTime.set(c.time, c); // incoming is fresher — wins
    }
    const merged = [...byTime.values()].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
    fs.writeFileSync(master, JSON.stringify({ candles: merged }));
    fs.rmSync(path.join(INCOMING, f));
    console.log(`${sym.padEnd(6)} +${added} new, ${updated} updated -> ${merged.length} bars (last ${merged.at(-1)?.time})`);
  }
}

const mode = process.argv[2] || 'merge';
if (mode === 'from') cmdFrom();
else cmdMerge();
