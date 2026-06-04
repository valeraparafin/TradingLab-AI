import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import type { EquityPoint } from '../lib/api';

export function EquityCurveChart({ data }: { data: EquityPoint[] }) {
  if (!data.length) return <div className="text-muted-foreground">No equity data.</div>;
  const fmtDate = (t: number) => new Date(t).toLocaleDateString();
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#333" />
        <XAxis dataKey="time" tickFormatter={fmtDate} stroke="#888" fontSize={12} />
        <YAxis domain={['auto', 'auto']} stroke="#888" fontSize={12} />
        <Tooltip
          labelFormatter={(t) => new Date(Number(t)).toLocaleString()}
          formatter={(v) => [Number(v).toFixed(2), 'Equity']}
        />
        <Line type="monotone" dataKey="equity" stroke="#22c55e" dot={false} strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  );
}
