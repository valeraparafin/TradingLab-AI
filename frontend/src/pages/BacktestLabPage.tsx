import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { backtestApi } from '../lib/api';
import type { BacktestGroup, BacktestRunRow } from '../lib/api';
import { Card } from '../components/ui/components';
import { BacktestComparisonTable } from '../components/BacktestComparisonTable';

export function BacktestLabPage() {
  const [groups, setGroups] = useState<BacktestGroup[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [runs, setRuns] = useState<BacktestRunRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    backtestApi.getGroups()
      .then(res => {
        setGroups(res.data);
        if (res.data.length) setSelected(res.data[0].group ?? 'ungrouped');
      })
      .catch(e => setError(e.message));
  }, []);

  useEffect(() => {
    if (selected == null) return;
    backtestApi.getGroup(selected)
      .then(res => setRuns(res.data.runs))
      .catch(e => setError(e.message));
  }, [selected]);

  if (error) return <Card className="p-6 text-red-500">Error: {error}</Card>;
  if (!groups.length) {
    return (
      <Card className="p-6 text-muted-foreground">
        No backtest runs yet — run <code className="text-foreground">node backtest/run-matrix.js …</code>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <h2 className="text-xl font-bold">Backtest Lab</h2>
        <select
          className="bg-muted border border-border rounded-md px-3 py-1 text-sm"
          value={selected ?? ''}
          onChange={e => setSelected(e.target.value)}
        >
          {groups.map(g => (
            <option key={g.label} value={g.group ?? 'ungrouped'}>
              {g.label} ({g.runCount})
            </option>
          ))}
        </select>
      </div>
      <BacktestComparisonTable rows={runs} onSelect={id => navigate(`/backtest/run/${id}`)} />
    </div>
  );
}
