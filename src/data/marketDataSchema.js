import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

/**
 * Opens (and creates if needed) the dedicated market-data SQLite database.
 * Separate from trading_lab.db / ai_trading.db so bulk append-only market data
 * never bloats the operational databases.
 * @param {string} filename Absolute path to the .db file.
 * @returns {Promise<import('sqlite').Database>}
 */
export async function openMarketDb(filename) {
  const db = await open({ filename, driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS candles (
      symbol     TEXT    NOT NULL,
      timeframe  TEXT    NOT NULL,
      time       INTEGER NOT NULL,
      open       REAL    NOT NULL,
      high       REAL    NOT NULL,
      low        REAL    NOT NULL,
      close      REAL    NOT NULL,
      volume     REAL    NOT NULL,
      PRIMARY KEY (symbol, timeframe, time)
    );

    CREATE TABLE IF NOT EXISTS funding_rates (
      symbol TEXT    NOT NULL,
      time   INTEGER NOT NULL,
      rate   REAL    NOT NULL,
      PRIMARY KEY (symbol, time)
    );

    CREATE TABLE IF NOT EXISTS contract_specs (
      symbol           TEXT PRIMARY KEY,
      mmr              REAL,
      max_leverage     INTEGER,
      min_leverage     INTEGER,
      taker_fee        REAL,
      maker_fee        REAL,
      fund_interval_h  INTEGER,
      tick_size        REAL,
      qty_step         REAL,
      price_precision  INTEGER,
      qty_precision    INTEGER,
      min_trade_num    REAL,
      min_trade_usdt   REAL,
      updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_candles_symbol_tf_time ON candles (symbol, timeframe, time);
  `);
  return db;
}
