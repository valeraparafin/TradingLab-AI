// Maker/reversion test: fade EXTREME cumulative order-flow, hold to reversion, net of cost.
// Hypothesis (from ob-probe persistence): strong sustained aggressor flow OVERSHOOTS and reverts
// at ~1-2 min, so a passive fader (post limit AGAINST the flow) collects the reversion.
// T-Bank reality: no maker rebate -> round-trip commission ~8 bps applies regardless. Reversion
// must clear that. VWAP-per-bin proxy (a real maker fills BETTER than VWAP, but adverse selection
// cuts the other way -> treat VWAP as neutral). One in-session day, in-sample -> existence probe.
import fs from 'node:fs';

const COST_BPS = 8; // round-trip commission (4 bps/side, no maker rebate on T-Bank)
const BIN_MS = 10000;

function load(f) {
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  const t = d.trades.map(x => ({ ts: Date.parse(x.time), p: +x.price.value, q: +x.quantity, s: x.direction === 'TRADE_DIRECTION_BUY' ? 1 : -1 }));
  t.sort((a, b) => a.ts - b.ts);
  return t;
}

function bins(trades, binMs) {
  const t0 = trades[0].ts;
  const m = new Map();
  for (const t of trades) {
    const k = Math.floor((t.ts - t0) / binMs);
    let b = m.get(k); if (!b) { b = { sv: 0, tv: 0, pv: 0 }; m.set(k, b); }
    b.sv += t.s * t.q; b.tv += t.q; b.pv += t.p * t.q;
  }
  const keys = [...m.keys()].sort((a, b) => a - b);
  return keys.map(k => { const b = m.get(k); return { k, ofi: b.sv / b.tv, vwap: b.pv / b.tv, tv: b.tv }; });
}

// Non-overlapping fade events. signal = mean OFI over last W bins; enter contrarian when |sig|>thr; exit after H bins.
function fade(B, W, H, thr) {
  // index by contiguous k
  const byK = new Map(B.map(b => [b.k, b]));
  const trades = [];
  let i = 0;
  const ks = B.map(b => b.k);
  for (let p = 0; p < ks.length; p++) {
    const k = ks[p];
    // window [k-W, k-1] and forward [k, k+H] must be contiguous
    let ok = true;
    for (let j = k - W; j <= k + H; j++) if (!byK.has(j)) { ok = false; break; }
    if (!ok) continue;
    let sv = 0, tv = 0;
    for (let j = k - W; j < k; j++) { const b = byK.get(j); sv += b.ofi * b.tv; tv += b.tv; }
    const sig = sv / (tv || 1);
    if (Math.abs(sig) < thr) continue;
    const entry = byK.get(k).vwap, exit = byK.get(k + H).vwap;
    const dir = -Math.sign(sig); // FADE
    const gross = dir * (exit - entry) / entry * 1e4;
    trades.push({ k, sig, gross, net: gross - COST_BPS });
    // skip ahead past the hold to avoid overlap
    const nextK = k + H;
    while (p + 1 < ks.length && ks[p + 1] <= nextK) p++;
  }
  return trades;
}

function stat(a) { if (!a.length) return { n: 0 }; const s = a.reduce((x, y) => x + y, 0); const m = s / a.length; const sd = Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); return { n: a.length, mean: m, sd, sum: s }; }

const FILES = process.argv.slice(2);
const sym = (f) => f.match(/get_last_trades-(\d+)/)?.[1] || f;
console.log(`COST=${COST_BPS}bps  bin=${BIN_MS/1000}s`);
for (const f of FILES) {
  const B = bins(load(f), BIN_MS);
  console.log(`\n=== ${sym(f)}  bins=${B.length} ===`);
  console.log('  W(s)  H(s)  thr   n   gross_bps  net_bps  hit%   total_net');
  for (const W of [3, 6]) for (const H of [6, 12, 18]) for (const thr of [0.2, 0.35, 0.5]) {
    const tr = fade(B, W, H, thr);
    if (tr.length < 3) continue;
    const g = stat(tr.map(t => t.gross)), nt = stat(tr.map(t => t.net));
    const hit = tr.filter(t => t.net > 0).length / tr.length * 100;
    console.log(`  ${String(W*10).padStart(3)}  ${String(H*10).padStart(4)}  ${thr.toFixed(2)}  ${String(tr.length).padStart(3)}   ${g.mean.toFixed(2).padStart(7)}   ${nt.mean.toFixed(2).padStart(6)}  ${hit.toFixed(0).padStart(3)}   ${nt.sum.toFixed(0).padStart(6)}`);
  }
}
