import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { strategyApi, type Strategy } from '../lib/api';
import { Card, CardHeader, CardTitle, CardContent, Badge, Button, Separator, Tabs, TabsList, TabsTrigger, TabsContent, ToggleGroup, ToggleGroupItem, ResizablePanelGroup, ResizablePanel, ResizableHandle } from './ui/components';
import { StrategyTerminal } from './StrategyTerminal';
import { cn } from '../lib/utils';
import { ArrowLeft, Play, Square, Settings, ArrowUp, ArrowDown } from 'lucide-react';

interface StrategyStats {
  netPnL: number;
  profitFactor: number;
  winRate: number;
  totalTrades: number;
  totalOrders: number;
  successfulTrades: number;
  failedTrades: number;
  avgTradeProfit: number;
}

interface Position {
  symbol: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  sl: number;
  tp: number;
}

export const StrategyDetails = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const strategyId = id ? parseInt(id) : 0;

  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [stats, setStats] = useState<StrategyStats | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Control panel states
  const [triggerMode, setTriggerMode] = useState<'Adaptive' | 'Manual'>('Adaptive');
  const [interval, setIntervalValue] = useState(60);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);

        // Fetch basic strategy info from hub list or individual call if available
        // Since strategyApi doesn't have getStrategy(id), we'll use getStrategies
        const strategiesRes = await strategyApi.getStrategies();
        const s = strategiesRes.data.find(item => item.id === strategyId);
        if (!s) throw new Error('Strategy not found');
        setStrategy(s);

        // Fetch stats and positions
        const [statsRes, posRes] = await Promise.all([
          strategyApi.getStats(strategyId),
          strategyApi.getPositions(strategyId)
        ]);

        setStats(statsRes.data);
        setPositions(posRes.data);

        // Parse config for control panel
        try {
          const config = JSON.parse(s.config || '{}');
          setTriggerMode(config.triggerMode || 'Adaptive');
          setIntervalValue(config.interval || 60);
        } catch (e) {
          console.error('Error parsing strategy config', e);
        }

      } catch (err: any) {
        setError(err.message || 'An error occurred while fetching strategy details');
      } finally {
        setLoading(false);
      }
    };

    if (strategyId) {
      fetchData();
    }
  }, [strategyId]);

  const handleToggle = async () => {
    if (!strategy) return;
    try {
      await strategyApi.toggleStrategy(strategyId);
      // Refresh data
      const strategiesRes = await strategyApi.getStrategies();
      const s = strategiesRes.data.find(item => item.id === strategyId);
      if (s) setStrategy(s);
    } catch (err: any) {
      alert('Failed to toggle strategy: ' + err.message);
    }
  };

  const handleUpdateConfig = async (updates: any) => {
    if (!strategy) return;
    try {
      const config = JSON.parse(strategy.config || '{}');
      const logicTemplateId = config.metadata?.logicTemplateId;
      const riskTemplateId = config.metadata?.riskTemplateId;

      await strategyApi.updateConfig(strategyId, {
        logicTemplateId,
        riskTemplateId,
        ...updates
      });
    } catch (err: any) {
      alert('Failed to update configuration: ' + err.message);
    }
  };

  if (loading) return <div className="p-8 text-center text-muted-foreground">Loading strategy details...</div>;
  if (error) return <div className="p-8 text-center text-rose-500">Error: {error} <Button onClick={() => navigate(-1)} className="ml-2">Go Back</Button></div>;
  if (!strategy) return <div className="p-8 text-center text-muted-foreground">Strategy not found.</div>;

  return (
    <div className="space-y-6 p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => navigate(-1)} className="p-2 h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{strategy.name}</h1>
            <Badge variant={strategy.status === 'running' ? 'success' : 'default'}>
              {strategy.status}
            </Badge>
            <span className="text-xs text-muted-foreground">ID: {strategyId}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <ToggleGroup
            value={triggerMode}
            onValueChange={(val) => {
              setTriggerMode(val as 'Adaptive' | 'Manual');
              handleUpdateConfig({ settings: { triggerMode: val } });
            }}
          >
            <ToggleGroupItem value="Adaptive">Adaptive</ToggleGroupItem>
            <ToggleGroupItem value="Manual">Manual</ToggleGroupItem>
          </ToggleGroup>

          <Button
            onClick={handleToggle}
            variant={strategy.status === 'running' ? 'danger' : 'primary'}
            className="h-8 px-4 flex items-center gap-2"
          >
            {strategy.status === 'running' ? (
              <>
                <Square className="h-3 w-3 fill-current" />
                <span>Stop</span>
              </>
            ) : (
              <>
                <Play className="h-3 w-3 fill-current" />
                <span>Start</span>
              </>
            )}
          </Button>

          <Button
            variant="outline"
            className="h-8 w-8 p-0"
            onClick={() => setIsSettingsOpen(true)}
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* KPI Header */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <StatCard
          label="Net PnL"
          value={`$${stats?.netPnL?.toFixed(2) || '0.00'}`}
          trend={stats?.netPnL ? (stats.netPnL >= 0 ? 'up' : 'down') : null}
          className={cn(stats?.netPnL && stats.netPnL >= 0 ? "text-emerald-500" : stats?.netPnL && "text-rose-500")}
        />
        <StatCard label="Profit Factor" value={stats?.profitFactor?.toFixed(2) || '0.00'} />
        <StatCard label="Win Rate" value={`${stats?.winRate?.toFixed(1) || '0.0'}%`} />
        <StatCard label="Total Trades" value={stats?.totalTrades?.toString() || '0'} />
        <StatCard label="Total Orders" value={stats?.totalOrders?.toString() || '0'} className="text-muted-foreground" />
        <StatCard label="Wins" value={stats?.successfulTrades?.toString() || '0'} className="text-emerald-600" />
        <StatCard label="Losses" value={stats?.failedTrades?.toString() || '0'} className="text-rose-600" />
        <StatCard label="Avg Profit" value={`$${stats?.avgTradeProfit?.toFixed(2) || '0.00'}`} />
      </div>

      <div className="h-[calc(100vh-300px)]">
        <ResizablePanelGroup direction="horizontal" className="h-full gap-6">
          <ResizablePanel className="flex-1 overflow-hidden">
            <Card className="h-full flex flex-col">
              <CardHeader>
                <CardTitle className="text-lg">Active Positions</CardTitle>
              </CardHeader>
              <CardContent className="flex-1 overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-card z-10">
                    <tr className="text-muted-foreground border-b border-border">
                      <th className="pb-3 font-medium">Symbol</th>
                      <th className="pb-3 font-medium">Side</th>
                      <th className="pb-3 font-medium">Entry</th>
                      <th className="pb-3 font-medium">Current</th>
                      <th className="pb-3 font-medium">PnL</th>
                      <th className="pb-3 font-medium">SL/TP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {positions.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-muted-foreground italic">No active positions</td>
                      </tr>
                    ) : (
                      positions.map((pos, i) => (
                        <tr key={i} className="hover:bg-muted/50">
                          <td className="py-3 font-medium">{pos.symbol}</td>
                          <td className="py-3">
                            <Badge variant={pos.side === 'LONG' ? 'success' : 'danger'} className="text-[10px]">
                              {pos.side}
                            </Badge>
                          </td>
                          <td className="py-3">{pos.entryPrice?.toFixed(2) || '0.00'}</td>
                          <td className="py-3">{pos.currentPrice?.toFixed(2) || '0.00'}</td>
                          <td className={cn("py-3 font-medium", pos.pnl >= 0 ? "text-emerald-500" : "text-rose-500")}>
                            {pos.pnl >= 0 ? `+${pos.pnl?.toFixed(2) || '0.00'}` : pos.pnl?.toFixed(2) || '0.00'}
                          </td>
                          <td className="py-3 text-xs text-muted-foreground">
                            {pos.sl?.toFixed(2) || '0.00'} / {pos.tp?.toFixed(2) || '0.00'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel className="w-[35%] overflow-hidden">
            <Card className="h-full flex flex-col bg-zinc-950 text-zinc-300 border-zinc-800">
              <CardHeader className="border-b border-zinc-800 py-3">
                <CardTitle className="text-sm font-mono text-zinc-400">Strategy Terminal</CardTitle>
              </CardHeader>
              <CardContent className="flex-1 p-0 overflow-hidden">
                <div className="h-full overflow-y-auto">
                  <StrategyTerminal strategyId={id!} />
                </div>
              </CardContent>
            </Card>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
};

const StatCard = ({ label, value, trend, className }: { label: string; value: string; trend?: 'up' | 'down'; className?: string }) => (
  <Card className="overflow-hidden border-none bg-muted/30">
    <CardContent className="p-3 flex flex-col justify-center">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">{label}</p>
      <div className="flex items-center gap-2">
        <span className={cn("text-lg font-bold leading-none", className)}>{value}</span>
        {trend && (
          <div className={cn("flex items-center", trend === 'up' ? "text-emerald-500" : "text-rose-500")}>
            {trend === 'up' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
          </div>
        )}
      </div>
    </CardContent>
  </Card>
);
