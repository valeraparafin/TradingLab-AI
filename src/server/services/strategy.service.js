import { getDB } from '../../db/db.js';
import { botService } from './bot.service.js';
import { templateService } from './template.service.js';

class StrategyService {
  /**
   * Helper to check if a template is locked (used by a running strategy)
   */
  async checkTemplateLock(type, id) {
    const db = getDB();

    // Use json_extract to filter strategies that use this template ID in the metadata
    // config is stored as a JSON string in the database.
    // path: '$.metadata.logicTemplateId' or '$.metadata.riskTemplateId'
    const jsonPath = type === 'logic' ? '$.metadata.logicTemplateId' : '$.metadata.riskTemplateId';

    const strategies = await db.all(
      `SELECT id, name, status, logic_config FROM strategies WHERE json_extract(logic_config, ?) = ?`,
      [jsonPath, id]
    );

    const usedBy = [];
    let activeCount = 0;
    let isLocked = false;

    for (const s of strategies) {
      usedBy.push({ id: s.id, name: s.name });

      const isRunning = botService.isActive(s.id) || s.status === 'running';
      if (isRunning) {
        isLocked = true;
        activeCount++;
      }
    }

    return { isLocked, usedBy, activeCount };
  }

  /**
   * Assembler: Merges logic, risk, and user settings into a final strategy config
   */
  async assembleStrategy(name, settings, logicTemplateId, riskTemplateId) {
    const [logic, risk] = await Promise.all([
      templateService.loadTemplate('logic', logicTemplateId),
      templateService.loadTemplate('risk', riskTemplateId)
    ]);

    if (!logic) throw new Error(`Logic template ${logicTemplateId} not found`);
    if (!risk) throw new Error(`Risk template ${riskTemplateId} not found`);

    // Calculate Risk Overrides
    const riskSettings = risk.settings || risk.content?.settings || risk;

    // Start with existing overrides if they exist in settings
    const riskOverrides = { ...(settings.riskOverrides || {}) };

    // Extract desired risk values from settings (top-level or inside .risk)
    const desiredRisk = {
      ...(settings.risk || {}),
      ...settings
    };

    for (const [key, value] of Object.entries(desiredRisk)) {
      if (riskSettings[key] !== undefined) {
        if (value !== undefined) {
          if (value !== riskSettings[key]) {
            riskOverrides[key] = value;
          } else {
            // If it now matches the template, remove the override
            delete riskOverrides[key];
          }
        }
      }
    }
    console.log(`[Assemble] Resulting Overrides:`, riskOverrides);

    // Calculate Logic Overrides (if any settings are provided for logic)
    const logicOverrides = {};
    if (settings.logic) {
      for (const [key, value] of Object.entries(settings.logic)) {
        if (value !== undefined && JSON.stringify(value) !== JSON.stringify(logic[key])) {
          logicOverrides[key] = value;
        }
      }
    }

    return {
      name,
      riskTemplateId,
      riskOverrides,
      logicTemplateId,
      logicOverrides,
      // Preserve only non-risk and non-logic settings (watchlist, timeframe, paperTrading, tradeMode, etc.)
      ...Object.fromEntries(
        Object.entries(settings).filter(([key]) => {
          const riskFields = ['maxTradesPerDay', 'maxTradeSizeUSD', 'riskPerTradePercent', 'stopLossPercent', 'takeProfitPercent', 'risk'];
          const logicFields = ['logic'];
          return !riskFields.includes(key) && !logicFields.includes(key);
        })
      ),
      metadata: {
        logicTemplateId,
        riskTemplateId,
        assembledAt: new Date().toISOString()
      }
    };
  }

  /**
   * Core logic for updating strategy configuration
   */
  async updateStrategyConfig(strategyId, { name, logicTemplateId, riskTemplateId, settings }) {
    const db = getDB();
    const oldStrategy = await db.get('SELECT name, config FROM strategies WHERE id = ?', [strategyId]);
    if (!oldStrategy) throw new Error(`Strategy ${strategyId} not found`);

    // Use provided template IDs or fallback to existing ones from config
    let finalLogicTemplateId = logicTemplateId;
    let finalRiskTemplateId = riskTemplateId;

    if (!finalLogicTemplateId || !finalRiskTemplateId) {
      const existingConfig = JSON.parse(oldStrategy.config);
      finalLogicTemplateId = logicTemplateId || existingConfig.metadata?.logicTemplateId;
      finalRiskTemplateId = riskTemplateId || existingConfig.metadata?.riskTemplateId;
    }

    if (!finalLogicTemplateId || !finalRiskTemplateId) {
      throw new Error('logicTemplateId and riskTemplateId are required');
    }

    // Merge new settings updates into existing settings
    const currentConfig = JSON.parse(oldStrategy.config);
    const mergedSettings = {
      ...currentConfig,
      ...settings
    };

    // Remove existing metadata and assembled overrides to prevent them from being treated as settings
    delete mergedSettings.metadata;
    delete mergedSettings.riskOverrides;
    delete mergedSettings.logicOverrides;

    // Re-assemble the strategy
    const finalName = name || oldStrategy.name;
    const finalConfig = await this.assembleStrategy(finalName, mergedSettings, finalLogicTemplateId, finalRiskTemplateId);

    await db.run(
      'UPDATE strategies SET name = ?, config = ? WHERE id = ?',
      [finalName, JSON.stringify(finalConfig), strategyId]
    );

    return await db.get('SELECT * FROM strategies WHERE id = ?', [strategyId]);
  }
}

export const strategyService = new StrategyService();
