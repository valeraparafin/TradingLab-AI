import { evaluateBar } from '../core/pipeline.js';
import { slip, checkExit } from './execution.js';
import { liqPrice } from '../core/liquidation.js';
import { fundingBetween } from './funding.js';

/**
 * Pure walk-forward backtest. Spot (leverage = 1) is byte-identical to Phase 3.
 * Futures (leverage > 1): isolated margin, 8h funding accrual, liquidation (loss capped at margin).
 * Deterministic: no I/O, no Date.now(), no randomness.
 *
 * @param {object} p
 * @param {import('../core/contracts.js').Candle[]} p.candles ascending by time
 * @param {{logicType:string, logic?:object}} p.config
 * @param {object} p.guardrails RiskPolicy guardrails (portfolioValue drives sizing; leverage/mmr for futures)
 * @param {{takerFee:number, makerFee:number, slippageBps:number, liqFeeRate?:number}} p.costs
 * @param {string} p.symbol
 * @param {string} p.timeframe
 * @param {number} [p.lookback=250]
 * @param {number} [p.startEquity]
 * @param {{rateAt:(t:number)=>number, intervalMs:number}} [p.funding] futures funding series (omit for spot)
 * @param {(ctx:object, account:object)=>{signal:object, decision:object}} [decide=evaluateBar]
 * @returns {{trades:object[], equityCurve:{time:number,equity:number}[], finalEquity:number, slippageCost:number, totalFunding:number, liquidationCount:number}}
 */
export function simulate(p, decide = evaluateBar) {
  const { candles, config, guardrails, costs, symbol, timeframe } = p;
  const lookback = p.lookback || 250;
  const startEquity = p.startEquity != null ? p.startEquity : (guardrails.portfolioValue || 0);
  const takerFee = (costs && costs.takerFee) || 0;
  const makerFee = (costs && costs.makerFee) || 0;
  const slippageBps = (costs && costs.slippageBps) || 0;
  const liqFeeRate = (costs && costs.liqFeeRate != null) ? costs.liqFeeRate : takerFee;

  const leverage = guardrails.leverage || 1;
  const mmr = guardrails.mmr;
  const isFutures = leverage > 1;
  const funding = isFutures ? p.funding : null;

  let equity = startEquity;
  let position = null;
  let pending = null;
  const trades = [];
  const equityCurve = [];
  let slippageCost = 0;
  let totalFunding = 0;
  let liquidationCount = 0;

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
        marginUSD: isFutures ? pending.sizeUSD / leverage : pending.sizeUSD,
        liqPrice: isFutures ? liqPrice(entryFill, pending.side, leverage, mmr) : null,
        fundingAccrued: 0, lastFundingTime: bar.time,
      };
      pending = null;
    }

    // 2) Accrue funding over the holding period (futures only), before exit/MtM.
    if (position && funding && i > position.entryIndex) {
      const sumRate = fundingBetween(position.lastFundingTime, bar.time, funding.intervalMs, funding.rateAt);
      const cost = position.sizeUSD * sumRate * (position.side === 'BUY' ? 1 : -1);
      position.fundingAccrued += cost;
      position.lastFundingTime = bar.time;
    }

    // 3) Manage exit for an open position (entry bar may exit intrabar).
    if (position) {
      const ex = checkExit(position, bar, { slippageBps }, position.entryIndex === i);
      if (ex) {
        const isLiq = ex.reason === 'LIQUIDATION' || ex.reason === 'LIQ_GAP';
        let pnl, fees;
        if (isLiq) {
          // Isolated margin: loss capped at margin + liq fee + accrued funding. Entry fee absorbed.
          const liqFee = position.sizeUSD * liqFeeRate;
          fees = position.entryFee + liqFee;
          pnl = -(position.marginUSD + liqFee + position.fundingAccrued);
          liquidationCount += 1;
        } else {
          const exitFee = position.sizeUSD * (ex.market ? takerFee : makerFee);
          if (ex.market) slippageCost += position.sizeUSD * Math.abs(ex.exitPrice - ex.idealPrice) / ex.idealPrice;
          const ret = position.side === 'BUY'
            ? (ex.exitPrice - position.entryPrice) / position.entryPrice
            : (position.entryPrice - ex.exitPrice) / position.entryPrice;
          fees = position.entryFee + exitFee;
          pnl = position.sizeUSD * ret - fees - position.fundingAccrued;
        }
        equity += pnl;
        totalFunding += position.fundingAccrued;
        trades.push({
          side: position.side, entryTime: position.entryTime, entryPrice: position.entryPrice,
          exitTime: bar.time, exitPrice: ex.exitPrice, sizeUSD: position.sizeUSD,
          pnl, fees, funding: position.fundingAccrued, reason: ex.reason,
        });
        position = null;
      }
    }

    // 4) If flat, decide for a next-bar entry (uses only data up to close[i]).
    if (!position && !pending && i + 1 < n) {
      const window = candles.slice(Math.max(0, i - lookback + 1), i + 1);
      const ctx = { candles: window, config, symbol, timeframe };
      // freeEquity is only passed for futures so RiskPolicy can check margin availability.
      // Spot path omits it so behaviour is byte-identical to Phase 3 (defaults to portfolioValue).
      const portfolio = { openPositions: 0, portfolioHeatPct: 0, dailyPnlPct: 0, tradesToday: 0 };
      if (isFutures) portfolio.freeEquity = equity;
      const account = { guardrails, portfolio };
      const { decision } = decide(ctx, account);
      if (decision && decision.decision === 'PERMIT' && decision.order) {
        const o = decision.order;
        pending = { side: o.side, slPrice: o.slPrice, tpPrice: o.tpPrice, sizeUSD: o.sizeUSD };
      }
    }

    // 5) Mark-to-market equity at bar close (less accrued funding while open).
    const open = position ? unreal(position, bar.close) - position.fundingAccrued : 0;
    equityCurve.push({ time: bar.time, equity: equity + open });
  }

  // finalEquity: use last MtM curve point so open positions at end of window are included.
  // When no position is open at the last bar, this equals settled `equity` (byte-identical to Phase 3).
  const finalEquity = equityCurve.length ? equityCurve[equityCurve.length - 1].equity : equity;
  // Include any accrued funding from an open position at end of run.
  const openFunding = position ? position.fundingAccrued : 0;
  return { trades, equityCurve, finalEquity, slippageCost, totalFunding: totalFunding + openFunding, liquidationCount };
}
