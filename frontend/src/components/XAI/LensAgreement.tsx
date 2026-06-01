import React from 'react';
import { Card } from '../ui/components';
import { cn } from '../../lib/utils';

interface LensData {
  lens: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
}

interface LensAgreementProps {
  lenses: LensData[];
  consensus: number;
}

export function LensAgreement({ lenses, consensus }: LensAgreementProps) {
  const getSentimentColor = (s: string) => {
    switch (s) {
      case 'bullish': return 'bg-green-500';
      case 'bearish': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  return (
    <Card className="p-4 space-y-4 bg-background/50 backdrop-blur-sm border-border/50">
      <div className="flex justify-between items-center mb-2">
        <span className="text-xs uppercase font-bold text-muted-foreground tracking-wider">Expert Council</span>
        <span className="text-sm font-mono font-bold">Consensus: {(consensus * 100).toFixed(0)}%</span>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {lenses.map((l, i) => (
          <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-muted/20 border border-border/30">
            <div className={cn("w-2 h-2 rounded-full", getSentimentColor(l.sentiment))} />
            <div className="flex-1 text-xs font-medium truncate uppercase">{l.lens}</div>
            <div className="text-[10px] font-mono text-muted-foreground">{(l.confidence * 100).toFixed(0)}%</div>
          </div>
        ))}
      </div>
    </Card>
  );
}
