// tests/test_time_stop.mjs
import assert from 'node:assert';
import { simulate } from '../src/backtest/simulator.js';
let p = 0; const ok = (n) => { console.log(`  ok - ${n}`); p++; };

// Flat market that never moves: a BUY entered must be time-stopped at breakeven-ish, not held.
const bar = (t, px) => ({ time: t, open: px, high: px * 1.0005, low: px * 0.9995, close: px, volume: 1 });
const candles = [];
for (let i = 0; i < 40; i++) candles.push(bar(i * 300000, 100));
// Force an entry via a stub decide that PERMITs a BUY once, structural-style SL below.
let fired = false;
const decide = (ctx) => {
  if (fired) return { signal: { side: 'HOLD' }, decision: { decision: 'DENY' } };
  fired = true;
  return { signal: { side: 'BUY' }, decision: { decision: 'PERMIT', order: { side: 'BUY', sizeUSD: 100, slPrice: 99, tpPrice: 200 } } };
};
const res = simulate({
  candles, config: { logicType: 'SCALPBREAKOUT' },
  guardrails: { portfolioValue: 1000, leverage: 1 },
  costs: { takerFee: 0, makerFee: 0, slippageBps: 0 },
  symbol: 'X', timeframe: '5m', lookback: 5,
  exitPolicy: { timeStopBars: 6, impulseR: 1 },
}, decide);

const ts = res.trades.find(t => t.reason === 'TIME_STOP');
assert.ok(ts, 'a TIME_STOP exit occurred'); ok('time-stop fires with no impulse');
assert.ok(Math.abs(ts.pnl) < 1e-6, 'flat market → ~breakeven pnl (no fees)'); ok('breakeven pnl');

console.log(`\n${p} checks passed`);
