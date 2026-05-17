import React, { useEffect, useRef, useState } from 'react';
import { useSocket } from '../hooks/useSocket';
import { Button } from './ui/components';

interface StrategyTerminalProps {
  strategyId: string;
}

interface LogEvent {
  strategyId: string;
  type: 'INFO' | 'CHECK' | 'TRADE' | 'ERROR';
  message: string;
  timestamp: string | number;
}

export const StrategyTerminal: React.FC<StrategyTerminalProps> = ({ strategyId }) => {
  const { events } = useSocket();
  const [localLogs, setLocalLogs] = useState<LogEvent[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Filter events for this specific strategy
    const filtered = events
      .filter((e: any) => e.strategyId === strategyId)
      .map((e: any) => e as LogEvent);

    setLocalLogs(filtered);
  }, [events, strategyId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [localLogs]);

  const clearLogs = () => {
    setLocalLogs([]);
  };

  const getColorClass = (type: LogEvent['type']) => {
    switch (type) {
      case 'CHECK': return 'text-emerald-400';
      case 'TRADE': return 'text-blue-400';
      case 'ERROR': return 'text-rose-400';
      default: return 'text-zinc-300';
    }
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950 rounded-lg border border-zinc-800 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/50">
        <span className="text-xs font-mono text-zinc-400 uppercase tracking-wider">Strategy Terminal</span>
        <Button
          variant="outline"
          onClick={clearLogs}
          className="h-7 px-2 text-[10px] bg-zinc-800 text-zinc-300 border-zinc-700 hover:bg-zinc-700"
        >
          Clear
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-1 scrollbar-thin scrollbar-thumb-zinc-800">
        {localLogs.length === 0 ? (
          <div className="text-zinc-600 italic">No events for this strategy...</div>
        ) : (
          localLogs.map((log, idx) => (
            <div key={`${log.timestamp}-${idx}`} className="flex gap-3 leading-relaxed">
              <span className="text-zinc-600 shrink-0">
                {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span className={getColorClass(log.type)}>
                [{log.type}] {log.message}
              </span>
            </div>
          ))
        )}
        <div ref={scrollRef} />
      </div>
    </div>
  );
};
