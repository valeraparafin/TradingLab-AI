import React from 'react';
import { Card } from '../ui/components';
import { cn } from '../../lib/utils';

interface RiskGaugesProps {
  heat: number; // 0 to 100
  state: 'NORMAL' | 'CAUTION' | 'PANIC';
  equityTrend: number[]; // array of PnL values
}

export function RiskGauges({ heat, state, equityTrend }: RiskGaugesProps) {
  const getStateColor = () => {
    switch (state) {
      case 'PANIC': return 'text-red-500 bg-red-500/10 border-red-500/20';
      case 'CAUTION': return 'text-yellow-500 bg-yellow-500/10 border-yellow-500/20';
      default: return 'text-green-500 bg-green-500/10 border-green-500/20';
    }
  };

  return (
    <Card className="p-4 space-y-6 bg-background/50 backdrop-blur-sm border-border/50">
      <div>
        <div className="flex justify-between items-end mb-2">
          <span className="text-xs uppercase font-bold text-muted-foreground tracking-wider">Portfolio Heat</span>
          <span className={cn("text-xl font-mono font-bold", heat > 70 ? "text-red-500" : heat > 30 ? "text-yellow-500" : "text-green-500")}>
            {heat.toFixed(1)}%
          </span>
        </div>
        <div className="h-3 w-full bg-muted rounded-full overflow-hidden p-0.5 border border-border/50">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-1000 ease-out",
              heat > 70 ? "bg-gradient-to-r from-yellow-500 to-red-600" : heat > 30 ? "bg-gradient-to-r from-green-500 to-yellow-500" : "bg-green-500"
            )}
            style={{ width: `${Math.min(heat, 100)}%` }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between p-3 rounded-xl border bg-muted/30">
        <span className="text-xs uppercase font-bold text-muted-foreground">Risk State</span>
        <div className={cn("px-3 py-1 rounded-full text-[10px] font-black uppercase border", getStateColor())}>
          {state}
        </div>
      </div>

      <div>
        <span className="text-xs uppercase font-bold text-muted-foreground block mb-3">Equity Curve</span>
        <div className="h-12 w-full flex items-end gap-1">
          {equityTrend.map((val, i) => (
            <div
              key={i}
              className={cn("flex-1 rounded-t-sm transition-all duration-500", val >= 0 ? "bg-green-500/40" : "bg-red-500/40")}
              style={{ height: `${Math.min(Math.abs(val) * 2 + 10, 100)}%` }}
            />
          ))}
        </div>
      </div>
    </Card>
  );
}
