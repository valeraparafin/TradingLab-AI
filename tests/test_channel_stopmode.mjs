// tests/test_channel_stopmode.mjs
import assert from 'node:assert';
import { evaluateBar } from '../src/core/pipeline.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

// Build a clean uptrend so DonchianTrend(entry=20) fires BUY on the last bar.
function uptrend() {
  const candles = [];
  let p = 100;
  for (let i = 0; i < 25; i++) { p += 1; candles.push({ time: i * 3600000, open: p - 1, high: p + 0.5, low: p - 1.5, close: p, volume: 1 }); }
  return candles;
}

// --- channel stopMode: SL = entry - 2*ATR, tpPrice = null ---
{
  const candles = uptrend();
  const ctx = { candles, config: { logicType: 'DonchianTrend', logic: { indicators: { entryLookback: 20 } } }, symbol: 'X', timeframe: '1H' };
  const guardrails = {
    portfolioValue: 10000, riskPerTrade: 0.02, sizingMode: 'fixed',
    stopLossPct: 0.02, takeProfitPct: 0.04, minRiskRewardRatio: 0,
    maxOpenPositions: 1, maxPortfolioHeatPct: 100, dailyLossLimitPct: 1,
    maxTradesPerDay: 999999, leverage: 1, stopMode: 'channel', atrPeriod: 14, atrSL: 2,
  };
  const account = { guardrails, portfolio: { openPositions: 0, portfolioHeatPct: 0, dailyPnlPct: 0, tradesToday: 0 } };
  const { signal, decision } = evaluateBar(ctx, account);
  assert.strictEqual(signal.side, 'BUY', `setup should be BUY (got ${signal.side})`);
  assert.strictEqual(decision.decision, 'PERMIT', `should PERMIT (got ${decision.decision}: ${decision.reason})`);
  const o = decision.order;
  assert.strictEqual(o.tpPrice, null, 'channel mode sets no take-profit');
  assert.ok(o.slPrice < o.entryPrice, 'BUY stop below entry');
  ok('channel stopMode: ATR stop, null TP');
}

console.log(`\n${passed} passed`);
