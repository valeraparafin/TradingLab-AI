// src/agents/deriveAgentProposal.js
import { IndicatorManager } from '../indicators/index.js';
import { deriveSignal } from '../core/SignalAdapter.js';

// The four logic types the shared core (IndicatorManager + deriveSignal) supports.
const CORE_LOGIC_TYPES = new Set(['SMC', 'BREAKOUT', 'VMC_CIPHERB', 'REVERSAL']);

/**
 * First indicator name that maps to a core-supported logicType, else null.
 * The AI agent carries an `indicators` array; the core decides on one logicType.
 * @param {string[]} [indicators]
 * @returns {string|null}
 */
export function pickLogicType(indicators = []) {
  for (const name of indicators || []) {
    if (name && CORE_LOGIC_TYPES.has(String(name).toUpperCase())) return name;
  }
  return null;
}

/** HOLD proposal — RiskPolicy DENYs it (no trade). Carries a reason for UI/memory. */
function holdProposal(reason) {
  return { side: 'HOLD', conviction: 0, rationale: reason, invalidationIdea: null };
}

/**
 * Pure: real candles + the agent's indicator list → QualitativeProposal via the core.
 * Mirrors Phase 6a's resolveEntrySide seam. No I/O; the caller fetches candles.
 *
 * @param {object} args
 * @param {string[]} args.indicators - agent's resolved indicator names
 * @param {object} [args.logicConfig] - indicator thresholds ({} → engine defaults)
 * @param {object[]} args.candles
 * @param {number} args.price
 * @returns {{side:'BUY'|'SELL'|'HOLD', conviction:number, rationale:string, invalidationIdea:(number|null)}}
 */
export function deriveAgentProposal({ indicators, logicConfig = {}, candles, price }) {
  const logicType = pickLogicType(indicators);
  if (!logicType) return holdProposal('no core-supported logicType in agent indicators');
  let signal;
  try {
    const raw = new IndicatorManager(logicConfig).calculate(logicType, candles);
    signal = deriveSignal(logicType, raw, { price, candles });
  } catch (err) {
    // Unsupported type / malformed data must not crash the live agent loop.
    return holdProposal(`signal core error for ${logicType}: ${err.message}`);
  }
  return {
    side: signal.side,
    conviction: signal.conviction,
    rationale: signal.reason,
    invalidationIdea: signal.invalidation ?? null,
  };
}
