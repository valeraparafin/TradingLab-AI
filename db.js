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
