import type { BacktestRunRow } from '../lib/api';
import { Card } from './ui/components';

const pct = (v: number | null) => (v == null || !isFinite(v) ? '—' : (v * 100).toFixed(2) + '%');
const num = (v: number | null) => (v == null || !isFinite(v) ? '—' : v.toFixed(2));
const pf = (v: number | null) => (v == null || !isFinite(v) ? '∞' : v.toFixed(2));

interface Props {
  rows: BacktestRunRow[];
  onSelect: (id: number) => void;
}

export function BacktestComparisonTable({ rows, onSelect }: Props) {
  if (!rows.length) return <Card className="p-6 text-muted-foreground">No runs in this group.</Card>;
  return (
    <Card className="p-0 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground border-b border-border">
            <th className="p-2">Strategy</th><th className="p-2">Sym</th><th className="p-2">TF</th>
            <th className="p-2">Lev</th><th className="p-2">Trades</th><th className="p-2">Win%</th>
            <th className="p-2">PF</th><th className="p-2">Net%</th><th className="p-2">Equity</th>
            <th className="p-2">MaxDD%</th><th className="p-2">Sharpe</th><th className="p-2">Funding</th><th className="p-2">Liq</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr
              key={r.id}
              className="border-b border-border hover:bg-muted cursor-pointer"
              onClick={() => onSelect(r.id)}
            >
              <td className="p-2 font-medium">{r.label}</td>
              <td className="p-2">{r.symbol}</td>
              <td className="p-2">{r.tf}</td>
              <td className="p-2">{r.leverage}x</td>
              <td className="p-2">{r.trades}</td>
              <td className="p-2">{pct(r.winRate)}</td>
              <td className="p-2">{pf(r.profitFactor)}</td>
              <td className={'p-2 ' + ((r.netPnlPct ?? 0) >= 0 ? 'text-green-500' : 'text-red-500')}>{pct(r.netPnlPct)}</td>
              <td className="p-2">{num(r.finalEquity)}</td>
              <td className="p-2">{pct(r.maxDrawdownPct)}</td>
              <td className="p-2">{num(r.sharpe)}</td>
              <td className="p-2">{num(r.totalFunding)}</td>
              <td className="p-2">{r.liquidations}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
