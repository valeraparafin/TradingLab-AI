import { evaluateBar } from '../core/pipeline.js';
import { slip, checkExit } from './execution.js';

/**
 * Pure walk-forward backtest over spot (leverage = 1). Deterministic: no I/O, no
 * Date.now(), no randomness. Signal decided on close[i]; entry filled at open[i+1]
 * with slippage; exits per bar via checkExit (SL→TP, gap-aware). No funding/liquidation.
 *
 * @param {object} p
 * @param {import('../core/contracts.js').Candle[]} p.candles ascending by time
 * @param {{logicType:string, logic?:object}} p.config
 * @param {object} p.guardrails RiskPolicy guardrails (portfolioValue drives sizing)
 * @param {{takerFee:number, makerFee:number, slippageBps:number}} p.costs
 * @param {string} p.symbol
 * @param {string} p.timeframe
 * @param {number} [p.lookback=250] rolling window fed to the indicator each bar
 * @param {number} [p.startEquity] defaults to guardrails.portfolioValue
 * @param {(ctx:object, account:object)=>{signal:object, decision:object}} [decide=evaluateBar]
 * @returns {{trades:object[], equityCurve:{time:number,equity:number}[], finalEquity:number, slippageCost:number}}
 */
export function simulate(p, decide = evaluateBar) {
  const { candles, config, guardrails, costs, symbol, timeframe } = p;
  const lookback = p.lookback || 250;
  const startEquity = p.startEquity != null ? p.startEquity : (guardrails.portfolioValue || 0);
  const takerFee = (costs && costs.takerFee) || 0;
  const makerFee = (costs && costs.makerFee) || 0;
  const slippageBps = (costs && costs.slippageBps) || 0;

  let equity = startEquity;
  let position = null;
  let pending = null;
  const trades = [];
  const equityCurve = [];
  let slippageCost = 0;

  const n = candles.length;
  const start = Math.min(lookback, n);

  const unreal = (pos, price) => {
    const r = pos.side === 'BUY' ? (price - pos.entryPrice) / pos.entryPrice
                                 : (pos.entryPrice - price) / pos.entryPrice;
    return pos.sizeUSD * r;
  };

  for (let i = start; i < n; i++) {
    const bar = candles[i];

    // 1) Fill a pending entry at THIS bar's open (next-bar-open execution).
    if (pending && !position) {
      const entryFill = slip(bar.open, pending.side, slippageBps);
      slippageCost += pending.sizeUSD * Math.abs(entryFill - bar.open) / bar.open;
      position = {
        side: pending.side, entryIndex: i, entryTime: bar.time,
        entryPrice: entryFill, slPrice: pending.slPrice, tpPrice: pending.tpPrice,
        sizeUSD: pending.sizeUSD, entryFee: pending.sizeUSD * takerFee, // market entry → taker
      };
      pending = null;
    }

    // 2) Manage exit for an open position (entry bar may exit intrabar).
    if (position) {
      const ex = checkExit(position, bar, { slippageBps }, position.entryIndex === i);
      if (ex) {
        const exitFee = position.sizeUSD * (ex.market ? takerFee : makerFee);
        if (ex.market) slippageCost += position.sizeUSD * Math.abs(ex.exitPrice - ex.idealPrice) / ex.idealPrice;
        const ret = position.side === 'BUY'
          ? (ex.exitPrice - position.entryPrice) / position.entryPrice
          : (position.entryPrice - ex.exitPrice) / position.entryPrice;
        const fees = position.entryFee + exitFee;
        const pnl = position.sizeUSD * ret - fees;
        equity += pnl;
        trades.push({
          side: position.side, entryTime: position.entryTime, entryPrice: position.entryPrice,
          exitTime: bar.time, exitPrice: ex.exitPrice, sizeUSD: position.sizeUSD,
          pnl, fees, reason: ex.reason,
        });
        position = null;
      }
    }

    // 3) If flat, decide for a next-bar entry (uses only data up to close[i]).
    if (!position && !pending && i + 1 < n) {
      const window = candles.slice(Math.max(0, i - lookback + 1), i + 1);
      const ctx = { candles: window, config, symbol, timeframe };
      const account = { guardrails, portfolio: { openPositions: 0, portfolioHeatPct: 0, dailyPnlPct: 0, tradesToday: 0 } };
      const { decision } = decide(ctx, account);
      if (decision && decision.decision === 'PERMIT' && decision.order) {
        const o = decision.order;
        pending = { side: o.side, slPrice: o.slPrice, tpPrice: o.tpPrice, sizeUSD: o.sizeUSD };
      }
    }

    // 4) Mark-to-market equity at bar close.
    equityCurve.push({ time: bar.time, equity: equity + (position ? unreal(position, bar.close) : 0) });
  }

  return { trades, equityCurve, finalEquity: equity, slippageCost };
}
