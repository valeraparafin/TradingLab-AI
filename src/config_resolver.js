import fs from 'fs';
import path from 'path';
import { z } from 'zod';

const RiskSchema = z.object({
  maxTradesPerDay: z.number().positive(),
  maxTradeSizeUSD: z.number().positive(),
  riskPerTradePercent: z.number().min(0).max(100),
  stopLossPercent: z.number().min(0).max(100),
  takeProfitPercent: z.number().min(0).max(100),
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

  // Templates are expected to have a 'settings' object
  const mergedRisk = {
    ...(riskTemplate.settings || riskTemplate.content?.settings || riskTemplate),
    ...riskOverrides
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

  const mergedLogic = {
    ...(logicTemplate.settings || logicTemplate.content?.settings || logicTemplate),
    ...logicOverrides
  };

  return {
    risk: validationResult.data,
    logic: mergedLogic
  };
}
