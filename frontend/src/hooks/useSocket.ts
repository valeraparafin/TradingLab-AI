import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const SOCKET_SERVER_URL = 'http://localhost:3000';
const STORAGE_KEY = 'trading_lab_events';

export function useSocket() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [events, setEvents] = useState<any[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  });
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');

  useEffect(() => {
    const s = io(SOCKET_SERVER_URL);

    s.on('connect', () => {
      setConnectionStatus('connected');
    });

    s.on('disconnect', () => {
      setConnectionStatus('disconnected');
    });

    s.on('event:update', (data) => {
      setEvents((prev) => {
        const newEvents = [data, ...prev].slice(0, 100);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newEvents));
        return newEvents;
      });
    });

    s.on('status:update', (data) => {
      // Handle bot status updates
    });

    setSocket(s);

    return () => {
      s.disconnect();
    };
  }, []);

  const clearEvents = () => {
    localStorage.removeItem(STORAGE_KEY);
    setEvents([]);
  };

  return { socket, events, connectionStatus, clearEvents };
}
