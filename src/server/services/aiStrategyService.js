import fs from 'fs/promises';
import path from 'path';
import { getDB } from '../../../db.js';
import { templateService } from './template.service.js';

/**
 * AI Strategy Service handles the management of AI risk profiles
 * and strategy configurations in the ai_trading.db.
 */
export const aiStrategyService = {
    /**
     * Seeds the ai_risk_profiles table from JSON templates in templates/risk/*.
     * Maps camelCase JSON settings to snake_case DB columns.
     */
    async seedTemplates() {
        const db = getDB('ai');
        const templatesDir = path.join(process.cwd(), 'templates', 'risk');

        try {
            const files = (await fs.readdir(templatesDir)).filter(f => f.endsWith('.json'));

            console.log(`Seeding AI risk profiles from ${files.length} templates...`);

            for (const file of files) {
                const filePath = path.join(templatesDir, file);
                const content = await fs.readFile(filePath, 'utf8');
                const json = JSON.parse(content);

                // Handle both formats: { content: { settings: ... } } or { settings: ... }
                const data = json.content ? json.content : json;
                const settings = data.settings || {};
                const profileName = data.name || path.basename(file, '.json');

                const values = {
                    name: profileName,
                    is_template: 1, // true
                    risk_per_trade_percent: settings.riskPerTradePercent,
                    max_trade_size_usd: settings.maxTradeSizeUSD,
                    stop_loss_percent: settings.stopLossPercent,
                    take_profit_percent: settings.takeProfitPercent,
                    max_portfolio_heat_percent: settings.maxPortfolioHeatPercent,
                    max_open_positions: settings.maxOpenPositions,
                    daily_loss_limit_percent: settings.dailyLossLimitPercent,
                    daily_profit_target_percent: settings.dailyProfitTargetPercent,
                    max_trades_per_day: settings.maxTradesPerDay,
                    min_risk_reward_ratio: settings.minRiskRewardRatio,
                };

                const sql = `
                    INSERT OR REPLACE INTO ai_risk_profiles
                    (name, is_template, risk_per_trade_percent, max_trade_size_usd, stop_loss_percent, take_profit_percent, max_portfolio_heat_percent, max_open_positions, daily_loss_limit_percent, daily_profit_target_percent, max_trades_per_day, min_risk_reward_ratio)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;

                await db.run(sql, Object.values(values));
                console.log(`  ✓ Seeded profile: ${profileName}`);
            }
            console.log('AI risk profiles seeding complete.');
        } catch (e) {
            console.warn(`[seedTemplates] Could not read templates/risk directory: ${e.message}. Falling back to defaults.`);
        }

        // Fallback: insert default templates if none exist yet
        const existing = await db.all('SELECT COUNT(*) AS c FROM ai_risk_profiles WHERE is_template = 1');
        if (!existing[0].c) {
            const defaults = [
                { name: 'Conservative', risk_per_trade_percent: 0.5, max_trade_size_usd: 50,  stop_loss_percent: 1.5, take_profit_percent: 3, max_portfolio_heat_percent: 3,  max_open_positions: 2, daily_loss_limit_percent: 1, daily_profit_target_percent: 3 },
                { name: 'Balanced',     risk_per_trade_percent: 1,   max_trade_size_usd: 100, stop_loss_percent: 2,   take_profit_percent: 4, max_portfolio_heat_percent: 5,  max_open_positions: 3, daily_loss_limit_percent: 2, daily_profit_target_percent: 5 },
                { name: 'Aggressive',   risk_per_trade_percent: 2,   max_trade_size_usd: 250, stop_loss_percent: 3,   take_profit_percent: 6, max_portfolio_heat_percent: 10, max_open_positions: 5, daily_loss_limit_percent: 4, daily_profit_target_percent: 8 },
            ];
            for (const d of defaults) {
                await db.run(
                    `INSERT OR REPLACE INTO ai_risk_profiles
                     (name, is_template, risk_per_trade_percent, max_trade_size_usd, stop_loss_percent, take_profit_percent, max_portfolio_heat_percent, max_open_positions, daily_loss_limit_percent, daily_profit_target_percent)
                     VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [d.name, d.risk_per_trade_percent, d.max_trade_size_usd, d.stop_loss_percent, d.take_profit_percent, d.max_portfolio_heat_percent, d.max_open_positions, d.daily_loss_limit_percent, d.daily_profit_target_percent]
                );
            }
            console.log('AI risk profiles seeded with 3 default templates.');
        }
    },

    /**
     * Fetches a risk profile by its ID.
     * @param {number} profileId
     */
    async getRiskProfile(profileId) {
        const db = getDB('ai');
        return await db.get('SELECT * FROM ai_risk_profiles WHERE id = ?', [profileId]);
    },

    /**
     * Returns equity/heat/PnL snapshots for an agent over an interval, oldest→newest.
     * Source of truth for the cockpit's Equity Curve and current Portfolio Heat.
     * @param {number} agentId
     * @param {'day'|'week'|'month'} interval
     */
    async getEquitySnapshots(agentId, interval = 'day') {
        const db = getDB('ai');
        let since = "datetime('now', '-1 day')";
        if (interval === 'week') since = "datetime('now', '-7 days')";
        if (interval === 'month') since = "datetime('now', '-30 days')";
        return await db.all(
            `SELECT timestamp, equity_usd, heat_pct, daily_pnl_pct, open_positions, trades_today
               FROM ai_equity_snapshots
              WHERE strategy_id = ? AND timestamp >= ${since}
              ORDER BY timestamp ASC`,
            [Number(agentId)]
        );
    },

    /**
     * Creates a new AI agent (ai_strategies row).
     * @param {object} a - Agent fields.
     * @returns {{ id: number }}
     */
    async createAgent(a) {
        const db = getDB('ai');
        const r = await db.run(
            `INSERT INTO ai_strategies
               (name, status, logic_template_id, risk_profile_id, watchlist, timeframe, trade_mode, paper_trading, portfolio_value, cycle_interval_ms, is_archived)
             VALUES (?, 'stopped', ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
            [a.name, a.logic_template_id ?? null, a.risk_profile_id ?? null, a.watchlist ?? '', a.timeframe ?? '1H',
             a.trade_mode ?? 'spot', a.paper_trading ?? 1, a.portfolio_value ?? 10000, a.cycle_interval_ms ?? 300000]
        );
        return { id: r.lastID };
    },

    /**
     * Fetches a single AI agent by id.
     * @param {number} id
     */
    async getAgent(id) {
        const db = getDB('ai');
        return await db.get('SELECT * FROM ai_strategies WHERE id = ?', [id]);
    },

    /**
     * Lists AI agents. Excludes archived agents by default.
     * @param {boolean} includeArchived - Pass true to include archived agents.
     */
    async listAgents(includeArchived = false) {
        const db = getDB('ai');
        const where = includeArchived ? '' : 'WHERE is_archived = 0';
        return await db.all(
            `SELECT id, name, status, logic_template_id, risk_profile_id, watchlist, timeframe, trade_mode, paper_trading, portfolio_value, cycle_interval_ms, last_run, is_archived
               FROM ai_strategies ${where} ORDER BY name`
        );
    },

    /**
     * Updates allowed fields on an AI agent.
     * @param {number} id
     * @param {object} fields - Key-value pairs of fields to update.
     */
    async updateAgent(id, fields) {
        const db = getDB('ai');
        const allowed = ['name', 'logic_template_id', 'risk_profile_id', 'watchlist', 'timeframe', 'trade_mode', 'paper_trading', 'portfolio_value', 'cycle_interval_ms', 'status', 'last_run'];
        const sets = [], params = [];
        for (const [k, v] of Object.entries(fields)) {
            if (allowed.includes(k)) { sets.push(`${k} = ?`); params.push(v); }
        }
        if (!sets.length) return { changes: 0 };
        params.push(id);
        const r = await db.run(`UPDATE ai_strategies SET ${sets.join(', ')} WHERE id = ?`, params);
        return { changes: r.changes };
    },

    /**
     * Archives an AI agent (sets is_archived=1, status='stopped').
     * @param {number} id
     */
    async archiveAgent(id) {
        const db = getDB('ai');
        const r = await db.run("UPDATE ai_strategies SET is_archived = 1, status = 'stopped' WHERE id = ?", [id]);
        return { changes: r.changes };
    },

    /**
     * Lists reusable risk templates (is_template = 1) for the config panel dropdown.
     */
    async listRiskTemplates() {
        const db = getDB('ai');
        return await db.all('SELECT * FROM ai_risk_profiles WHERE is_template = 1 ORDER BY name');
    },

    /**
     * Resolves the indicator list for a logic template by its ID.
     * Logic templates live in templates/logic/<id>.json and have a `type` field
     * (e.g. "SMC", "Breakout") that maps directly to indicator names.
     *
     * TODO: If a single template should map to MULTIPLE indicators (e.g. SMC + FVG),
     * update the logic template schema to add an `indicators: string[]` array field
     * and read that here instead of the single `type` field.
     *
     * @param {string|null} logicTemplateId
     * @returns {Promise<string[]>}
     */
    async getLogicTemplateIndicators(logicTemplateId) {
        if (!logicTemplateId) return ['SMC'];
        try {
            const template = await templateService.loadTemplate('logic', logicTemplateId);
            if (template && template.type) {
                // A template's `type` is the primary indicator name (e.g. "SMC", "Breakout").
                return [template.type];
            }
            // Safe default if template exists but has no type field
            return ['SMC'];
        } catch (e) {
            return ['SMC'];
        }
    },

    /**
     * Creates a new non-template risk profile owned by a single agent.
     * @param {object} settings - camelCase risk settings from the frontend.
     * @param {string} [name] - Optional profile name.
     * @returns {{ id: number }}
     */
    async createRiskProfile(settings, name) {
        const db = getDB('ai');
        const map = {
            riskPerTradePercent: 'risk_per_trade_percent',
            maxTradeSizeUSD: 'max_trade_size_usd',
            stopLossPercent: 'stop_loss_percent',
            takeProfitPercent: 'take_profit_percent',
            maxPortfolioHeatPercent: 'max_portfolio_heat_percent',
            maxOpenPositions: 'max_open_positions',
            dailyLossLimitPercent: 'daily_loss_limit_percent',
            dailyProfitTargetPercent: 'daily_profit_target_percent',
            maxTradesPerDay: 'max_trades_per_day',
            minRiskRewardRatio: 'min_risk_reward_ratio',
        };
        const cols = ['name', 'is_template'];
        const vals = [name || `agent-risk-${Date.now()}`, 0];
        const ph = ['?', '?'];
        for (const [camel, snake] of Object.entries(map)) {
            if (settings[camel] !== undefined) {
                cols.push(snake);
                vals.push(settings[camel]);
                ph.push('?');
            }
        }
        const r = await db.run(
            `INSERT INTO ai_risk_profiles (${cols.join(',')}) VALUES (${ph.join(',')})`,
            vals
        );
        return { id: r.lastID };
    },

    /**
     * Updates a specific risk profile's values.
     * Expects settings in camelCase to match frontend/JSON.
     * @param {number} id
     * @param {object} settings
     */
    async updateRiskProfile(id, settings) {
        const db = getDB('ai');

        // Map camelCase settings to snake_case columns
        const mapping = {
            riskPerTradePercent: 'risk_per_trade_percent',
            maxTradeSizeUSD: 'max_trade_size_usd',
            stopLossPercent: 'stop_loss_percent',
            takeProfitPercent: 'take_profit_percent',
            maxPortfolioHeatPercent: 'max_portfolio_heat_percent',
            maxOpenPositions: 'max_open_positions',
            dailyLossLimitPercent: 'daily_loss_limit_percent',
            dailyProfitTargetPercent: 'daily_profit_target_percent',
            maxTradesPerDay: 'max_trades_per_day',
            minRiskRewardRatio: 'min_risk_reward_ratio',
        };

        const updates = [];
        const params = [];

        for (const [key, value] of Object.entries(settings)) {
            if (mapping[key]) {
                updates.push(`${mapping[key]} = ?`);
                params.push(value);
            }
        }

        if (updates.length === 0) return { changes: 0 };

        params.push(id);
        const sql = `UPDATE ai_risk_profiles SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
        const result = await db.run(sql, params);

        return { changes: result.changes };
    }
};
