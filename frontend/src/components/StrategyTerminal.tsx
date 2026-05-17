import React, { useEffect, useRef, useState } from 'react';
import { useSocket } from '../hooks/useSocket';
import { Button } from './ui/components';
import { strategyApi } from '../lib/api';

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
  const { events: realtimeEvents } = useSocket();
  const [localLogs, setLocalLogs] = useState<LogEvent[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchHistoricalEvents = async () => {
      try {
        const res = await strategyApi.getEvents(Number(strategyId), 100);
        const historicalLogs = res.data.map((e: any) => {
          let message = e.payload;
          if (typeof e.payload === 'object' && e.payload !== null) {
            if (e.type === 'safety_check') {
              const allPass = e.payload.allPass ? '✅ PASSED' : '🚫 FAILED';
              const details = e.payload.results
                ?.map((r: any) => `${r.pass ? '✅' : '🚫'} ${r.label}: ${r.actual}`)
                .join(' | ');
              message = `${allPass} | ${details}`;
            } else {
              message = JSON.stringify(e.payload, null, 2);
            }
          }
          return {
            strategyId: e.strategyId,
            type: e.type.toUpperCase(),
            message: message,
            timestamp: e.timestamp,
          };
        });
        setLocalLogs(historicalLogs);
      } catch (err) {
        console.error('Failed to fetch historical events:', err);
      }
    };

    if (strategyId) {
      fetchHistoricalEvents();
    }
  }, [strategyId]);

  useEffect(() => {
    const filtered = realtimeEvents
      .filter((e: any) => Number(e.strategyId) === Number(strategyId))
      .map((e: any) => {
        let message = e.payload;
        if (typeof e.payload === 'object' && e.payload !== null) {
          if (e.type === 'safety_check') {
            const allPass = e.payload.allPass ? '✅ PASSED' : '🚫 FAILED';
            const details = e.payload.results
              ?.map((r: any) => `${r.pass ? '✅' : '🚫'} ${r.label}: ${r.actual}`)
              .join(' | ');
            message = `${allPass} | ${details}`;
          } else {
            message = JSON.stringify(e.payload, null, 2);
          }
        }
        return {
          strategyId: e.strategyId,
          type: e.type.toUpperCase(),
          message: message,
          timestamp: e.timestamp,
        };
      });

    setLocalLogs(prev => {
      const existingTimestamps = new Set(prev.map(l => `${l.timestamp}-${l.type}`));
      const newEvents = filtered.filter(
        e => !existingTimestamps.has(`${e.timestamp}-${e.type}`)
      );
      return [...prev, ...newEvents];
    });
  }, [realtimeEvents, strategyId]);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [localLogs]);

  const clearLogs = () => {
    setLocalLogs([]);
  };

  const getColorClass = (type: string) => {
    switch (type) {
      case 'INFO': return 'text-blue-400';
      case 'SAFETY_CHECK': return 'text-amber-400';
      case 'CHECK': return 'text-rose-400';
      case 'TRADE': return 'text-emerald-400';
      case 'ERROR': return 'text-rose-600';
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

      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-1 scrollbar-thin scrollbar-thumb-zinc-800"
      >
        {localLogs.length === 0 ? (
          <div className="text-zinc-600 italic">No events for this strategy...</div>
        ) : (
          localLogs.map((log, idx) => {
            const logId = `${log.timestamp}-${log.type}`;
            return (
              <div key={`${logId}-${idx}`} className="flex gap-3 leading-relaxed">
                <span className="text-zinc-600 shrink-0">
                  {new Date(typeof log.timestamp === 'number' ? log.timestamp : parseInt(log.timestamp)).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <span className={getColorClass(log.type)}>
                  [{log.type}] {log.message}
                </span>
              </div>
            );
          })
        )}
        <div ref={scrollRef} />
      </div>
    </div>
  );
};
