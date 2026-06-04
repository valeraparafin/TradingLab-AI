import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { backtestApi } from '../lib/api';
import type { BacktestRunDetail } from '../lib/api';
import { Card } from '../components/ui/components';
import { EquityCurveChart } from '../components/EquityCurveChart';
import { TradesTable } from '../components/TradesTable';
import { pct, num } from '../lib/formatters';

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="p-4 rounded-lg bg-muted border border-border">
    <div className="text-xs text-muted-foreground uppercase">{label}</div>
    <div className="text-2xl font-bold">{value}</div>
  </div>
);

export function BacktestRunPage() {
  const { id } = useParams();
  const [detail, setDetail] = useState<BacktestRunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    backtestApi.getRun(Number(id))
      .then(res => setDetail(res.data))
      .catch(e => setError(e.response?.status === 404 ? 'Run not found' : e.message));
  }, [id]);

  if (error) {
    return (
      <Card className="p-6">
        <div className="text-red-500 mb-4">{error}</div>
        <Link to="/backtest" className="text-primary">← Back to Backtest Lab</Link>
      </Card>
    );
  }
  if (!detail) return <Card className="p-6 text-muted-foreground">Loading…</Card>;

  const m = detail.run.metrics || {};

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">{detail.run.label}</h2>
        <Link to="/backtest" className="text-sm text-primary">← Back</Link>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Net PnL" value={pct(m.return?.netPnlPct)} />
        <Stat label="Final Equity" value={num(m.return?.finalEquity)} />
        <Stat label="Win Rate" value={pct(m.trades?.winRate)} />
        <Stat label="Trades" value={String(m.trades?.count ?? 0)} />
        <Stat label="Max Drawdown" value={pct(m.risk?.maxDrawdownPct)} />
        <Stat label="Sharpe" value={num(m.risk?.sharpe)} />
        <Stat label="Funding" value={num(m.costs?.totalFunding)} />
        <Stat label="Liquidations" value={String(m.costs?.liquidationCount ?? 0)} />
      </div>
      <Card className="p-6">
        <h3 className="text-lg font-bold mb-4">Equity Curve</h3>
        <EquityCurveChart data={detail.equityCurve} />
      </Card>
      <div>
        <h3 className="text-lg font-bold mb-4">Trades</h3>
        <TradesTable trades={detail.trades} />
      </div>
    </div>
  );
}
