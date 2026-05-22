import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { strategyApi, templateApi } from '../lib/api';
import type { Strategy } from '../lib/api';
import { Card, CardHeader, CardTitle, CardContent, Badge, Button, Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from './ui/components';
import { cn } from '../lib/utils';
import { useSocket } from '../hooks/useSocket';
import { StrategyConfigForm } from './StrategyConfigForm';

export const StrategyHub = () => {
  const { events } = useSocket();
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'active' | 'archive'>('active');

  // Modal states
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selectedStrategy, setSelectedStrategy] = useState<Strategy | null>(null);

  // Templates state
  const [templates, setTemplates] = useState<{ logic: any[]; risk: any[] }>({ logic: [], risk: [] });

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
      const res = await templateApi.getTemplates();
      setTemplates(res);
    } catch (err) {
      console.error('Failed to fetch templates', err);
    }
  };

  useEffect(() => {
    fetchStrategies();
    fetchTemplates();

    const handleSocketUpdate = (data: any) => {
      if (data.type === 'status_change') {
        setStrategies(prev => prev.map(s =>
          s.id === data.strategyId
            ? { ...s, status: data.payload.status }
            : s
        ));
      }
    };

    const interval = setInterval(fetchStrategies, 5000);

    // We can't easily add a listener to the socket inside StrategyHub
    // because useSocket is a separate hook.
    // However, since we are in a functional component,
    // we can integrate a listener if we have access to the socket.

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

  const handleCreate = async (data: any) => {
    try {
      await strategyApi.createStrategy(data);
      setIsCreateOpen(false);
      await fetchStrategies();
    } catch (err) {
      alert('Failed to create strategy: ' + (err as any).message);
    }
  };

  const handleUpdateConfig = async (data: any) => {
    if (!selectedStrategy) return;
    try {
      await strategyApi.updateConfig(selectedStrategy.id, data);
      setIsEditOpen(false);
      await fetchStrategies();
    } catch (err) {
      alert('Failed to update config: ' + (err as any).message);
    }
  };

  const openEditModal = (s: Strategy) => {
    setSelectedStrategy(s);
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
                  <td className="py-4 font-medium">
                    <Link to={`/strategy/${s.id}`} className="text-primary hover:underline">
                      {s.name}
                    </Link>
                  </td>
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

      {/* Create Sidebar */}
      <Sheet open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <SheetContent className="w-[500px]">
          <SheetHeader className="mb-6">
            <SheetTitle>Create New Strategy</SheetTitle>
            <SheetDescription>Define a new trading strategy using templates and custom overrides.</SheetDescription>
          </SheetHeader>
          <StrategyConfigForm
            strategy={null}
            templates={templates}
            onSave={handleCreate}
            onCancel={() => setIsCreateOpen(false)}
            saveButtonText="Create"
          />
        </SheetContent>
      </Sheet>

      {/* Edit Sidebar */}
      {isEditOpen && selectedStrategy && (
        <Sheet open={isEditOpen} onOpenChange={setIsEditOpen}>
          <SheetContent className="w-[500px]">
            <SheetHeader className="mb-6">
              <SheetTitle>Edit {selectedStrategy.name}</SheetTitle>
              <SheetDescription>Update the configuration for this strategy. Changes will restart the bot.</SheetDescription>
            </SheetHeader>
            <StrategyConfigForm
              strategy={selectedStrategy}
              templates={templates}
              onSave={handleUpdateConfig}
              onCancel={() => setIsEditOpen(false)}
              saveButtonText="Save Changes"
            />
          </SheetContent>
        </Sheet>
      )}
    </Card>
  );
};
