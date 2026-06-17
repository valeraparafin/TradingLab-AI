import { getDB, transaction } from '../../../db.js';
import { templateService } from './template.service.js';
import { botService } from './bot.service.js';
import { toCamel, toSnake } from '../../../src/utils/casing.js';
import { timeframeToMinutes } from '../../../src/utils/timeframe.js';
import { precisionManager } from '../../../src/utils/precision.js';

class StrategyService {
  /**
   * Creates a new strategy with initial templates and settings.
   */
  async createStrategy(payload) {
    const { name, logicTemplateId, riskTemplateId, settings: userSettings, ...rest } = payload;
    const settings = userSettings || rest;
    const db = getDB();

    const finalConfig = await this.assembleStrategy(name, settings, logicTemplateId, riskTemplateId);
    console.log(`[StrategyService] FINAL CONFIG TO SAVE:`, JSON.stringify(finalConfig, null, 2));

    const riskData = toSnake(finalConfig.finalRiskSettings);

    // Both inserts run in one transaction: if the risk-settings insert fails (e.g. a NOT NULL
    // constraint), the strategies row is rolled back too, so no orphaned strategy is left behind.
    const strategyId = await transaction('main', async (txDb) => {
      const result = await txDb.run(
        'INSERT INTO strategies (name, logic_config, status) VALUES (?, ?, ?)',
        [finalConfig.name, JSON.stringify(toSnake(finalConfig)), 'stopped']
      );
      const id = result.lastID;

      const riskValues = [
        riskData.risk_per_trade_percent,
        riskData.stop_loss_percent,
        riskData.take_profit_percent,
        riskData.min_risk_reward_ratio,
        riskData.max_portfolio_heat_percent,
        riskData.max_open_positions,
        riskData.max_trades_per_day,
        riskData.max_trade_size_usd,
        riskData.daily_loss_limit_percent,
        riskData.daily_profit_target_percent,
        riskData.portfolio_value,
        id
      ];

      await txDb.run(`INSERT INTO strategy_risk_settings (
        risk_per_trade_percent, stop_loss_percent, take_profit_percent,
        min_risk_reward_ratio, max_portfolio_heat_percent, max_open_positions,
        max_trades_per_day, max_trade_size_usd, daily_loss_limit_percent,
        daily_profit_target_percent, portfolio_value, strategy_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, riskValues);

      return id;
    });

    return { id: strategyId, name: finalConfig.name };
  }

  /**
   * Helper to check if a template is locked (used by a running strategy)

  */
  async checkTemplateLock(type, id) {
    const db = getDB();
    const jsonPath = type === 'logic' ? '$.metadata.logicTemplateId' : '$.metadata.riskTemplateId';
    const strategies = await db.all(
      `SELECT id, name, status, logic_config FROM strategies WHERE json_extract(logic_config, ?) = ?`,
      [jsonPath, id]
    );

    return toCamel({
      isLocked: strategies.some(s => botService.isActive(s.id) || s.status === 'running'),
      usedBy: strategies.map(s => ({ id: s.id, name: s.name })),
      activeCount: strategies.filter(s => botService.isActive(s.id) || s.status === 'running').length
    });
  }

  /**
   * Returns all strategies with current status.
   */
  async getAllStrategies() {
    const db = getDB();
    const results = await db.all('SELECT * FROM strategies WHERE is_archived = 0');
    return toCamel(results);
  }

  /**
   * Returns a unified config for a strategy (logic + risk).
   */
  async getFullConfig(id) {
    const db = getDB();
    const strategy = await db.get('SELECT * FROM strategies WHERE id = ?', [id]);
    if (!strategy) return null;

    const risk = await db.get('SELECT * FROM strategy_risk_settings WHERE strategy_id = ?', [id]);

    let logicConfig = {};
    try {
      logicConfig = JSON.parse(strategy.logic_config || '{}');
    } catch (e) {
      console.error(`[StrategyService] Error parsing logic_config for strategy ${id}: ${e.message}`);
    }

    const config = {
      ...strategy,
      ...logicConfig, // Spread logic config to top level for easier access
      riskSettings: risk
    };

    return toCamel(config);
  }

  /**
   * Returns KPI stats for a specific strategy.
   */
  async getStats(id) {
    const db = getDB();
    const stats = await db.get('SELECT * FROM strategy_stats WHERE strategy_id = ?', [id]);
    return stats ? toCamel(stats) : null;
  }

  /**
   * Returns active positions for a specific strategy.
   */
  async getPositions(id) {
    const db = getDB();
    const positions = await db.all(
      'SELECT *, COALESCE(current_price, avg_entry_price) as currentPrice, COALESCE(current_pnl, 0) as currentPnl, COALESCE(current_pnl_percent, 0) as currentPnlPercent, stop_loss as stopLoss, take_profit as takeProfit FROM active_positions WHERE strategy_id = ? AND status = "OPEN"',
      [id]
    );

    return positions.map(p => {
      const camelPos = toCamel(p);
      const symbol = camelPos.symbol;

      // Return numeric data + the asset's price precision; the client formats at
      // the view (shared formatPrice). Keeps the API typed and lossless.
      return {
        ...camelPos,
        currentPrice: Number(camelPos.currentPrice),
        currentPnl: Number(camelPos.currentPnl),
        currentPnlPercent: Number(camelPos.currentPnlPercent),
        stopLoss: camelPos.stopLoss != null ? Number(camelPos.stopLoss) : null,
        takeProfit: camelPos.takeProfit != null ? Number(camelPos.takeProfit) : null,
        pricePrecision: precisionManager.getPrecision(symbol),
      };
    });
  }

  /**
   * Returns closed positions for a specific strategy.
   */
  async getClosedPositions(id) {
    const db = getDB();
    const positions = await db.all(
      'SELECT * FROM active_positions WHERE strategy_id = ? AND status = "CLOSED"',
      [id]
    );

    return positions.map(p => {
      const camelPos = toCamel(p);
      const symbol = camelPos.symbol;

      let finalPnl = Number(camelPos.currentPnl || 0);
      let finalPnlPercent = Number(camelPos.currentPnlPercent || 0);

      // Если PnL нулевой, но есть цена выхода, рассчитываем его вручную
      if ((finalPnl === 0) && camelPos.exitPrice && camelPos.entryPrice) {
        const entry = Number(camelPos.entryPrice);
        const exit = Number(camelPos.exitPrice);
        const size = Number(camelPos.sizeUsd || 0);

        const diffPercent = camelPos.side?.toUpperCase() === 'BUY'
          ? (exit - entry) / entry
          : (entry - exit) / entry;

        finalPnlPercent = diffPercent * 100;
        finalPnl = diffPercent * size;
      }

      return {
        ...camelPos,
        exitPrice: Number(camelPos.exitPrice || camelPos.entryPrice),
        currentPnl: finalPnl,
        currentPnlPercent: finalPnlPercent,
        stopLoss: camelPos.stopLoss != null ? Number(camelPos.stopLoss) : null,
        takeProfit: camelPos.takeProfit != null ? Number(camelPos.takeProfit) : null,
        pricePrecision: precisionManager.getPrecision(symbol),
      };
    });
  }

  /**
   * Returns raw trade history for a specific strategy.
   */
  async getTradeHistory(id) {
    const db = getDB();
    const trades = await db.all(
      'SELECT * FROM trades WHERE strategy_id = ? AND status != "BLOCKED" ORDER BY timestamp DESC',
      [id]
    );
    return toCamel(trades);
  }

  /**
   * Returns event logs for a specific strategy.
   */
  async getEvents(id) {
    const db = getDB();
    const events = await db.all(
      'SELECT * FROM events WHERE strategy_id = ? ORDER BY timestamp DESC',
      [id]
    );
    return toCamel(events.map(e => ({
      ...e,
      payload: e.payload ? JSON.parse(e.payload) : null
    })));
  }

  /**
   * Fetches the last "fresh" GCI state from the database based on the strategy's timeframe TTL.
   */
  async getLastXaiState(id) {
    const config = await this.getFullConfig(id);
    if (!config) return null;

    const timeframe = config.settings?.timeframe || config.timeframe;
    if (!timeframe) return null;

    const ttlMinutes = timeframeToMinutes(timeframe);
    if (!ttlMinutes) return null;

    const db = getDB();
    const now = Date.now();
    const ttlMs = ttlMinutes * 60 * 1000;
    const threshold = now - ttlMs;

    const events = await db.all(
      'SELECT payload, timestamp FROM events WHERE strategy_id = ? AND type = "safety_check" AND timestamp > ? ORDER BY timestamp DESC',
      [id, threshold]
    );

    if (!events || events.length === 0) return null;

    const freshStates = {};
    for (const event of events) {
      try {
        const data = JSON.parse(event.payload);
        const symbol = data.symbol;
        if (symbol && !freshStates[symbol]) {
          freshStates[symbol] = data;
        }
      } catch (e) {
        console.error(`[StrategyService] Error parsing GCI payload for strategy ${id}: ${e.message}`);
      }
    }

    return Object.keys(freshStates).length > 0 ? freshStates : null;
  }

  /**
   * Archives a strategy and stops it if running.
   */
  async archiveStrategy(strategyId) {
    const db = getDB();
    await botService.stopBot(strategyId);
    await db.run('UPDATE strategies SET is_archived = 1 WHERE id = ?', [strategyId]);
  }

  /**
   * Restores an archived strategy.
   */
  async restoreStrategy(strategyId) {
    const db = getDB();
    await db.run('UPDATE strategies SET is_archived = 0 WHERE id = ?', [strategyId]);
  }

  /**
   * Permanently deletes an archived strategy.
   */
  async deleteStrategy(strategyId) {
    const db = getDB();
    const strategy = await db.get('SELECT name, is_archived FROM strategies WHERE id = ?', [strategyId]);

    if (!strategy) throw new Error('Strategy not found');
    if (strategy.is_archived === 0) {
      throw new Error('Strategy must be archived before permanent deletion');
    }

    await db.run('DELETE FROM strategies WHERE id = ?', [strategyId]);
  }

  /**
   * Updates risk settings for a strategy.
   */
  async updateRiskSettings(strategyId, updates) {
    const db = getDB();
    const snakeUpdates = toSnake(updates);

    // Validate partial payload
    const columns = Object.keys(snakeUpdates);
    if (columns.length === 0) throw new Error('No risk settings provided for update');

    // Dirty Check
    const currentSettings = await db.get('SELECT * FROM strategy_risk_settings WHERE strategy_id = ?', [strategyId]);
    if (!currentSettings) throw new Error('Risk settings not found');

    let isDirty = false;
    for (const [key, value] of Object.entries(snakeUpdates)) {
      if (currentSettings[key] !== value) {
        isDirty = true;
        break;
      }
    }

    if (!isDirty) return { status: 'no_change' };

    const setClause = columns.map(col => `${col} = ?`).join(', ');
    const values = [...Object.values(snakeUpdates), strategyId];

    await db.run(`UPDATE strategy_risk_settings SET ${setClause} WHERE strategy_id = ?`, values);

    // Bot Restart Trigger
    if (botService.isActive(strategyId) || (await db.get('SELECT status FROM strategies WHERE id = ?', [strategyId]))?.status === 'running') {
      await botService.restartBot(strategyId);
    }

    return { status: 'updated' };
  }

  /**
   * Updates logic configuration for a strategy.
   */
  async updateLogicConfig(strategyId, updates) {
    const db = getDB();
    const snakeUpdates = toSnake(updates);
    const strategy = await db.get('SELECT logic_config FROM strategies WHERE id = ?', [strategyId]);
    if (!strategy) throw new Error('Strategy not found');

    const currentLogic = JSON.parse(strategy.logic_config || '{}');
    const mergedLogic = { ...currentLogic, ...snakeUpdates };

    if (JSON.stringify(currentLogic) === JSON.stringify(mergedLogic)) {
      return { status: 'no_change' };
    }

    await db.run('UPDATE strategies SET logic_config = ? WHERE id = ?', [JSON.stringify(mergedLogic), strategyId]);

    // Bot Restart Trigger
    if (botService.isActive(strategyId) || (await db.get('SELECT status FROM strategies WHERE id = ?', [strategyId]))?.status === 'running') {
      await botService.restartBot(strategyId);
    }

    return { status: 'updated' };
  }

  /**
   * Updates strategy configuration from templates and merged settings.
   */
  async updateFullConfig(strategyId, { name, logicTemplateId, riskTemplateId, settings }) {
    const db = getDB();
    const oldStrategy = await db.get('SELECT name, logic_config FROM strategies WHERE id = ?', [strategyId]);
    if (!oldStrategy) throw new Error(`Strategy ${strategyId} not found`);

    let finalLogicTemplateId = logicTemplateId;
    let finalRiskTemplateId = riskTemplateId;

    if (!finalLogicTemplateId || finalLogicTemplateId === "") {
      const existingConfig = JSON.parse(oldStrategy.logic_config);
      finalLogicTemplateId = existingConfig.metadata?.logicTemplateId || existingConfig.logic_template_id;
    }
    if (!finalRiskTemplateId || finalRiskTemplateId === "") {
      const existingConfig = JSON.parse(oldStrategy.logic_config);
      finalRiskTemplateId = existingConfig.metadata?.riskTemplateId || existingConfig.risk_template_id;
    }

    if (!finalLogicTemplateId || !finalRiskTemplateId) {
      throw new Error(`Templates are missing. Logic: ${finalLogicTemplateId}, Risk: ${finalRiskTemplateId}`);
    }

    const currentConfig = JSON.parse(oldStrategy.logic_config);
    const mergedSettings = { ...currentConfig, ...settings };

    const fieldsToRemove = [
      'metadata', 'riskOverrides', 'logicOverrides', 'finalRiskSettings',
      'risk_overrides', 'logic_overrides', 'final_risk_settings'
    ];
    fieldsToRemove.forEach(field => delete mergedSettings[field]);

    const finalName = name || oldStrategy.name;
    const finalConfig = await this.assembleStrategy(finalName, mergedSettings, finalLogicTemplateId, finalRiskTemplateId);

    await db.run('UPDATE strategies SET name = ?, logic_config = ? WHERE id = ?',
      [finalName, JSON.stringify(toSnake(finalConfig)), strategyId]
    );

    let riskData = toSnake(finalConfig.finalRiskSettings);

    const riskValues = [
      riskData.risk_per_trade_percent,
      riskData.stop_loss_percent,
      riskData.take_profit_percent,
      riskData.min_risk_reward_ratio,
      riskData.max_portfolio_heat_percent,
      riskData.max_open_positions,
      riskData.max_trades_per_day,
      riskData.max_trade_size_usd,
      riskData.daily_loss_limit_percent,
      riskData.daily_profit_target_percent,
      riskData.portfolio_value,
      strategyId
    ];

    await db.run('DELETE FROM strategy_risk_settings WHERE strategy_id = ?', [strategyId]);
    await db.run(
      `INSERT INTO strategy_risk_settings (
        risk_per_trade_percent, stop_loss_percent, take_profit_percent,
        min_risk_reward_ratio, max_portfolio_heat_percent, max_open_positions,
        max_trades_per_day, max_trade_size_usd, daily_loss_limit_percent,
        daily_profit_target_percent, portfolio_value, strategy_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      riskValues
    );

    return await db.get('SELECT * FROM strategies WHERE id = ?', [strategyId]);
  }

  /**
   * Assembler: Merges logic, risk, and user settings into a final strategy config
   */
  async assembleStrategy(name, settings, logicTemplateId, riskTemplateId) {
    if (!settings) settings = {};

    const [logic, risk] = await Promise.all([
      templateService.loadTemplate('logic', logicTemplateId),
      templateService.loadTemplate('risk', riskTemplateId)
    ]);

    if (!logic) throw new Error(`Logic template ${logicTemplateId} not found`);
    if (!risk) throw new Error(`Risk template ${riskTemplateId} not found`);

    // Calculate Risk Overrides
    const riskSettings = risk.settings || risk.content?.settings || risk;

    const riskOverrides = { ...(settings.riskOverrides || settings.risk_overrides || {}) };
    const combinedUserRisk = {
      ...settings,
      ...(settings.risk || {}),
      ...(settings.riskOverrides || settings.risk_overrides || {})
    };

    for (const [key, value] of Object.entries(combinedUserRisk)) {
      const camelKey = toCamel(key);
      if (riskSettings[camelKey] !== undefined) {
        if (value !== undefined) {
          if (value !== riskSettings[camelKey]) {
            riskOverrides[camelKey] = value;
          } else {
            delete riskOverrides[camelKey];
          }
        }
      }
    }

    // Calculate Logic Overrides
    const logicOverrides = { ...(settings.logicOverrides || settings.logic_overrides || {}) };
    if (settings.logic) {
      for (const [key, value] of Object.entries(settings.logic)) {
        if (value !== undefined && JSON.stringify(value) !== JSON.stringify(logic[key])) {
          logicOverrides[key] = value;
        }
      }
    }

    // Final merged risk settings for database persistence
    const finalRiskSettings = {
      ...riskSettings,
      ...riskOverrides
    };

    return {
      name,
      riskTemplateId,
      riskOverrides,
      logicTemplateId,
      logicOverrides,
      finalRiskSettings,
      ...Object.fromEntries(
        Object.entries(settings).filter(([key]) => {
          const riskFields = ['maxTradesPerDay', 'maxTradeSizeUSD', 'riskPerTradePercent', 'stopLossPercent', 'takeProfitPercent', 'risk', 'risk_overrides', 'riskOverrides', 'final_risk_settings', 'finalRiskSettings'];
          const logicFields = ['logic', 'logic_overrides', 'logicOverrides'];
          const metaFields = ['metadata', 'risk_template_id', 'logic_template_id', 'riskTemplateId', 'logicTemplateId'];
          return !riskFields.includes(key) && !logicFields.includes(key) && !metaFields.includes(key);
        })
      ),
      metadata: {
        logicTemplateId,
        riskTemplateId,
        assembledAt: new Date().toISOString()
      }
    };
  }
}

export const strategyService = new StrategyService();
