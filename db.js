import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';

let db = null;
let aiDb = null;

/**
 * Initializes the SQLite databases and creates necessary tables.
 * @returns {Promise<import('sqlite').Database>} The main database connection.
 */
export async function initDB() {
    // 1. Main Database (Manual Strategies - STABLE/LEGACY)
    db = await open({
        filename: path.join(process.cwd(), 'trading_lab.db'),
        driver: sqlite3.Database
    });

    // 2. AI Database (Experimental/Autonomous - DCA)
    aiDb = await open({
        filename: path.join(process.cwd(), 'ai_trading.db'),
        driver: sqlite3.Database
    });

    // Enable foreign key constraints for both
    await db.get('PRAGMA foreign_keys = ON');
    await aiDb.get('PRAGMA foreign_keys = ON');

    // --- SAFETY: Fix legacy schema columns if they are missing ---
    try { await db.exec('ALTER TABLE trades ADD COLUMN size_usd REAL'); } catch (e) {}
    try { await db.exec('ALTER TABLE active_positions ADD COLUMN size_usd REAL'); } catch (e) {}
    try { await db.exec('ALTER TABLE active_positions ADD COLUMN entry_price REAL'); } catch (e) {}
    try { await db.exec('ALTER TABLE active_positions ADD COLUMN stop_loss REAL'); } catch (e) {}
    try { await db.exec('ALTER TABLE active_positions ADD COLUMN take_profit REAL'); } catch (e) {}
    try { await db.exec('ALTER TABLE active_positions ADD COLUMN status TEXT'); } catch (e) {}

    // --- Main DB Schema (STABLE - DO NOT CHANGE COLUMN NAMES) ---
    await db.exec(`
        CREATE TABLE IF NOT EXISTS assets (
            symbol TEXT PRIMARY KEY,
            price_precision INTEGER,
            quantity_precision INTEGER,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS strategies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            config TEXT,
            status TEXT DEFAULT 'stopped',
            last_run DATETIME,
            is_archived BOOLEAN DEFAULT FALSE
        );

        CREATE TABLE IF NOT EXISTS strategy_risk_settings (
            strategy_id INTEGER PRIMARY KEY,
            risk_per_trade_percent REAL NOT NULL,
            stop_loss_percent REAL NOT NULL,
            take_profit_percent REAL NOT NULL,
            min_risk_reward_ratio REAL NOT NULL,
            max_portfolio_heat_percent REAL NOT NULL,
            max_open_positions INTEGER NOT NULL,
            max_trades_per_day INTEGER NOT NULL,
            max_trade_size_usd REAL NOT NULL,
            daily_loss_limit_percent REAL NOT NULL,
            daily_profit_target_percent REAL NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (strategy_id) REFERENCES strategies (id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            strategy_id INTEGER NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            symbol TEXT NOT NULL,
            side TEXT NOT NULL,
            price REAL NOT NULL,
            size_usd REAL NOT NULL,
            status TEXT,
            result REAL,
            notes TEXT,
            FOREIGN KEY (strategy_id) REFERENCES strategies (id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            strategy_id INTEGER NOT NULL,
            timestamp INTEGER DEFAULT (cast(strftime('%s','now') as integer) * 1000),
            type TEXT NOT NULL,
            payload TEXT,
            FOREIGN KEY (strategy_id) REFERENCES strategies (id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS event_scores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id INTEGER NOT NULL,
            rule_id TEXT NOT NULL,
            score REAL NOT NULL,
            actual_value TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS active_positions (
            symbol TEXT,
            strategy_id INTEGER NOT NULL,
            side TEXT,
            entry_price REAL NOT NULL,
            avg_entry_price REAL,
            size_usd REAL NOT NULL,
            stop_loss REAL,
            take_profit REAL,
            status TEXT DEFAULT 'OPEN',
            current_price REAL,
            current_pnl REAL,
            current_pnl_percent REAL,
            exit_price REAL,
            exit_timestamp DATETIME,
            price_updated_at DATETIME,
            last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (symbol, strategy_id),
            FOREIGN KEY (strategy_id) REFERENCES strategies (id) ON DELETE CASCADE
        );
    `);

    // --- AI DB Schema (DCA/AUTONOMOUS) ---
    await aiDb.exec(`
        CREATE TABLE IF NOT EXISTS ai_risk_profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            is_template BOOLEAN DEFAULT FALSE,
            risk_per_trade_percent REAL,
            max_trade_size_usd REAL,
            stop_loss_percent REAL,
            take_profit_percent REAL,
            max_portfolio_heat_percent REAL,
            max_open_positions INTEGER,
            daily_loss_limit_percent REAL,
            daily_profit_target_percent REAL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS ai_strategies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            config TEXT,
            status TEXT DEFAULT 'stopped',
            last_run DATETIME
        );

        CREATE TABLE IF NOT EXISTS ai_agent_config (
            id TEXT PRIMARY KEY,
            agent_id INTEGER NOT NULL,
            base_order_size REAL,
            max_position_cap REAL,
            deviation REAL,
            multiplier REAL,
            max_layers INTEGER,
            trade_mode TEXT CHECK(trade_mode IN ('ONE_WAY', 'HEDGE')),
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS ai_paper_trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            strategy_id INTEGER,
            symbol TEXT,
            side TEXT,
            price REAL,
            size_usd REAL,
            status TEXT,
            timestamp DATETIME,
            mode TEXT
        );

        CREATE TABLE IF NOT EXISTS ai_active_positions (
            symbol TEXT,
            strategy_id INTEGER NOT NULL,
            total_quantity REAL NOT NULL,
            total_cost REAL NOT NULL,
            avg_entry_price REAL NOT NULL,
            current_layer INTEGER DEFAULT 0,
            last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (symbol, strategy_id)
        );

        CREATE TABLE IF NOT EXISTS ai_equity_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            strategy_id INTEGER NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            equity_usd REAL,
            heat_pct REAL,
            daily_pnl_pct REAL,
            open_positions INTEGER,
            trades_today INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_ai_equity_snap_agent_time
            ON ai_equity_snapshots (strategy_id, timestamp);

        CREATE TABLE IF NOT EXISTS ai_closed_trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            strategy_id INTEGER NOT NULL,
            symbol TEXT,
            side TEXT,
            entry_price REAL,
            exit_price REAL,
            qty REAL,
            size_usd REAL,
            pnl_usd REAL,
            exit_reason TEXT,
            opened_at TEXT,
            closed_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_ai_closed_agent_time
            ON ai_closed_trades (strategy_id, closed_at);
    `);

    try {
        await db.exec('ALTER TABLE strategies ADD COLUMN is_archived BOOLEAN DEFAULT FALSE');
    } catch (e) {
        // Column already exists, ignore error
    }

    try {
        await aiDb.exec('ALTER TABLE ai_strategies ADD COLUMN risk_profile_id INTEGER REFERENCES ai_risk_profiles(id)');
    } catch (e) {
        // Column already exists, ignore error
    }

    // Late-added guardrail columns on ai_risk_profiles (frequency + R:R gates).
    const aiRiskProfileColumns = [
        'ALTER TABLE ai_risk_profiles ADD COLUMN max_trades_per_day INTEGER',
        'ALTER TABLE ai_risk_profiles ADD COLUMN min_risk_reward_ratio REAL',
    ];
    for (const stmt of aiRiskProfileColumns) {
        try { await aiDb.exec(stmt); } catch (e) { /* column exists */ }
    }

    const aiStrategyColumns = [
        'ALTER TABLE ai_strategies ADD COLUMN logic_template_id INTEGER',
        'ALTER TABLE ai_strategies ADD COLUMN watchlist TEXT',
        "ALTER TABLE ai_strategies ADD COLUMN timeframe TEXT DEFAULT '1H'",
        "ALTER TABLE ai_strategies ADD COLUMN trade_mode TEXT DEFAULT 'spot'",
        'ALTER TABLE ai_strategies ADD COLUMN paper_trading INTEGER DEFAULT 1',
        'ALTER TABLE ai_strategies ADD COLUMN portfolio_value REAL DEFAULT 10000',
        'ALTER TABLE ai_strategies ADD COLUMN cycle_interval_ms INTEGER DEFAULT 300000',
        'ALTER TABLE ai_strategies ADD COLUMN is_archived BOOLEAN DEFAULT FALSE',
        'ALTER TABLE ai_strategies ADD COLUMN ob_config TEXT',
    ];
    for (const stmt of aiStrategyColumns) {
        try { await aiDb.exec(stmt); } catch (e) { /* column exists */ }
    }

    const aiActivePositionColumns = [
        'ALTER TABLE ai_active_positions ADD COLUMN side TEXT',
        'ALTER TABLE ai_active_positions ADD COLUMN sl_price REAL',
        'ALTER TABLE ai_active_positions ADD COLUMN tp_price REAL',
        'ALTER TABLE ai_active_positions ADD COLUMN opened_at TEXT',
    ];
    for (const stmt of aiActivePositionColumns) {
        try { await aiDb.exec(stmt); } catch (e) { /* column exists */ }
    }

    return db;
}

/**
 * Creates a SQL view for real-time strategy performance metrics.
 */
export async function createStatsView() {
    const targetDb = getDB('main');
    await targetDb.exec(`
        DROP VIEW IF EXISTS strategy_stats;
        CREATE VIEW strategy_stats AS
        SELECT
            strategy_id,
            SUM(result) as netPnL,
            (COUNT(CASE WHEN status = 'CLOSED' AND result > 0 THEN 1 END) * 100.0 / NULLIF(COUNT(CASE WHEN status = 'CLOSED' THEN 1 END), 0)) as winRate,
            SUM(CASE WHEN status = 'CLOSED' AND result > 0 THEN result ELSE 0 END) / ABS(NULLIF(SUM(CASE WHEN status = 'CLOSED' AND result < 0 THEN result ELSE 0 END), 0)) as profitFactor,
            COUNT(CASE WHEN status != 'BLOCKED' THEN 1 END) as totalTrades,
            COUNT(*) as totalOrders,
            COUNT(CASE WHEN status = 'CLOSED' AND result > 0 THEN 1 END) as successfulTrades,
            COUNT(CASE WHEN status = 'CLOSED' AND result < 0 THEN 1 END) as failedTrades,
            AVG(CASE WHEN status = 'CLOSED' THEN result END) as avgTradeProfit
        FROM trades
        GROUP BY strategy_id
    `);
}

/**
 * Returns the existing database connection.
 * @param {string} type - 'main' for manual strategies, 'ai' for autonomous agents.
 * @throws {Error} If the requested database has not been initialized.
 */
export function getDB(type = 'main') {
    if (type === 'ai') {
        if (!aiDb) {
            throw new Error('AI Database not initialized. Call initDB() first.');
        }
        return aiDb;
    }
    if (!db) {
        throw new Error('Database not initialized. Call initDB() first.');
    }
    return db;
}

/**
 * Executes a set of operations within a single database transaction.
 * @param {string} type - Which DB to use ('main' or 'ai').
 * @param {function} callback - The operations to perform.
 */
export async function transaction(type = 'main', callback) {
    const targetDb = getDB(type);
    await targetDb.run('BEGIN TRANSACTION');
    try {
        const result = await callback(targetDb);
        await targetDb.run('COMMIT');
        return result;
    } catch (e) {
        await targetDb.run('ROLLBACK');
        throw e;
    }
}

/**
 * Updates a record in the database dynamically.
 * @param {string} type - Which DB to use ('main' or 'ai').
 * @param {string} table - Table name.
 * @param {object} data - Key-value pairs of columns to update.
 * @param {object} where - Key-value pairs for the WHERE clause.
 */
export async function updateRecord(type = 'main', table, data, where) {
    const targetDb = getDB(type);
    const keys = Object.keys(data);
    const values = Object.values(data);
    const setClause = keys.map(k => `${k} = ?`).join(', ');

    const whereKeys = Object.keys(where);
    const whereValues = Object.values(where);
    const whereClause = whereKeys.map(k => `${k} = ?`).join(' AND ');

    const sql = `UPDATE ${table} SET ${setClause} WHERE ${whereClause}`;
    const result = await targetDb.run(sql, [...values, ...whereValues]);
    return { changes: result.changes };
}

/**
 * Migrates existing strategy configurations to the hybrid snapshot model.
 * (Kept for legacy support in the main DB)
 */
export async function migrateToSnapshotModel() {
    const targetDb = getDB('main');
    const tableInfo = await targetDb.all("PRAGMA table_info(strategies)");
    const hasConfig = tableInfo.some(col => col.name === 'config');
    const hasLogicConfig = tableInfo.some(col => col.name === 'logic_config');

    if (!hasConfig || hasLogicConfig) return;

    const defaults = {
        risk_per_trade_percent: 1.0,
        stop_loss_percent: 2.0,
        take_profit_percent: 4.0,
        min_risk_reward_ratio: 2.0,
        max_portfolio_heat_percent: 10.0,
        max_open_positions: 5,
        max_trades_per_day: 10,
        max_trade_size_usd: 100,
        daily_loss_limit_percent: 3.0,
        daily_profit_target_percent: 5.0
    };

    try {
        const strategies = await targetDb.all('SELECT id, config FROM strategies');
        for (const strategy of strategies) {
            let config = {};
            try { config = JSON.parse(strategy.config || '{}'); } catch (e) {}
            const risk = {
                strategy_id: strategy.id,
                risk_per_trade_percent: config.risk_per_trade_percent ?? defaults.risk_per_trade_percent,
                stop_loss_percent: config.stop_loss_percent ?? defaults.stop_loss_percent,
                take_profit_percent: config.take_profit_percent ?? defaults.take_profit_percent,
                min_risk_reward_ratio: config.min_risk_reward_ratio ?? defaults.min_risk_reward_ratio,
                max_portfolio_heat_percent: config.max_portfolio_heat_percent ?? defaults.max_portfolio_heat_percent,
                max_open_positions: config.max_open_positions ?? defaults.max_open_positions,
                max_trades_per_day: config.max_trades_per_day ?? defaults.max_trades_per_day,
                max_trade_size_usd: config.max_trade_size_usd ?? defaults.max_trade_size_usd,
                daily_loss_limit_percent: config.daily_loss_limit_percent ?? defaults.daily_loss_limit_percent,
                daily_profit_target_percent: config.daily_profit_target_percent ?? defaults.daily_profit_target_percent,
            };
            await targetDb.run(`
                INSERT OR REPLACE INTO strategy_risk_settings
                (strategy_id, risk_per_trade_percent, stop_loss_percent, take_profit_percent, min_risk_reward_ratio, max_portfolio_heat_percent, max_open_positions, max_trades_per_day, max_trade_size_usd, daily_loss_limit_percent, daily_profit_target_percent)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, Object.values(risk));
            const logicConfig = { ...config };
            ['risk_per_trade_percent', 'stop_loss_percent', 'take_profit_percent', 'min_risk_reward_ratio', 'max_portfolio_heat_percent', 'max_open_positions', 'max_trades_per_day', 'max_trade_size_usd', 'daily_loss_limit_percent', 'daily_profit_target_percent'].forEach(k => delete logicConfig[k]);
            await targetDb.run('UPDATE strategies SET config = ? WHERE id = ?', [JSON.stringify(logicConfig), strategy.id]);
        }
        await targetDb.exec('ALTER TABLE strategies RENAME COLUMN config TO logic_config');
    } catch (e) {
        console.error(`Migration failed: ${e.message}`);
    }
}
