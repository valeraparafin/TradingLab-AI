import { evaluateBar } from '../core/pipeline.js';
import { slip, checkExit } from './execution.js';
import { breakevenStop, channelTrailStop } from './exitPolicy.js';
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
 *   Precondition: when leverage > 1 (futures), guardrails.mmr must be a finite number; if missing or
 *   non-finite, liqPrice returns null and the position can never be liquidated (liquidation silently
 *   disabled). The CLI guards this; direct callers are responsible for supplying a finite mmr.
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
        initialSlPrice: pending.slPrice, breakevenMoved: false,
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
          // Isolated margin: loss capped at margin + liq fee + accrued funding.
          // pnl embeds liqFee (and the margin absorbs the entry fee), so only liqFee is
          // reported in fees — entryFee is NOT added again here. This keeps trade.fees
          // uniformly equal to the fee amount embedded in that trade's equity impact,
          // consistent with the normal-exit branch where fees = entryFee + exitFee are both in pnl.
          const liqFee = position.sizeUSD * liqFeeRate;
          fees = liqFee;
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

    // 3b) Breakeven stop. Recomputes the stop AFTER this bar's exit check, so it only
    // affects subsequent bars (no intrabar ambiguity). One-shot, profit-only.
    if (position && p.exitPolicy && p.exitPolicy.breakevenR != null && !position.breakevenMoved) {
      const moved = breakevenStop(position, bar, p.exitPolicy.breakevenR);
      if (moved !== position.slPrice) { position.slPrice = moved; position.breakevenMoved = true; }
    }

    // 3c) Channel trailing stop (Donchian exit). Recompute the M-bar opposite extreme AFTER
    // this bar's exit check so it binds only on subsequent bars (same timing as breakeven).
    if (position && p.exitPolicy && p.exitPolicy.channelExit > 0) {
      const M = p.exitPolicy.channelExit;
      const w = candles.slice(Math.max(0, i - M + 1), i + 1);
      const moved = channelTrailStop(position, w);
      if (moved !== position.slPrice) position.slPrice = moved;
    }

    // 3d) No-impulse time-stop (arm A). If after timeStopBars the favorable excursion has not
    // reached impulseR*R, force a market exit at this bar's close — models the trader's "вкат".
    // Additive and gated on exitPolicy.timeStopBars; existing runs (flag absent) are unchanged.
    if (position && p.exitPolicy && p.exitPolicy.timeStopBars > 0 && !position.timeStopDone) {
      const age = i - position.entryIndex;
      if (age >= p.exitPolicy.timeStopBars) {
        position.timeStopDone = true;
        const R = Math.abs(position.entryPrice - position.initialSlPrice);
        const fav = position.side === 'BUY' ? bar.high - position.entryPrice : position.entryPrice - bar.low;
        const impulseR = p.exitPolicy.impulseR != null ? p.exitPolicy.impulseR : 1;
        if (R > 0 && fav < impulseR * R) {
          const exitSide = position.side === 'BUY' ? 'SELL' : 'BUY';
          const exitPrice = slip(bar.close, exitSide, slippageBps);
          slippageCost += position.sizeUSD * Math.abs(exitPrice - bar.close) / bar.close;
          const exitFee = position.sizeUSD * takerFee;
          const ret = position.side === 'BUY'
            ? (exitPrice - position.entryPrice) / position.entryPrice
            : (position.entryPrice - exitPrice) / position.entryPrice;
          const fees = position.entryFee + exitFee;
          const pnl = position.sizeUSD * ret - fees - position.fundingAccrued;
          equity += pnl;
          totalFunding += position.fundingAccrued;
          trades.push({
            side: position.side, entryTime: position.entryTime, entryPrice: position.entryPrice,
            exitTime: bar.time, exitPrice, sizeUSD: position.sizeUSD,
            pnl, fees, funding: position.fundingAccrued, reason: 'TIME_STOP',
          });
          position = null;
        }
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
      if (guardrails.sizingMode === 'compound') portfolio.equity = equity;
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
