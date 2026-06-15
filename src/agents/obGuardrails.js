// src/agents/obGuardrails.js
// Order-book agents must use structural stops: SL = the broken level (signal invalidation),
// TP = structuralRR × risk. The percent-based R:R gate is disabled (minRiskRewardRatio=0) —
// otherwise RiskPolicy compares an ATR/structural setup against a percent threshold and DENYs
// nearly every OB trade. Risk profile still supplies sizing/heat/daily limits.

/**
 * @param {object} guardrails  output of riskProfileToGuardrails (fractions)
 * @param {{structuralRR?:number}} [opts]
 * @returns {object} a NEW guardrails object with structural overrides applied
 */
export function applyOrderBookGuardrails(guardrails = {}, { structuralRR = 2 } = {}) {
  return {
    ...guardrails,
    stopMode: 'structural',
    structuralRR: guardrails.structuralRR ?? structuralRR,
    minRiskRewardRatio: 0,
  };
}
