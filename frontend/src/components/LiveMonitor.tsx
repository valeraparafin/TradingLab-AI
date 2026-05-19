import React from 'react';
import { useSocket } from '../hooks/useSocket';
import { Card, CardHeader, CardTitle, CardContent, Badge, Button } from './ui/components';
import { cn } from '../lib/utils';

export const LiveMonitor = () => {
  const { events, connectionStatus, clearEvents } = useSocket();

  return (
    <Card className="h-[600px] flex flex-col">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-xl">Live Monitor</CardTitle>
        <div className="flex items-center gap-2">
          <Button onClick={clearEvents} variant="outline" className="text-xs">
            Clear
          </Button>
          <Badge variant={connectionStatus === 'connected' ? 'success' : 'danger'}>
            {connectionStatus}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto space-y-3 pr-2">
        {events.length === 0 && (
          <div className="text-center text-muted-foreground py-20">
            Waiting for bot events...
          </div>
        )}
        {events.map((event, i) => (
          <Card key={i} className="p-3 text-sm border-l-4 border-l-primary">
            <div className="flex justify-between items-start mb-1">
              <span className="font-bold text-primary">{event.type}</span>
              <span className="text-muted-foreground text-xs">
                {new Date(event.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <div className="text-foreground/80 font-mono text-xs">
              {typeof event.payload === 'string'
                ? event.payload
                : JSON.stringify(event.payload, null, 2)}
            </div>
          </Card>
        ))}
      </CardContent>
    </Card>
  );
};
