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
    try {
      const stmt = await this.db.prepare(
        `INSERT OR IGNORE INTO candles (symbol, timeframe, time, open, high, low, close, volume)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const k of candles) {
        const r = await stmt.run(symbol, timeframe, k.time, k.open, k.high, k.low, k.close, k.volume);
        inserted += r.changes || 0;
      }
      await stmt.finalize();
      await this.db.run('COMMIT');
    } catch (e) {
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
}
