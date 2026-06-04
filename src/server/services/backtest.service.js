// src/server/services/backtest.service.js
import path from 'path';
import { openBacktestDb } from '../../backtest/backtestSchema.js';
import { BacktestRepo } from '../../backtest/BacktestRepo.js';

/** Parse a JSON column safely; return `fallback` on null/parse error. */
function parseJson(s, fallback) {
  if (s == null) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

/** Nullish-safe descending comparator on netPnlPct (mirrors buildReport). */
const byNetPnlDesc = (a, b) => (b.netPnlPct ?? -Infinity) - (a.netPnlPct ?? -Infinity);

/** Map a raw snake_case run row to a flat camelCase comparison-table DTO. */
function toRow(run) {
  const m = parseJson(run.metrics_json, {});
  return {
    id: run.id,
    label: run.strategy_label,
    logicType: run.logic_type,
    symbol: run.symbol,
    tf: run.timeframe,
    leverage: run.leverage,
    trades: m.trades?.count ?? 0,
    winRate: m.trades?.winRate ?? null,
    profitFactor: m.trades?.profitFactor ?? null,
    netPnlPct: m.return?.netPnlPct ?? null,
    finalEquity: m.return?.finalEquity ?? null,
    maxDrawdownPct: m.risk?.maxDrawdownPct ?? null,
    sharpe: m.risk?.sharpe ?? null,
    totalFunding: m.costs?.totalFunding ?? null,
    liquidations: m.costs?.liquidationCount ?? 0,
  };
}

/** Map a raw snake_case trade row to a camelCase DTO. */
function toTrade(t) {
  return {
    idx: t.idx, side: t.side,
    entryTime: t.entry_time, entryPrice: t.entry_price,
    exitTime: t.exit_time, exitPrice: t.exit_price,
    sizeUSD: t.size_usd, pnl: t.pnl, fees: t.fees, reason: t.reason,
  };
}

/**
 * Build a read-only backtest service over an injected BacktestRepo.
 * Exposed for tests (drive a :memory: db); production uses the lazy singleton below.
 */
export function createBacktestService(repo) {
  return {
    async listGroups() {
      const rows = await repo.listGroups();
      return rows.map(r => ({
        group: r.group ?? null,
        label: r.group ?? '(ungrouped)',
        runCount: r.run_count,
        periodFrom: r.period_from,
        periodTo: r.period_to,
        latestRunId: r.latest_run_id,
      }));
    },

    async getGroup(group) {
      // 'ungrouped' is a reserved UI sentinel for the null run_group bucket. A matrix
      // launched with a literal `--group ungrouped` would be unreachable here; treat
      // that name as reserved if a CLI guard is added in a later phase.
      const isNull = group == null || group === 'ungrouped';
      const runs = isNull ? await repo.listUngroupedRuns() : await repo.listRunsByGroup(group);
      return { group: isNull ? null : group, runs: runs.map(toRow).sort(byNetPnlDesc) };
    },

    async getRunDetail(id) {
      const run = await repo.getRun(id);
      if (!run) return null;
      const [equityCurve, rawTrades] = await Promise.all([repo.getEquityCurve(id), repo.getTrades(id)]);
      return {
        run: {
          id: run.id,
          label: run.strategy_label,
          logicType: run.logic_type,
          symbol: run.symbol,
          tf: run.timeframe,
          leverage: run.leverage,
          periodFrom: run.period_from,
          periodTo: run.period_to,
          group: run.run_group ?? null,
          metrics: parseJson(run.metrics_json, {}),
          params: parseJson(run.params_json, {}),
          costs: parseJson(run.costs_json, {}),
        },
        equityCurve,
        trades: rawTrades.map(toTrade),
      };
    },
  };
}

// Lazy singleton: open backtest.db once on first request. openBacktestDb runs
// idempotent CREATE-TABLE DDL, so a never-run-a-matrix machine yields an empty
// (valid) db and endpoints return empty arrays instead of erroring.
let _instancePromise = null;
async function getInstance() {
  if (!_instancePromise) {
    _instancePromise = (async () => {
      const db = await openBacktestDb(path.join(process.cwd(), 'backtest.db'));
      return createBacktestService(new BacktestRepo(db));
    })();
  }
  return _instancePromise;
}

export const backtestService = {
  listGroups: async () => (await getInstance()).listGroups(),
  getGroup: async (g) => (await getInstance()).getGroup(g),
  getRunDetail: async (id) => (await getInstance()).getRunDetail(id),
};
