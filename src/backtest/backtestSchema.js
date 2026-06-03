import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

/**
 * Opens (and creates if needed) the dedicated backtest-results SQLite database.
 * Separate from market_data.db so results never mix with the market-data cache.
 * @param {string} filename Path to the .db file.
 * @returns {Promise<import('sqlite').Database>}
 */
export async function openBacktestDb(filename) {
  const db = await open({ filename, driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS backtest_runs (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      strategy_label TEXT    NOT NULL,
      logic_type     TEXT    NOT NULL,
      symbol         TEXT    NOT NULL,
      timeframe      TEXT    NOT NULL,
      period_from    INTEGER,
      period_to      INTEGER,
      leverage       REAL    NOT NULL,
      params_json    TEXT,
      costs_json     TEXT,
      metrics_json   TEXT
    );

    CREATE TABLE IF NOT EXISTS backtest_trades (
      run_id      INTEGER NOT NULL,
      idx         INTEGER NOT NULL,
      side        TEXT    NOT NULL,
      entry_time  INTEGER NOT NULL,
      entry_price REAL    NOT NULL,
      exit_time   INTEGER NOT NULL,
      exit_price  REAL    NOT NULL,
      size_usd    REAL    NOT NULL,
      pnl         REAL    NOT NULL,
      fees        REAL    NOT NULL,
      reason      TEXT    NOT NULL,
      PRIMARY KEY (run_id, idx)
    );

    CREATE TABLE IF NOT EXISTS equity_curve (
      run_id INTEGER NOT NULL,
      time   INTEGER NOT NULL,
      equity REAL    NOT NULL,
      PRIMARY KEY (run_id, time)
    );

    CREATE INDEX IF NOT EXISTS idx_runs_symbol_tf ON backtest_runs (symbol, timeframe);
  `);
  return db;
}
