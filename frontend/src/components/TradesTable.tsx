import type { BacktestTrade } from '../lib/api';
import { Card } from './ui/components';

const time = (t: number) => new Date(t).toLocaleString();

export function TradesTable({ trades }: { trades: BacktestTrade[] }) {
  if (!trades.length) return <Card className="p-6 text-muted-foreground">No trades.</Card>;
  return (
    <Card className="p-0 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground border-b border-border">
            <th className="p-2">#</th><th className="p-2">Side</th><th className="p-2">Entry</th>
            <th className="p-2">Exit</th><th className="p-2">Size$</th><th className="p-2">PnL</th>
            <th className="p-2">Fees</th><th className="p-2">Reason</th>
          </tr>
        </thead>
        <tbody>
          {trades.map(t => (
            <tr key={t.idx} className="border-b border-border">
              <td className="p-2">{t.idx}</td>
              <td className={'p-2 font-medium ' + (t.side === 'BUY' ? 'text-green-500' : 'text-red-500')}>{t.side}</td>
              <td className="p-2">{time(t.entryTime)}<div className="text-xs text-muted-foreground">{t.entryPrice}</div></td>
              <td className="p-2">{time(t.exitTime)}<div className="text-xs text-muted-foreground">{t.exitPrice}</div></td>
              <td className="p-2">{t.sizeUSD?.toFixed(2)}</td>
              <td className={'p-2 ' + (t.pnl >= 0 ? 'text-green-500' : 'text-red-500')}>{t.pnl?.toFixed(2)}</td>
              <td className="p-2">{t.fees?.toFixed(2)}</td>
              <td className="p-2">{t.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
