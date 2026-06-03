/** JSON.stringify replacer: map any non-finite number (Infinity/-Infinity/NaN) to null. */
function finite(key, value) {
  return typeof value === 'number' && !Number.isFinite(value) ? null : value;
}

/**
 * Repository over the backtest-results SQLite db. The only place that knows SQL for
 * backtest runs / trades / equity curves — the storage backend is swappable behind it.
 */
export class BacktestRepo {
  constructor(db) {
    this.db = db;
  }

  /** Insert a run (metadata + JSON params/costs/metrics). Returns the new run id. */
  async saveRun(run) {
    const r = await this.db.run(
      `INSERT INTO backtest_runs
         (strategy_label, logic_type, symbol, timeframe, period_from, period_to, leverage, params_json, costs_json, metrics_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [run.strategyLabel, run.logicType, run.symbol, run.timeframe, run.periodFrom, run.periodTo, run.leverage,
       JSON.stringify(run.params || {}, finite), JSON.stringify(run.costs || {}, finite), JSON.stringify(run.metrics || {}, finite)]
    );
    return r.lastID;
  }

  /** Insert trades for a run (indexed by position in the array). Returns rows inserted. */
  async saveTrades(runId, trades) {
    if (!trades.length) return 0;
    let inserted = 0;
    await this.db.run('BEGIN');
    let stmt;
    try {
      stmt = await this.db.prepare(
        `INSERT OR REPLACE INTO backtest_trades
           (run_id, idx, side, entry_time, entry_price, exit_time, exit_price, size_usd, pnl, fees, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (let i = 0; i < trades.length; i++) {
        const t = trades[i];
        const res = await stmt.run(runId, i, t.side, t.entryTime, t.entryPrice, t.exitTime, t.exitPrice, t.sizeUSD, t.pnl, t.fees, t.reason);
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

  /** Insert per-bar equity points for a run. Returns rows inserted. */
  async saveEquityCurve(runId, curve) {
    if (!curve.length) return 0;
    let inserted = 0;
    await this.db.run('BEGIN');
    let stmt;
    try {
      stmt = await this.db.prepare('INSERT OR REPLACE INTO equity_curve (run_id, time, equity) VALUES (?, ?, ?)');
      for (const pt of curve) {
        const res = await stmt.run(runId, pt.time, pt.equity);
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

  /** A run row by id, or undefined. */
  async getRun(id) {
    return this.db.get('SELECT * FROM backtest_runs WHERE id = ?', [id]);
  }

  /** Trades for a run, ascending by idx. */
  async getTrades(runId) {
    return this.db.all('SELECT * FROM backtest_trades WHERE run_id = ? ORDER BY idx ASC', [runId]);
  }

  /** Equity curve for a run, ascending by time. */
  async getEquityCurve(runId) {
    return this.db.all('SELECT time, equity FROM equity_curve WHERE run_id = ? ORDER BY time ASC', [runId]);
  }

  /** All runs, most recent first. */
  async listRuns() {
    return this.db.all('SELECT * FROM backtest_runs ORDER BY id DESC');
  }
}
