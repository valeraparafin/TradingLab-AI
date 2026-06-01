import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useSocket } from '../hooks/useSocket';
import { Card, Badge, Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '../components/ui/components';
import { RiskGauges } from '../components/XAI/RiskGauges';
import { LensAgreement } from '../components/XAI/LensAgreement';
import { AIRiskConfigForm, type AIRiskSettings } from '../components/AIRiskConfigForm';
import { cn } from '../lib/utils';

interface AgentThought {
  agent: string;
  thought: string;
  type: 'thought' | 'decision' | 'action' | 'observation';
  timestamp: number;
}

interface Trade {
  id: number;
  symbol: string;
  side: string;
  price: number;
  size_usd: number;
  status: string;
  timestamp: string;
  mode: string;
}

interface AgentInfo {
  id: number;
  name: string;
  status: string;
  watchlist: string[];
  timeframe: string;
  trade_mode: string;
  paper_trading: boolean;
}

export function AICockpitPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const id = Number(agentId);
  const { socket } = useSocket();

  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [agentStatus, setAgentStatus] = useState<'running' | 'stopped'>('stopped');
  const [thoughtStream, setThoughtStream] = useState<AgentThought[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [interval, setIntervalValue] = useState<'day' | 'week' | 'month'>('day');
  const [confidence] = useState({
    analyst: 0.5,
    risk: 0.5,
    optimizer: 0.5,
  });
  const [riskState] = useState({
    heat: 12.5,
    state: 'NORMAL' as 'NORMAL' | 'CAUTION' | 'PANIC',
    trend: [2, -1, 3, 1, -2, 4, 1, 0, 2, 3, -1, 2]
  });
  const [councilData] = useState({
    consensus: 0.65,
    lenses: [
      { lens: 'Macro', sentiment: 'bullish' as const, confidence: 0.8 },
      { lens: 'Order Flow', sentiment: 'bullish' as const, confidence: 0.6 },
      { lens: 'Quant', sentiment: 'neutral' as const, confidence: 0.4 },
    ]
  });

  // AI risk config panel state
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [riskTemplates, setRiskTemplates] = useState<{ id: number; name: string }[]>([]);
  const [agentConfig, setAgentConfig] = useState<Record<string, number> | null>(null);

  // Fetch agent info on mount
  useEffect(() => {
    const fetchAgent = async () => {
      try {
        const res = await fetch(`http://localhost:3000/api/agents/${id}`);
        const data = await res.json();
        if (data.success) {
          setAgent(data.data);
          setAgentStatus(data.data.status === 'running' ? 'running' : 'stopped');
        }
      } catch (err) {
        console.error('Failed to fetch agent info', err);
      }
    };
    fetchAgent();
  }, [id]);

  // Socket: thought stream + status, scoped to this agent
  useEffect(() => {
    if (!socket) return;

    const handleAgentThought = (type: string, data: any) => {
      if (data.agentId != null && Number(data.agentId) !== id) return;
      const message = data.thought || data.reasoning || data.message || 'No details provided';
      const newThought: AgentThought = {
        agent: data.agent || (type === 'agent:decision' ? 'risk' : 'analyst'),
        thought: message,
        type: type === 'agent:decision' ? 'decision' : 'thought',
        timestamp: Date.now(),
      };
      setThoughtStream((prev) => [newThought, ...prev].slice(0, 50));
    };

    socket.on('agent:thought', (data) => handleAgentThought('agent:thought', data));
    socket.on('agent:decision', (data) => handleAgentThought('agent:decision', data));
    socket.on('agent:status', (data: { agentId?: number; status: 'running' | 'stopped' }) => {
      if (data.agentId != null && Number(data.agentId) !== id) return;
      setAgentStatus(data.status);
    });

    return () => {
      socket.off('agent:thought');
      socket.off('agent:decision');
      socket.off('agent:status');
    };
  }, [socket, id]);

  // Fetch trades for this agent
  const fetchTrades = useCallback(async () => {
    try {
      const res = await fetch(`http://localhost:3000/api/agents/trades?agent_id=${id}&interval=${interval}`);
      const data = await res.json();
      if (data.success) setTrades(data.data.trades);
    } catch (err) {
      console.error('Failed to fetch AI trades', err);
    }
  }, [id, interval]);

  useEffect(() => {
    fetchTrades();
    const timer = setInterval(fetchTrades, 10000);
    return () => clearInterval(timer);
  }, [fetchTrades]);

  // Load risk templates + agent config for the configure panel
  useEffect(() => {
    const loadConfigData = async () => {
      try {
        const templatesRes = await fetch('http://localhost:3000/api/agents/risk-templates');
        const templatesData = await templatesRes.json();
        if (templatesData.success) setRiskTemplates(templatesData.data);
      } catch (err) {
        console.error('Failed to load risk templates', err);
      }
    };
    loadConfigData();
  }, []);

  const fetchAgentConfig = useCallback(async () => {
    try {
      const res = await fetch(`http://localhost:3000/api/agents/config/${id}`);
      const data = await res.json();
      setAgentConfig(data.success ? data.data : null);
    } catch (err) {
      console.error('Failed to fetch agent config', err);
      setAgentConfig(null);
    }
  }, [id]);

  useEffect(() => {
    fetchAgentConfig();
  }, [fetchAgentConfig]);

  const saveAgentConfig = async (settings: AIRiskSettings) => {
    const res = await fetch('http://localhost:3000/api/agents/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: id, settings }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Save failed');
    await fetchAgentConfig();
    setIsConfigOpen(false);
  };

  const toggleAgent = async () => {
    const isRunning = agentStatus === 'running';
    const endpoint = isRunning ? '/api/agents/stop' : '/api/agents/start';
    try {
      const res = await fetch(`http://localhost:3000${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: id }),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.error || 'Toggle failed');
      setAgentStatus(isRunning ? 'stopped' : 'running');
    } catch (err) {
      console.error('Failed to toggle agent', err);
      alert('Failed to toggle agent: ' + (err as Error).message);
    }
  };

  const watchlistDisplay = agent?.watchlist
    ? (Array.isArray(agent.watchlist) ? agent.watchlist : [agent.watchlist]).join(', ')
    : '—';

  return (
    <div className="space-y-6">
      <header className="flex justify-between items-center">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Link to="/ai" className="text-sm text-muted-foreground hover:text-primary transition-colors">
              ← Back to Hub
            </Link>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            {agent?.name ?? `Agent #${id}`}
          </h1>
          <p className="text-muted-foreground text-sm">
            {agent?.paper_trading ? 'Paper Trading' : 'Live Trading'} · {watchlistDisplay}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsConfigOpen(true)}
            className="px-5 py-2 rounded-full font-bold transition-all bg-muted hover:bg-muted/70 text-foreground"
          >
            ⚙️ Configure
          </button>
          <button
            onClick={toggleAgent}
            className={cn(
              "px-6 py-2 rounded-full font-bold transition-all",
              agentStatus === 'running'
                ? "bg-red-500 hover:bg-red-600 text-white animate-pulse"
                : "bg-green-500 hover:bg-green-600 text-white"
            )}
          >
            {agentStatus === 'running' ? '🛑 STOP AGENT' : '🚀 START AGENT'}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Intelligence & Risk */}
        <div className="lg:col-span-1 space-y-6">
          <RiskGauges
            heat={riskState.heat}
            state={riskState.state}
            equityTrend={riskState.trend}
          />

          <LensAgreement
            lenses={councilData.lenses}
            consensus={councilData.consensus}
          />

          <Card className="p-6">
            <h2 className="text-lg font-bold mb-4">Agent Confidence</h2>
            <div className="space-y-4">
              {Object.entries(confidence).map(([agentName, value]) => (
                <div key={agentName} className="space-y-2">
                  <div className="flex justify-between text-sm uppercase font-medium">
                    <span>{agentName}</span>
                    <span>{(value * 100).toFixed(0)}%</span>
                  </div>
                  <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn(
                        "h-full transition-all duration-500",
                        value > 0.7 ? "bg-green-500" : value > 0.4 ? "bg-yellow-500" : "bg-red-500"
                      )}
                      style={{ width: `${value * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-6 bg-muted/50">
            <h2 className="text-lg font-bold mb-2">System State</h2>
            <div className="flex items-center gap-2 text-sm">
              <div className={cn("w-2 h-2 rounded-full", agentStatus === 'running' ? "bg-green-500 animate-ping" : "bg-gray-400")} />
              <span className="font-mono">{agentStatus === 'running' ? 'AUTONOMOUS_MODE_ACTIVE' : 'MANUAL_OVERRIDE_ACTIVE'}</span>
            </div>
          </Card>
        </div>

        {/* Right Column: Thought Stream & Trades */}
        <div className="lg:col-span-2 space-y-6">
          {/* Thought Stream */}
          <Card className="h-[400px] flex flex-col overflow-hidden">
            <div className="p-4 border-b border-border flex justify-between items-center">
              <h2 className="text-lg font-bold">Reasoning Stream</h2>
              <span className="text-xs font-mono text-muted-foreground">Real-time Logic Trace</span>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4 font-mono text-sm">
              {thoughtStream.length === 0 && (
                <div className="h-full flex items-center justify-center text-muted-foreground italic">
                  Waiting for agent thoughts...
                </div>
              )}
              {thoughtStream.map((t, i) => (
                <div key={i} className={cn(
                  "p-3 rounded-lg border transition-all",
                  t.type === 'decision' ? "bg-primary/10 border-primary" : "bg-muted/30 border-border"
                )}>
                  <div className="flex justify-between mb-1">
                    <span className={cn(
                      "text-xs font-bold uppercase",
                      t.agent === 'analyst' ? "text-blue-500" : t.agent === 'risk' ? "text-red-500" : "text-purple-500"
                    )}>
                      {t.agent}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(t.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className={cn(
                    "leading-relaxed",
                    t.type === 'decision' ? "font-bold text-foreground" : "text-muted-foreground"
                  )}>
                    {t.thought}
                  </p>
                </div>
              ))}
            </div>
          </Card>

          {/* AI Trades Table */}
          <Card className="overflow-hidden">
            <div className="p-4 border-b border-border flex justify-between items-center">
              <h2 className="text-lg font-bold">AI Execution Log</h2>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Interval:</span>
                <select
                  value={interval}
                  onChange={(e) => setIntervalValue(e.target.value as 'day' | 'week' | 'month')}
                  className="text-xs bg-background border border-border rounded px-2 py-1 outline-none"
                >
                  <option value="day">Last 24h</option>
                  <option value="week">Last 7 days</option>
                  <option value="month">Last 30 days</option>
                </select>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="p-3 font-medium">Timestamp</th>
                    <th className="p-3 font-medium">Symbol</th>
                    <th className="p-3 font-medium">Side</th>
                    <th className="p-3 font-medium">Price</th>
                    <th className="p-3 font-medium">Size USD</th>
                    <th className="p-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {trades.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-muted-foreground italic">
                        No AI trades found for selected interval.
                      </td>
                    </tr>
                  ) : (
                    trades.map((trade, i) => (
                      <tr key={i} className="hover:bg-muted/50">
                        <td className="p-3 text-xs text-muted-foreground">
                          {new Date(trade.timestamp).toLocaleString()}
                        </td>
                        <td className="p-3 font-medium">{trade.symbol}</td>
                        <td className="p-3">
                          <Badge variant={trade.side === 'buy' ? 'success' : 'danger'} className="text-[10px]">
                            {trade.side.toUpperCase()}
                          </Badge>
                        </td>
                        <td className="p-3">{trade.price?.toFixed(2)}</td>
                        <td className="p-3">${trade.size_usd?.toFixed(2)}</td>
                        <td className="p-3">
                          <Badge variant="default" className="text-[10px]">
                            {trade.status}
                          </Badge>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>

      {/* AI Risk Config Side Panel */}
      <Sheet open={isConfigOpen} onOpenChange={setIsConfigOpen}>
        <SheetContent className="w-[500px]">
          <SheetHeader className="mb-6">
            <SheetTitle>AI Risk Configuration</SheetTitle>
            <SheetDescription>
              Apply a risk template or fine-tune risk settings for this agent.
            </SheetDescription>
          </SheetHeader>
          <AIRiskConfigForm
            agents={agent ? [{ id: agent.id, name: agent.name, status: agent.status }] : []}
            selectedAgentId={id}
            onAgentChange={() => {}}
            riskTemplates={riskTemplates}
            initialConfig={agentConfig}
            onSave={saveAgentConfig}
            onCancel={() => setIsConfigOpen(false)}
            showAgentPicker={false}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}
