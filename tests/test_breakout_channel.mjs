// tests/test_breakout_channel.mjs
// Regression: the breakout channel must be built from the bars BEFORE the current
// (forming) bar. Including the current bar makes its own high/low bound the close, so
// `price > top` / `price < bottom` is mathematically impossible → 0 signals → 0 trades.
import assert from 'node:assert';
import Breakout from '../src/indicators/breakout.js';
import { deriveSignal } from '../src/core/SignalAdapter.js';
import { SIDE } from '../src/core/contracts.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

const HOUR = 3600000;
const mk = (t, o, h, l, c, v = 10) => ({ time: t, open: o, high: h, low: l, close: c, volume: v });

// Base series: 100 oscillating warmup bars (seed length_=100 + lift recent avg volatility)
// then a 14-bar tight shelf at 100 (high 100.3 / low 99.7). A calm "current" bar is appended
// per-case. The shelf is the prior-14 window for the current bar.
function base() {
  const c = [];
  for (let i = 0; i < 100; i++) {
    const mid = 100 + Math.sin(i / 3) * 1.5;
    c.push(mk(i * HOUR, mid, mid + 1.0, mid - 1.0, mid));
  }
  for (let i = 100; i < 114; i++) c.push(mk(i * HOUR, 100, 100.3, 99.7, 100));
  return c;
}
const decide = (candles) => {
  const ch = Breakout.execute(candles, { length_: 100, length: 14 });
  const price = candles[candles.length - 1].close;
  return { ch, sig: deriveSignal('BREAKOUT', { channel: ch }, { price, candles }) };
};

// --- upside breakout: current close pokes above the prior-14 high in a low-vol regime ---
{
  const c = base();
  // calm small bar (range 100.0–100.6) closing at 100.5, just above the shelf high 100.3
  c.push(mk(114 * HOUR, 100.1, 100.6, 100.0, 100.5));
  const { ch, sig } = decide(c);
  assert.strictEqual(ch.active, true, 'channel active (squeeze reached)');
  // top must be the PRIOR-14 high (the shelf = 100.3), NOT the current bar high (100.6)
  assert.strictEqual(ch.top, 100.3, 'top excludes current bar → prior-14 high');
  assert.strictEqual(sig.side, SIDE.BUY, 'close above prior-14 high → BUY');
  ok('upside breakout fires BUY (top excludes current bar)');
}

// --- downside breakout: current close pokes below the prior-14 low ---
{
  const c = base();
  // calm small bar (range 99.4–100.0) closing at 99.5, just below the shelf low 99.7
  c.push(mk(114 * HOUR, 99.9, 100.0, 99.4, 99.5));
  const { ch, sig } = decide(c);
  assert.strictEqual(ch.active, true, 'channel active (squeeze reached)');
  assert.strictEqual(ch.bottom, 99.7, 'bottom excludes current bar → prior-14 low');
  assert.strictEqual(sig.side, SIDE.SELL, 'close below prior-14 low → SELL');
  ok('downside breakout fires SELL (bottom excludes current bar)');
}

// --- no false positive: current close inside the prior-14 range → HOLD ---
{
  const c = base();
  c.push(mk(114 * HOUR, 100.0, 100.2, 99.8, 100.0)); // inside shelf
  const { sig } = decide(c);
  assert.strictEqual(sig.side, SIDE.HOLD, 'price inside channel → HOLD');
  ok('inside-channel stays HOLD (no false signal)');
}

console.log(`\n${passed} checks passed`);
