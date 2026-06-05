import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { toCamel } from './utils/casing.js';

// Required fields are the minimal set every risk template must define; the remaining
// gate fields are optional because riskProfileToGuardrails.js defaults them gracefully
// (Infinity / 0 / portfolioValue=10000), so the schema must not be stricter than the
// runtime needs. stopLossPercent/takeProfitPercent keep the units-foundation guard
// (min 0.1, max 100) to reject malformed percent values.
const RiskSchema = z.object({
  maxTradeSizeUSD: z.number().positive(),
  riskPerTradePercent: z.number().min(0).max(100),
  stopLossPercent: z.number().min(0.1).max(100),
  takeProfitPercent: z.number().min(0.1).max(100),
  maxTradesPerDay: z.number().int().positive(),
  portfolioValue: z.number().positive().optional(),
  minRiskRewardRatio: z.number().positive().optional(),
  maxPortfolioHeatPercent: z.number().min(0).max(100).optional(),
  maxOpenPositions: z.number().int().positive().optional(),
  dailyLossLimitPercent: z.number().min(0).max(100).optional(),
  dailyProfitTargetPercent: z.number().min(0).max(100).optional(),
}).superRefine((s, ctx) => {
  // Guard 1: a template can't demand more reward:risk than its own fixed TP/SL can yield.
  if (s.minRiskRewardRatio != null && s.minRiskRewardRatio > 0 && s.stopLossPercent > 0) {
    const ratio = s.takeProfitPercent / s.stopLossPercent;
    if (ratio < s.minRiskRewardRatio) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `minRiskRewardRatio ${s.minRiskRewardRatio} unreachable with TP ${s.takeProfitPercent} / SL ${s.stopLossPercent} (ratio ${ratio.toFixed(2)})`,
      });
    }
  }
});

/**
 * Resolves a strategy configuration by merging templates with overrides.
 *
 * @param {Object} strategyConfig - The strategy configuration containing template IDs and overrides.
 * @returns {Object} The fully resolved configuration.
 * @throws {Error} If templates cannot be loaded or validation fails.
 */
export function resolveConfig(strategyConfig) {
  const {
    riskTemplateId,
    riskOverrides = {},
    logicTemplateId,
    logicOverrides = {}
  } = strategyConfig;

  // 1. Resolve Risk Config
  const riskTemplatePath = path.join(process.cwd(), 'templates', 'risk', `${riskTemplateId}.json`);
  if (!fs.existsSync(riskTemplatePath)) {
    throw new Error(`Risk template not found: ${riskTemplateId}`);
  }
  const riskTemplate = JSON.parse(fs.readFileSync(riskTemplatePath, 'utf8'));

  // Convert template and overrides to camelCase for consistency
  const templateSettings = toCamel(riskTemplate.settings || riskTemplate.content?.settings || riskTemplate);
  const normalizedOverrides = toCamel(riskOverrides);

  const mergedRisk = {
    ...templateSettings,
    ...normalizedOverrides
  };

  // Validate Risk Config
  const validationResult = RiskSchema.safeParse(mergedRisk);
  if (!validationResult.success) {
    throw new Error(`Risk configuration validation failed: ${validationResult.error.message}`);
  }

  // 2. Resolve Logic Config
  const logicTemplatePath = path.join(process.cwd(), 'templates', 'logic', `${logicTemplateId}.json`);
  if (!fs.existsSync(logicTemplatePath)) {
    throw new Error(`Logic template not found: ${logicTemplateId}`);
  }
  const logicTemplate = JSON.parse(fs.readFileSync(logicTemplatePath, 'utf8'));

  const templateLogic = toCamel(logicTemplate.settings || logicTemplate.content?.settings || logicTemplate);
  const normalizedLogicOverrides = toCamel(logicOverrides);

  const mergedLogic = {
    ...templateLogic,
    ...normalizedLogicOverrides
  };

  return {
    ...strategyConfig,
    risk: validationResult.data,
    logic: mergedLogic
  };
}
