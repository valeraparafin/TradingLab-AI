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
            last_run DATETIME
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
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            type TEXT NOT NULL,
            payload TEXT,
            FOREIGN KEY (strategy_id) REFERENCES strategies (id) ON DELETE CASCADE
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

    return db;
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
