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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);        // page-level (groups) failure
  const [runsError, setRunsError] = useState<string | null>(null); // localized runs-table failure

  const navigate = useNavigate();

  useEffect(() => {
    backtestApi.getGroups()
      .then(res => {
        setGroups(res.data);
        if (res.data.length) setSelected(res.data[0].group ?? 'ungrouped');
      })
      .catch(e => setError(e?.message ?? 'Failed to load backtest groups'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (selected == null) return;
    // Guard against out-of-order responses when the user switches groups quickly:
    // a stale resolve is ignored once a newer selection has superseded it.
    // (The visible reset of runs/runsError happens in the select's onChange — doing it
    // here would be a synchronous setState in an effect body.)
    let cancelled = false;
    backtestApi.getGroup(selected)
      .then(res => { if (!cancelled) setRuns(res.data.runs); })
      .catch(e => { if (!cancelled) setRunsError(e?.message ?? 'Failed to load runs'); });
    return () => { cancelled = true; };
  }, [selected]);

  if (loading) return <Card className="p-6 text-muted-foreground">Loading…</Card>;
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
          onChange={e => { setRuns([]); setRunsError(null); setSelected(e.target.value); }}
        >
          {groups.map(g => (
            <option key={g.label} value={g.group ?? 'ungrouped'}>
              {g.label} ({g.runCount})
            </option>
          ))}
        </select>
      </div>
      {/* A transient runs failure stays local so the group selector remains usable. */}
      {runsError
        ? <Card className="p-6 text-red-500">Error loading runs: {runsError}</Card>
        : <BacktestComparisonTable rows={runs} onSelect={id => navigate(`/backtest/run/${id}`)} />}
    </div>
  );
}
