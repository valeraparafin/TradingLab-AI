/**
 * Repository over the market-data SQLite db. The ONLY place that knows SQL for
 * candles / funding / contract specs — the storage backend is swappable behind it.
 */
export class MarketDataRepo {
  constructor(db) {
    this.db = db;
  }

  /**
   * Idempotently insert candles (INSERT OR IGNORE on PK). Returns rows actually inserted.
   * @returns {Promise<number>}
   */
  async upsertCandles(symbol, timeframe, candles) {
    if (!candles.length) return 0;
    let inserted = 0;
    await this.db.run('BEGIN');
    let stmt;
    try {
      stmt = await this.db.prepare(
        `INSERT OR IGNORE INTO candles (symbol, timeframe, time, open, high, low, close, volume)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const candle of candles) {
        const r = await stmt.run(symbol, timeframe, candle.time, candle.open, candle.high, candle.low, candle.close, candle.volume);
        inserted += r.changes || 0;
      }
      await stmt.finalize();
      await this.db.run('COMMIT');
    } catch (e) {
      if (stmt) { try { await stmt.finalize(); } catch (_) {} }
      await this.db.run('ROLLBACK');
      throw e;
    }
    return inserted;
  }

  /** Candles in [from, to] inclusive, ascending by time. */
  async getCandles(symbol, timeframe, from, to) {
    return this.db.all(
      `SELECT time, open, high, low, close, volume FROM candles
       WHERE symbol = ? AND timeframe = ? AND time >= ? AND time <= ?
       ORDER BY time ASC`,
      [symbol, timeframe, from, to]
    );
  }

  /** Latest stored candle time, or null. */
  async lastCandleTime(symbol, timeframe) {
    const row = await this.db.get(
      'SELECT MAX(time) AS t FROM candles WHERE symbol = ? AND timeframe = ?',
      [symbol, timeframe]
    );
    return row && row.t != null ? row.t : null;
  }

  /** Missing candle timestamps between the first and last stored candle (step = tfMs). */
  async findGaps(symbol, timeframe, tfMs) {
    const rows = await this.db.all(
      'SELECT time FROM candles WHERE symbol = ? AND timeframe = ? ORDER BY time ASC',
      [symbol, timeframe]
    );
    if (rows.length < 2) return [];
    const present = new Set(rows.map(r => r.time));
    const gaps = [];
    for (let t = rows[0].time + tfMs; t < rows[rows.length - 1].time; t += tfMs) {
      if (!present.has(t)) gaps.push(t);
    }
    return gaps;
  }

  /** Idempotently insert funding rows [{time, rate}]. Returns rows inserted. */
  async upsertFunding(symbol, rows) {
    if (!rows.length) return 0;
    let inserted = 0;
    await this.db.run('BEGIN');
    let stmt;
    try {
      stmt = await this.db.prepare(
        'INSERT OR IGNORE INTO funding_rates (symbol, time, rate) VALUES (?, ?, ?)'
      );
      for (const r of rows) {
        const res = await stmt.run(symbol, r.time, r.rate);
        inserted += res.changes || 0;
      }
      await stmt.finalize();
      await this.db.run('COMMIT');
    } catch (e) {
      if (stmt) { try { await stmt.finalize(); } catch (_) {} }
      await this.db.run('ROLLBACK');
      throw e;
    }
    return inserted;
  }

  /** Funding rows in [from, to] inclusive, ascending by time. */
  async getFunding(symbol, from, to) {
    return this.db.all(
      'SELECT time, rate FROM funding_rates WHERE symbol = ? AND time >= ? AND time <= ? ORDER BY time ASC',
      [symbol, from, to]
    );
  }

  /** Insert/replace a contract spec row (object shaped like parseContract output). */
  async upsertContractSpec(s) {
    await this.db.run(
      `INSERT OR REPLACE INTO contract_specs
         (symbol, mmr, max_leverage, min_leverage, taker_fee, maker_fee, fund_interval_h,
          tick_size, qty_step, price_precision, qty_precision, min_trade_num, min_trade_usdt, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [s.symbol, s.mmr, s.max_leverage, s.min_leverage, s.taker_fee, s.maker_fee, s.fund_interval_h,
       s.tick_size, s.qty_step, s.price_precision, s.qty_precision, s.min_trade_num, s.min_trade_usdt]
    );
  }

  /** Contract spec row for a symbol, or undefined. */
  async getContractSpec(symbol) {
    return this.db.get('SELECT * FROM contract_specs WHERE symbol = ?', [symbol]);
  }
}
