// src/manual/legacyManualSide.js
/**
 * Verbatim reproduction of bot_engine.js's legacy entry-side rule (lines ~448-467).
 * Pure; preserves the known "default to BUY" behavior on neutral/unhandled cases —
 * the OFF (feature-flag) path, pinned so any drift is caught by tests.
 *
 * @param {string|null} logicType - resolved strategy logic type ("SMC" | "Breakout" | ...)
 * @param {object} strategyData - the IndicatorManager.calculate(...) result
 * @param {number} price - latest close price
 * @returns {'BUY'|'SELL'} never HOLD — legacy always commits to a side
 */
export function legacyManualSide(logicType, strategyData = {}, price) {
  let side = 'BUY'; // Default side
  if (!logicType) return side;

  if (logicType === 'Breakout' && strategyData.channel?.active) {
    side = price > strategyData.channel.top
      ? 'BUY'
      : (price < strategyData.channel.bottom ? 'SELL' : 'BUY');
  } else if (logicType === 'SMC') {
    side = strategyData.structure?.trend === 1
      ? 'BUY'
      : (strategyData.structure?.trend === -1 ? 'SELL' : 'BUY');
  }
  return side;
}
