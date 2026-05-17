import React, { useEffect, useState } from 'react';
import { strategyApi } from '../lib/api';
import type { Strategy } from '../lib/api';
import { Card, CardHeader, CardTitle, CardContent, Badge, Button } from './ui/components';
import { cn } from '../lib/utils';

export const StrategyHub = () => {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'active' | 'archive'>('active');

  // Modal states
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selectedStrategy, setSelectedStrategy] = useState<Strategy | null>(null);

  // Templates state
  const [templates, setTemplates] = useState<{ logic: any[]; risk: any[] }>({ logic: [], risk: [] });

  // Form states
  const [name, setName] = useState('');
  const [logicTemplateId, setLogicTemplateId] = useState('');
  const [riskTemplateId, setRiskTemplateId] = useState('');
  const [timeframe, setTimeframe] = useState('4H');
  const [watchlist, setWatchlist] = useState('BTCUSDT');
  const [paperTrading, setPaperTrading] = useState(true);
  const [tradeMode, setTradeMode] = useState('spot');
  const [maxTradeSizeUSD, setMaxTradeSizeUSD] = useState(100);
  const [maxTradesPerDay, setMaxTradesPerDay] = useState(3);

  const fetchStrategies = async () => {
    try {
      const res = await strategyApi.getStrategies(view === 'archive');
      setStrategies(res.data);
    } catch (err) {
      console.error('Failed to fetch strategies', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchTemplates = async () => {
    try {
      const res = await strategyApi.getTemplates();
      setTemplates(res.data);
    } catch (err) {
      console.error('Failed to fetch templates', err);
    }
  };

  useEffect(() => {
    fetchStrategies();
    fetchTemplates();
    const interval = setInterval(fetchStrategies, 5000);
    return () => clearInterval(interval);
  }, [view]);

  const toggleBot = async (id: number) => {
    try {
      await strategyApi.toggleStrategy(id);
      await fetchStrategies();
    } catch (err) {
      console.error('Failed to toggle bot', err);
    }
  };

  const archiveStrategy = async (id: number) => {
    if (!confirm('Archive this strategy? It will be stopped and moved to the archive.')) return;
    try {
      await strategyApi.archiveStrategy(id);
      await fetchStrategies();
    } catch (err) {
      alert('Failed to archive strategy: ' + (err as any).message);
    }
  };

  const restoreStrategy = async (id: number) => {
    try {
      await strategyApi.restoreStrategy(id);
      await fetchStrategies();
    } catch (err) {
      alert('Failed to restore strategy: ' + (err as any).message);
    }
  };

  const deleteStrategyPermanently = async (id: number) => {
    if (!confirm('WARNING! This operation is irreversible. All trade history and the configuration file will be permanently deleted.')) return;
    try {
      await strategyApi.deleteStrategyPermanently(id);
      await fetchStrategies();
    } catch (err) {
      alert('Failed to delete strategy: ' + (err as any).message);
    }
  };

  const handleCreate = async () => {
    try {
      const settings = {
        timeframe,
        watchlist: watchlist.split(',').map(s => s.trim()),
        paperTrading,
        tradeMode,
        maxTradeSizeUSD: Number(maxTradeSizeUSD),
        maxTradesPerDay: Number(maxTradesPerDay)
      };
      await strategyApi.createStrategy({ name, logicTemplateId, riskTemplateId, settings });
      setIsCreateOpen(false);
      setName('');
      setLogicTemplateId('');
      setRiskTemplateId('');
      await fetchStrategies();
    } catch (err) {
      alert('Failed to create strategy: ' + (err as any).message);
    }
  };

  const handleUpdateConfig = async () => {
    if (!selectedStrategy) return;
    try {
      const settings = {
        timeframe,
        watchlist: watchlist.split(',').map(s => s.trim()),
        paperTrading,
        tradeMode,
        maxTradeSizeUSD: Number(maxTradeSizeUSD),
        maxTradesPerDay: Number(maxTradesPerDay)
      };
      await strategyApi.updateConfig(selectedStrategy.id, {
        name,
        logicTemplateId,
        riskTemplateId,
        settings
      });
      setIsEditOpen(false);
      await fetchStrategies();
    } catch (err) {
      alert('Failed to update config: ' + (err as any).message);
    }
  };

  const openEditModal = (s: Strategy) => {
    setSelectedStrategy(s);
    try {
      const config = JSON.parse(s.config || '{}');
      setName(s.name);
      setLogicTemplateId(config.metadata?.logicTemplateId || '');
      setRiskTemplateId(config.metadata?.riskTemplateId || '');
      setTimeframe(config.timeframe || '4H');
      setWatchlist(Array.isArray(config.watchlist) ? config.watchlist.join(', ') : 'BTCUSDT');
      setPaperTrading(config.paperTrading !== false);
      setTradeMode(config.tradeMode || 'spot');
      setMaxTradeSizeUSD(config.risk?.maxTradeSizeUSD || 100);
      setMaxTradesPerDay(config.risk?.maxTradesPerDay || 3);
    } catch (e) {
      setName(s.name);
      setLogicTemplateId('');
      setRiskTemplateId('');
      setTimeframe('4H');
      setWatchlist('BTCUSDT');
      setPaperTrading(true);
      setTradeMode('spot');
      setMaxTradeSizeUSD(100);
      setMaxTradesPerDay(3);
    }
    setIsEditOpen(true);
  };

  if (loading) return <div className="text-center p-8 text-muted-foreground">Loading strategies...</div>;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div className="flex items-center gap-4">
          <CardTitle className="text-xl">Strategy Hub</CardTitle>
          <div className="flex bg-muted p-1 rounded-lg gap-1">
            <Button
              onClick={() => setView('active')}
              variant={view === 'active' ? 'primary' : 'ghost'}
              className="text-xs px-3 h-7"
            >
              Active
            </Button>
            <Button
              onClick={() => setView('archive')}
              variant={view === 'archive' ? 'primary' : 'ghost'}
              className="text-xs px-3 h-7"
            >
              Archive
            </Button>
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setIsCreateOpen(true)} variant="primary" className="text-xs">
            + Create Strategy
          </Button>
          <Button onClick={fetchStrategies} variant="outline" className="text-xs">Refresh</Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-muted-foreground text-xs uppercase tracking-wider border-b border-border">
                <th className="pb-3 font-medium">Strategy Name</th>
                <th className="pb-3 font-medium">Status</th>
                <th className="pb-3 font-medium">Last Run</th>
                <th className="pb-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {strategies.map((s) => (
                <tr key={s.id} className="hover:bg-muted/50 transition-colors">
                  <td className="py-4 font-medium">{s.name}</td>
                  <td className="py-4">
                    <Badge variant={s.status === 'running' ? 'success' : 'default'}>
                      {s.status}
                    </Badge>
                  </td>
                  <td className="py-4 text-muted-foreground text-xs">
                    {s.last_run ? new Date(s.last_run).toLocaleString() : 'Never'}
                  </td>
                  <td className="py-4 text-right flex justify-end gap-2">
                    {view === 'active' ? (
                      <>
                        <Button onClick={() => openEditModal(s)} variant="outline" className="text-xs">
                          Edit
                        </Button>
                        <Button
                          onClick={() => toggleBot(s.id)}
                          variant={s.status === 'running' ? 'danger' : 'primary'}
                          className="text-xs"
                        >
                          {s.status === 'running' ? 'Stop' : 'Start'}
                        </Button>
                        <Button onClick={() => archiveStrategy(s.id)} variant="outline" className="text-xs">
                          Archive
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button onClick={() => restoreStrategy(s.id)} variant="primary" className="text-xs">
                          Restore
                        </Button>
                        <Button onClick={() => deleteStrategyPermanently(s.id)} variant="danger" className="text-xs">
                          Delete Permanently
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>

      {/* Create Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <Card className="w-full max-w-md p-6 shadow-2xl overflow-y-auto max-h-[90vh]">
            <CardTitle className="text-xl mb-4">Create New Strategy</CardTitle>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium mb-1">Strategy Name</label>
                <input
                  className="w-full p-2 rounded border bg-background"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. SMC Aggressive"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1">Logic Template</label>
                  <select
                    className="w-full p-2 rounded border bg-background"
                    value={logicTemplateId}
                    onChange={e => setLogicTemplateId(e.target.value)}
                  >
                    <option value="">Select Logic...</option>
                    {templates.logic.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Risk Template</label>
                  <select
                    className="w-full p-2 rounded border bg-background"
                    value={riskTemplateId}
                    onChange={e => setRiskTemplateId(e.target.value)}
                  >
                    <option value="">Select Risk...</option>
                    {templates.risk.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Timeframe</label>
                <select
                  className="w-full p-2 rounded border bg-background"
                  value={timeframe}
                  onChange={e => setTimeframe(e.target.value)}
                >
                  <option value="1m">1m</option>
                  <option value="5m">5m</option>
                  <option value="15m">15m</option>
                  <option value="1H">1H</option>
                  <option value="4H">4H</option>
                  <option value="1D">1D</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Watchlist (comma separated)</label>
                <input
                  className="w-full p-2 rounded border bg-background"
                  value={watchlist}
                  onChange={e => setWatchlist(e.target.value)}
                  placeholder="BTCUSDT, ETHUSDT"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1">Trade Mode</label>
                  <select
                    className="w-full p-2 rounded border bg-background"
                    value={tradeMode}
                    onChange={e => setTradeMode(e.target.value)}
                  >
                    <option value="spot">Spot</option>
                    <option value="futures">Futures</option>
                  </select>
                </div>
                <div className="flex items-center gap-2 pt-5">
                  <input
                    type="checkbox"
                    id="paperTrading"
                    checked={paperTrading}
                    onChange={e => setPaperTrading(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <label htmlFor="paperTrading" className="text-xs font-medium">Paper Trading</label>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1">Max Trade Size (USD)</label>
                  <input
                    type="number"
                    className="w-full p-2 rounded border bg-background"
                    value={maxTradeSizeUSD}
                    onChange={e => setMaxTradeSizeUSD(Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Max Trades / Day</label>
                  <input
                    type="number"
                    className="w-full p-2 rounded border bg-background"
                    value={maxTradesPerDay}
                    onChange={e => setMaxTradesPerDay(Number(e.target.value))}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <Button onClick={() => setIsCreateOpen(false)} variant="outline">Cancel</Button>
                <Button onClick={handleCreate}>Create</Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Edit Modal */}
      {isEditOpen && selectedStrategy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <Card className="w-full max-w-md p-6 shadow-2xl overflow-y-auto max-h-[90vh]">
            <CardTitle className="text-xl mb-4">Edit {selectedStrategy.name}</CardTitle>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium mb-1">Strategy Name</label>
                <input
                  className="w-full p-2 rounded border bg-background"
                  value={name}
                  onChange={e => setName(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1">Logic Template</label>
                  <select
                    className="w-full p-2 rounded border bg-background"
                    value={logicTemplateId}
                    onChange={e => setLogicTemplateId(e.target.value)}
                  >
                    <option value="">Select Logic...</option>
                    {templates.logic.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Risk Template</label>
                  <select
                    className="w-full p-2 rounded border bg-background"
                    value={riskTemplateId}
                    onChange={e => setRiskTemplateId(e.target.value)}
                  >
                    <option value="">Select Risk...</option>
                    {templates.risk.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Timeframe</label>
                <select
                  className="w-full p-2 rounded border bg-background"
                  value={timeframe}
                  onChange={e => setTimeframe(e.target.value)}
                >
                  <option value="1m">1m</option>
                  <option value="5m">5m</option>
                  <option value="15m">15m</option>
                  <option value="1H">1H</option>
                  <option value="4H">4H</option>
                  <option value="1D">1D</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Watchlist (comma separated)</label>
                <input
                  className="w-full p-2 rounded border bg-background"
                  value={watchlist}
                  onChange={e => setWatchlist(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1">Trade Mode</label>
                  <select
                    className="w-full p-2 rounded border bg-background"
                    value={tradeMode}
                    onChange={e => setTradeMode(e.target.value)}
                  >
                    <option value="spot">Spot</option>
                    <option value="futures">Futures</option>
                  </select>
                </div>
                <div className="flex items-center gap-2 pt-5">
                  <input
                    type="checkbox"
                    id="editPaperTrading"
                    checked={paperTrading}
                    onChange={e => setPaperTrading(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <label htmlFor="editPaperTrading" className="text-xs font-medium">Paper Trading</label>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1">Max Trade Size (USD)</label>
                  <input
                    type="number"
                    className="w-full p-2 rounded border bg-background"
                    value={maxTradeSizeUSD}
                    onChange={e => setMaxTradeSizeUSD(Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Max Trades / Day</label>
                  <input
                    type="number"
                    className="w-full p-2 rounded border bg-background"
                    value={maxTradesPerDay}
                    onChange={e => setMaxTradesPerDay(Number(e.target.value))}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <Button onClick={() => setIsEditOpen(false)} variant="outline">Cancel</Button>
                <Button onClick={handleUpdateConfig}>Save Changes</Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </Card>
  );
};
