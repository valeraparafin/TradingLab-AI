// tests/test_stop_modes.mjs
import assert from 'node:assert';
import { RiskPolicy } from '../src/agents/RiskPolicy.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };
const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-6, `${m}: ${a} vs ${b}`);

const buy = { side: 'BUY', conviction: 1 };
const sell = { side: 'SELL', conviction: 1 };
const g = { portfolioValue: 1000, riskPerTrade: 0.1, minRiskRewardRatio: 0, leverage: 1, stopLossPct: 0.02, takeProfitPct: 0.04 };

// --- ATR mode: SL/TP are atrSL/atrTP multiples of ctx.atr, mirrored by side ---
{
  const rp = new RiskPolicy({ ...g, stopMode: 'atr', atrSL: 2, atrTP: 4 });
  const b = rp.evaluate(buy, { entryPrice: 100, atr: 5 });
  near(b.order.slPrice, 90, 'BUY atr SL = 100 - 2*5');
  near(b.order.tpPrice, 120, 'BUY atr TP = 100 + 4*5');
  const s = rp.evaluate(sell, { entryPrice: 100, atr: 5 });
  near(s.order.slPrice, 110, 'SELL atr SL = 100 + 2*5');
  near(s.order.tpPrice, 80, 'SELL atr TP = 100 - 4*5');
  ok('atr mode SL/TP mirrored by side');
}

// --- ATR mode with invalid atr → fallback to percent ---
{
  const rp = new RiskPolicy({ ...g, stopMode: 'atr', atrSL: 2, atrTP: 4 });
  const b = rp.evaluate(buy, { entryPrice: 100, atr: null });
  near(b.order.slPrice, 98, 'fallback percent SL = 100*(1-0.02)');
  near(b.order.tpPrice, 104, 'fallback percent TP = 100*(1+0.04)');
  ok('atr invalid → percent fallback');
}

// --- structural mode: SL = invalidation, TP = entry + RR*risk ---
{
  const rp = new RiskPolicy({ ...g, stopMode: 'structural', structuralRR: 2 });
  const b = rp.evaluate(buy, { entryPrice: 100, invalidation: 96 }); // risk = 4
  near(b.order.slPrice, 96, 'structural SL = invalidation');
  near(b.order.tpPrice, 108, 'structural TP = 100 + 2*4');
  ok('structural mode uses invalidation + RR target');
}

// --- structural with wrong-side invalidation → fallback to percent ---
{
  const rp = new RiskPolicy({ ...g, stopMode: 'structural', structuralRR: 2 });
  const b = rp.evaluate(buy, { entryPrice: 100, invalidation: 105 }); // above entry for a BUY → invalid
  near(b.order.slPrice, 98, 'wrong-side invalidation → percent SL');
  ok('structural wrong-side → percent fallback');
}

// --- percent mode (default) unchanged ---
{
  const rp = new RiskPolicy({ ...g });
  const b = rp.evaluate(buy, { entryPrice: 100 });
  near(b.order.slPrice, 98, 'default percent SL');
  near(b.order.tpPrice, 104, 'default percent TP');
  ok('default percent mode unchanged');
}

console.log(`\n${passed} checks passed`);
