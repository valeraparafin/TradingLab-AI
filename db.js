import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

let db = null;

/**
 * Initializes the SQLite database and creates necessary tables.
 * @returns {Promise<import('sqlite').Database>} The database connection.
 */
export async function initDB() {
    db = await open({
        filename: './trading_lab.db',
        driver: sqlite3.Database
    });

    // Enable foreign key constraints
    await db.get('PRAGMA foreign_keys = ON');

    // Create tables
    await db.exec(`
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
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            strategy_id INTEGER NOT NULL,
            symbol TEXT NOT NULL,
            side TEXT NOT NULL,
            entry_price REAL NOT NULL,
            size_usd REAL NOT NULL,
            stop_loss REAL,
            take_profit REAL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (strategy_id) REFERENCES strategies (id) ON DELETE CASCADE
        );
    `);

    try {
        await db.exec('ALTER TABLE strategies ADD COLUMN is_archived BOOLEAN DEFAULT FALSE');
    } catch (e) {
        // Column already exists, ignore error
    }

    try {
        await db.exec('ALTER TABLE active_positions ADD COLUMN status TEXT DEFAULT \'OPEN\'');
        await db.exec('ALTER TABLE active_positions ADD COLUMN exit_price REAL');
        await db.exec('ALTER TABLE active_positions ADD COLUMN exit_timestamp DATETIME');
        await db.exec('UPDATE active_positions SET status = \'OPEN\' WHERE status IS NULL');
    } catch (e) {
        // Columns already exist, ignore error
    }

    return db;
}

/**
 * Creates a SQL view for real-time strategy performance metrics.
 */
export async function createStatsView() {
    const db = getDB();
    await db.exec(`
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

 * @throws {Error} If the database has not been initialized.
 */
export function getDB() {
    if (!db) {
        throw new Error('Database not initialized. Call initDB() first.');
    }
    return db;
}

/**
 * Executes a set of operations within a single database transaction.
 * @param {function(import('sqlite').Database): Promise<any>} callback The operations to perform.
 * @returns {Promise<any>} The result of the callback.
 * @throws {Error} If the transaction fails.
 */
export async function transaction(callback) {
    const db = getDB();
    await db.run('BEGIN TRANSACTION');
    try {
        const result = await callback(db);
        await db.run('COMMIT');
        return result;
    } catch (e) {
        await db.run('ROLLBACK');
        throw e;
    }
}

/**
 * Updates a record in the database dynamically.
 * @param {string} table Table name.
 * @param {object} data Key-value pairs of columns to update.
 * @param {object} where Key-value pairs for the WHERE clause.
 * @returns {Promise<{changes: number}>}
 */
export async function updateRecord(table, data, where) {
    const db = getDB();
    const keys = Object.keys(data);
    const values = Object.values(data);
    const setClause = keys.map(k => `${k} = ?`).join(', ');

    const whereKeys = Object.keys(where);
    const whereValues = Object.values(where);
    const whereClause = whereKeys.map(k => `${k} = ?`).join(' AND ');

    const sql = `UPDATE ${table} SET ${setClause} WHERE ${whereClause}`;
    const result = await db.run(sql, [...values, ...whereValues]);
    return { changes: result.changes };
}

/**
 * Migrates existing strategy configurations to the hybrid snapshot model.
 * Extracts risk settings into strategy_risk_settings and renames config to logic_config.
 */
export async function migrateToSnapshotModel() {
    const db = getDB();

    // Professional defaults
    const defaults = {
        risk_per_trade_percent: 1.0,
        stop_loss_percent: 2.0,
        take_profit_percent: 4.0,
        min_risk_reward_ratio: 2.0,
        max_portfolio_heat_percent: 10.0,
        max_open_positions: 5,
        max_trades_per_day: 10,
        daily_loss_limit_percent: 3.0,
        daily_profit_target_percent: 5.0
    };

    try {
        const strategies = await db.all('SELECT id, config FROM strategies');

        for (const strategy of strategies) {
            let config = {};
            try {
                config = JSON.parse(strategy.config || '{}');
            } catch (e) {
                console.warn(`Failed to parse config for strategy ${strategy.id}: ${e.message}`);
            }

            const risk = {
                strategy_id: strategy.id,
                risk_per_trade_percent: config.risk_per_trade_percent ?? defaults.risk_per_trade_percent,
                stop_loss_percent: config.stop_loss_percent ?? defaults.stop_loss_percent,
                take_profit_percent: config.take_profit_percent ?? defaults.take_profit_percent,
                min_risk_reward_ratio: config.min_risk_reward_ratio ?? defaults.min_risk_reward_ratio,
                max_portfolio_heat_percent: config.max_portfolio_heat_percent ?? defaults.max_portfolio_heat_percent,
                max_open_positions: config.max_open_positions ?? defaults.max_open_positions,
                max_trades_per_day: config.max_trades_per_day ?? defaults.max_trades_per_day,
                daily_loss_limit_percent: config.daily_loss_limit_percent ?? defaults.daily_loss_limit_percent,
                daily_profit_target_percent: config.daily_profit_target_percent ?? defaults.daily_profit_target_percent,
            };

            await db.run(`
                INSERT OR REPLACE INTO strategy_risk_settings
                (strategy_id, risk_per_trade_percent, stop_loss_percent, take_profit_percent, min_risk_reward_ratio, max_portfolio_heat_percent, max_open_positions, max_trades_per_day, daily_loss_limit_percent, daily_profit_target_percent)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, Object.values(risk));

            // Remove risk params from logic config
            const logicConfig = { ...config };
            delete logicConfig.risk_per_trade_percent;
            delete logicConfig.stop_loss_percent;
            delete logicConfig.take_profit_percent;
            delete logicConfig.min_risk_reward_ratio;
            delete logicConfig.max_portfolio_heat_percent;
            delete logicConfig.max_open_positions;
            delete logicConfig.max_trades_per_day;
            delete logicConfig.daily_loss_limit_percent;
            delete logicConfig.daily_profit_target_percent;

            await db.run('UPDATE strategies SET config = ? WHERE id = ?', [JSON.stringify(logicConfig), strategy.id]);
        }

        // Rename column config to logic_config
        // SQLite 3.25.0+ supports RENAME COLUMN
        try {
            await db.exec('ALTER TABLE strategies RENAME COLUMN config TO logic_config');
        } catch (e) {
            console.error(`Failed to rename column: ${e.message}. Ensure SQLite version is 3.25.0+`);
            throw e;
        }

        console.log('Successfully migrated to snapshot model.');
    } catch (e) {
        console.error(`Migration failed: ${e.message}`);
        throw e;
    }
}

