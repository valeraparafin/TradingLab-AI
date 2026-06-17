import { evaluateBar } from '../core/pipeline.js';
import { slip, checkExit } from './execution.js';
import { breakevenStop, channelTrailStop } from './exitPolicy.js';
import { liqPrice } from '../core/liquidation.js';
import { fundingBetween } from './funding.js';
import { IndicatorManager } from '../indicators/index.js';
import { Technicals } from '../indicators/technical.js';
import { RiskPolicy } from '../agents/RiskPolicy.js';
import { resolveSignalExit, signalStateSide } from '../manual/resolveSignalExit.js';
import { aggregateHTF } from '../core/aggregateHTF.js';
import { classifyHTFTrend } from '../core/classifyHTFTrend.js';
import { bucketOf } from './htfGate.js';

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

  // Signal-driven exit (stop-and-reverse): the logic template's exit_mode. In this mode the
  // simulator closes an open position when the indicator's persistent state flips against it,
  // ignores take-profit, keeps the stop-loss as a protective floor, and re-enters on the
  // current state — mirroring the live engine (bot_engine.js + src/manual/resolveSignalExit.js).
  const exitMode = (config && (config.logic?.exit_mode || config.exit_mode)) || 'sl_tp';
  const signalMode = exitMode === 'signal';
  const indicatorManager = signalMode ? new IndicatorManager(config.logic || {}) : null;
  // TP is suppressed in signal mode (no profit cap). Null takeProfitPct so RiskPolicy yields a
  // null tpPrice, and zero the min-RR gate — signal mode has no fixed RR target, and a null TP
  // does NOT disable the gate on its own (isFinite(null) === true coerces to 0 → rr 0 < min).
  const signalRiskPolicy = signalMode
    ? new RiskPolicy({ ...guardrails, takeProfitPct: null, minRiskRewardRatio: 0 })
    : null;

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

    // Signal mode: recompute the indicator's persistent state on the window up to close[i]
    // (no look-ahead). Drives both the flip-exit and the state-based entry below.
    let sigRaw = null;
    if (signalMode) {
      const w = candles.slice(Math.max(0, i - lookback + 1), i + 1);
      sigRaw = indicatorManager.calculate(config.logicType, w);
    }

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

    // 3a) Signal-flip exit (stop-and-reverse). After the protective SL ran intrabar above,
    // close at THIS bar's close when the persistent state has flipped against the position.
    // The reverse entry is set up by the state-based entry block below (fills next-bar open).
    if (signalMode && position) {
      const sx = resolveSignalExit({ exitMode, positionSide: position.side, strategyData: sigRaw });
      if (sx.exit) {
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
          pnl, fees, funding: position.fundingAccrued, reason: 'SIGNAL_FLIP',
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
      // freeEquity is only passed for futures so RiskPolicy can check margin availability.
      // Spot path omits it so behaviour is byte-identical to Phase 3 (defaults to portfolioValue).
      const portfolio = { openPositions: 0, portfolioHeatPct: 0, dailyPnlPct: 0, tradesToday: 0 };
      if (isFutures) portfolio.freeEquity = equity;
      if (guardrails.sizingMode === 'compound') portfolio.equity = equity;

      if (signalMode) {
        // Entry side follows the persistent state (stop-and-reverse re-entry), not a fresh
        // flip. Size + protective SL come from RiskPolicy; TP is suppressed.
        const stateSide = signalStateSide(sigRaw);
        // Regime gate (opt-in via p.regimeGate.adxMin): only admit an entry when ADX on the
        // decision window clears the threshold. Whipsaw flips cluster in low-ADX chop; this
        // prunes them. Computed on the same window the indicator state used (no look-ahead).
        // Absent or adxMin<=0 => no gate, byte-identical to prior runs.
        let regimeOk = true;
        if (stateSide !== 'HOLD' && p.regimeGate && p.regimeGate.adxMin > 0) {
          const aw = candles.slice(Math.max(0, i - lookback + 1), i + 1);
          const adxSeries = Technicals.adx(aw, p.regimeGate.adxPeriod || 14);
          const adx = adxSeries.length ? adxSeries[adxSeries.length - 1] : null;
          regimeOk = adx != null && adx >= p.regimeGate.adxMin;
        }
        // HTF trend gate (opt-in via p.htfGate, stackable with the ADX gate): deny an entry
        // whose side runs AGAINST the higher-timeframe emaBand trend; with-trend and neutral
        // pass. Same emaBand semantics as src/backtest/htfGate.js, computed on the same
        // decision window (closed-only HTF aggregation, no look-ahead).
        if (stateSide !== 'HOLD' && regimeOk && p.htfGate) {
          const hw = candles.slice(Math.max(0, i - lookback + 1), i + 1);
          const verdict = classifyHTFTrend(aggregateHTF(hw, p.htfGate.ratio),
            { emaPeriod: p.htfGate.emaPeriod, band: p.htfGate.band }).emaBand;
          if (bucketOf(stateSide, verdict) === 'against') regimeOk = false;
        }
        // Volume-confirmation gate (opt-in via p.volGate, stackable with the ADX/HTF gates):
        // admit an entry only when the decision-bar volume clears mult * SMA(volume, period).
        // A state flip on thin volume is low-conviction; an expansion confirms participation.
        // Trailing SMA on the same decision bar i (no look-ahead). Absent => byte-identical.
        if (stateSide !== 'HOLD' && regimeOk && p.volGate && p.volGate.mult > 0) {
          const vp = p.volGate.period || 20;
          const vw = candles.slice(Math.max(0, i - vp + 1), i + 1);
          const sma = vw.reduce((a, c) => a + (c.volume || 0), 0) / vw.length;
          regimeOk = sma > 0 && bar.volume >= p.volGate.mult * sma;
        }
        // RSI confluence gate (opt-in via p.rsiGate, stackable): momentum confirmation — admit a
        // long only when decision-window RSI >= longMin, a short only when RSI <= 100 - longMin.
        // RSI on the decision-window closes (no look-ahead). Absent => byte-identical.
        if (stateSide !== 'HOLD' && regimeOk && p.rsiGate && p.rsiGate.longMin > 0) {
          const rw = candles.slice(Math.max(0, i - lookback + 1), i + 1).map((c) => c.close);
          const rsiSeries = Technicals.rsi(rw, p.rsiGate.period || 14);
          const rsi = rsiSeries.length ? rsiSeries[rsiSeries.length - 1] : null;
          if (rsi == null) regimeOk = false;
          else if (stateSide === 'BUY') regimeOk = rsi >= p.rsiGate.longMin;
          else regimeOk = rsi <= 100 - p.rsiGate.longMin;
        }
        if (stateSide !== 'HOLD' && regimeOk) {
          const price = bar.close;
          const invalidation = stateSide === 'BUY' ? (sigRaw.loBand ?? null) : (sigRaw.hiBand ?? null);
          const decision = signalRiskPolicy.evaluate(
            { side: stateSide, conviction: 1, reason: 'RangeFilter state', invalidation },
            { ...portfolio, entryPrice: price, invalidation, atr: null },
          );
          if (decision && decision.decision === 'PERMIT' && decision.order) {
            const o = decision.order;
            pending = { side: o.side, slPrice: o.slPrice, tpPrice: null, sizeUSD: o.sizeUSD };
          }
        }
      } else {
        const window = candles.slice(Math.max(0, i - lookback + 1), i + 1);
        const ctx = { candles: window, config, symbol, timeframe };
        const account = { guardrails, portfolio };
        const { decision } = decide(ctx, account);
        if (decision && decision.decision === 'PERMIT' && decision.order) {
          const o = decision.order;
          pending = { side: o.side, slPrice: o.slPrice, tpPrice: o.tpPrice, sizeUSD: o.sizeUSD };
        }
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
