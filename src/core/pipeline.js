import { IndicatorManager } from '../indicators/index.js';
import { RiskPolicy } from '../agents/RiskPolicy.js';
import { deriveSignal } from './SignalAdapter.js';
import { Technicals } from '../indicators/technical.js';

/**
 * Pure decision pipeline: candles → indicator → signal → risk decision.
 * No I/O, no Date.now(), deterministic. Shared by backtest and live shells.
 *
 * @param {import('./contracts.js').StrategyContext} ctx
 * @param {{guardrails: object, portfolio: object}} account
 * @returns {{signal: import('./contracts.js').Signal, decision: import('./contracts.js').Decision}}
 */
export function evaluateBar(ctx, account) {
  const price = ctx.candles[ctx.candles.length - 1].close;
  const raw = new IndicatorManager(ctx.config.logic || {}).calculate(ctx.config.logicType, ctx.candles);
  const signal = deriveSignal(ctx.config.logicType, raw, { price, candles: ctx.candles });
  const g = account.guardrails || {};
  let atr = null;
  if (g.stopMode === 'atr') {
    const series = Technicals.atr(ctx.candles, g.atrPeriod || 14);
    atr = series.length ? series[series.length - 1] : null;
  }
  const decision = new RiskPolicy(g).evaluate(signal, {
    ...(account.portfolio || {}),
    entryPrice: price,
    invalidation: signal.invalidation ?? null,
    atr,
  });
  return { signal, decision };
}
