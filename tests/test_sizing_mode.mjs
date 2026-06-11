// tests/test_sizing_mode.mjs
import assert from 'node:assert';
import { RiskPolicy } from '../src/agents/RiskPolicy.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

const buy = { side: 'BUY', conviction: 1 };
const base = { portfolioValue: 1000, riskPerTrade: 0.5, stopLossPct: 0.02, takeProfitPct: 0.04, minRiskRewardRatio: 0, leverage: 1 };

// --- fixed (default): size uses portfolioValue regardless of equity ---
{
  const rp = new RiskPolicy({ ...base }); // no sizingMode → 'fixed'
  const d = rp.evaluate(buy, { entryPrice: 100, equity: 9999 });
  assert.strictEqual(d.decision, 'PERMIT');
  assert.strictEqual(d.order.sizeUSD, 500, 'fixed ignores ctx.equity → 1000*0.5');
  ok('fixed mode ignores equity (byte-identical)');
}

// --- compound: size uses ctx.equity ---
{
  const rp = new RiskPolicy({ ...base, sizingMode: 'compound' });
  const grown = rp.evaluate(buy, { entryPrice: 100, equity: 2000 });
  assert.strictEqual(grown.order.sizeUSD, 1000, 'compound grows with equity → 2000*0.5');
  const shrunk = rp.evaluate(buy, { entryPrice: 100, equity: 400 });
  assert.strictEqual(shrunk.order.sizeUSD, 200, 'compound shrinks with equity → 400*0.5');
  ok('compound mode scales with equity');
}

// --- compound with no ctx.equity → fallback to portfolioValue ---
{
  const rp = new RiskPolicy({ ...base, sizingMode: 'compound' });
  const d = rp.evaluate(buy, { entryPrice: 100 }); // equity absent
  assert.strictEqual(d.order.sizeUSD, 500, 'compound falls back to portfolioValue when equity absent');
  ok('compound fallback when equity absent');
}

// --- maxTradeSizeUSD caps both modes ---
{
  const rp = new RiskPolicy({ ...base, sizingMode: 'compound', maxTradeSizeUSD: 300 });
  const d = rp.evaluate(buy, { entryPrice: 100, equity: 2000 });
  assert.strictEqual(d.order.sizeUSD, 300, 'cap applies in compound mode');
  ok('maxTradeSizeUSD caps compound');
}

console.log(`\n${passed} checks passed`);
