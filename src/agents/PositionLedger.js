// src/agents/PositionLedger.js
//
// Pure position decisioning + PnL math. No I/O, no DB. Persistence lives in
// aiStrategyService; orchestration lives in AgentOrchestrator. Mirrors the
// pure-module + node:assert pattern of ObAnalyst.js / obGuardrails.js.

/** Normalize a position object created from an executed order. */
export function openPosition({ symbol, side, entryPrice, qty, slPrice, tpPrice, openedAt }) {
  return { symbol, side, entryPrice, qty, slPrice, tpPrice, openedAt };
}

/** Signed realized PnL in USD for a fill at `exitPrice`. */
export function realizedPnl({ side, entryPrice, qty }, exitPrice) {
  const dir = side === 'SELL' ? -1 : 1;
  return dir * (exitPrice - entryPrice) * qty;
}

/**
 * Decide which open positions breach SL/TP given current mids.
 * LONG : SL when mid <= slPrice; TP when mid >= tpPrice.
 * SHORT: SL when mid >= slPrice; TP when mid <= tpPrice.
 * SL is checked first, so a single straddling tick closes conservatively at SL.
 * Positions with no mid in the map pass through to `remaining` untouched.
 */
export function checkExits(positions, midBySymbol) {
  const closed = [], remaining = [];
  for (const pos of positions) {
    const mid = midBySymbol[pos.symbol];
    if (typeof mid !== 'number' || !isFinite(mid)) { remaining.push(pos); continue; }
    const long = pos.side !== 'SELL';
    let reason = null;
    if (long) {
      if (mid <= pos.slPrice) reason = 'SL';
      else if (mid >= pos.tpPrice) reason = 'TP';
    } else {
      if (mid >= pos.slPrice) reason = 'SL';
      else if (mid <= pos.tpPrice) reason = 'TP';
    }
    if (reason) closed.push({ ...pos, exitPrice: mid, exitReason: reason, pnlUsd: realizedPnl(pos, mid) });
    else remaining.push(pos);
  }
  return { closed, remaining };
}
