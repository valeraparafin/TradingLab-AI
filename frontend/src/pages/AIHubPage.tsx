import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { templateApi } from '../lib/api';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Button,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '../components/ui/components';
import { useSocket } from '../hooks/useSocket';
import { AIAgentConfigForm } from '../components/AIAgentConfigForm';

interface AgentSummary {
  totalAgents: number;
  runningAgents: number;
  totalProfit: number;
  totalPnlPercent: number;
  winRate: number;
}

export function AIHubPage() {
  const { socket } = useSocket();

  const [agents, setAgents] = useState<any[]>([]);
  const [summary, setSummary] = useState<AgentSummary | null>(null);
  const [riskTemplates, setRiskTemplates] = useState<{ id: any; name: string }[]>([]);
  const [logicTemplates, setLogicTemplates] = useState<{ id: any; name: string }[]>([]);
  const [view, setView] = useState<'active' | 'archive'>('active');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<any | null>(null);

  const fetchAgents = async () => {
    try {
      const url =
        view === 'archive'
          ? 'http://localhost:3000/api/agents?archived=true'
          : 'http://localhost:3000/api/agents';
      const res = await fetch(url);
      const json = await res.json();
      if (json.success) setAgents(json.data);
    } catch (err) {
      console.error('Failed to fetch agents', err);
    }
  };

  const fetchSummary = async () => {
    try {
      const res = await fetch('http://localhost:3000/api/agents/summary');
      const json = await res.json();
      if (json.success) setSummary(json.data);
    } catch (err) {
      console.error('Failed to fetch agent summary', err);
    }
  };

  const fetchRiskTemplates = async () => {
    try {
      const res = await fetch('http://localhost:3000/api/agents/risk-templates');
      const json = await res.json();
      if (json.success) setRiskTemplates(json.data);
    } catch (err) {
      console.error('Failed to fetch risk templates', err);
    }
  };

  const fetchLogicTemplates = async () => {
    try {
      const r = await templateApi.getTemplates();
      if (r?.logic) setLogicTemplates(r.logic as { id: any; name: string }[]);
    } catch (err) {
      console.error('Failed to load logic templates', err);
    }
  };

  // On mount: fetch summary, risk templates, logic templates once
  useEffect(() => {
    fetchSummary();
    fetchRiskTemplates();
    fetchLogicTemplates();
  }, []);

  // On mount + view change: fetch agents + poll
  useEffect(() => {
    fetchAgents();
    const interval = setInterval(fetchAgents, 5000);
    return () => clearInterval(interval);
  }, [view]);

  // Live status via socket
  useEffect(() => {
    if (!socket) return;
    const handler = ({ agentId, status }: { agentId: any; status: any }) => {
      setAgents(prev =>
        prev.map(a => (a.id === Number(agentId) ? { ...a, status } : a))
      );
    };
    socket.on('agent:status', handler);
    return () => {
      socket.off('agent:status', handler);
    };
  }, [socket]);

  const handleCreate = async (data: any) => {
    try {
      const res = await fetch('http://localhost:3000/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Create failed');
      setIsCreateOpen(false);
      await fetchAgents();
    } catch (err) {
      alert('Failed to create agent: ' + (err as any).message);
    }
  };

  const handleUpdate = async (data: any) => {
    if (!selectedAgent) return;
    try {
      const res = await fetch(`http://localhost:3000/api/agents/${selectedAgent.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Update failed');
      setIsEditOpen(false);
      await fetchAgents();
    } catch (err) {
      alert('Failed to update agent: ' + (err as any).message);
    }
  };

  const handleStartStop = async (agent: any) => {
    try {
      const endpoint =
        agent.status === 'running'
          ? 'http://localhost:3000/api/agents/stop'
          : 'http://localhost:3000/api/agents/start';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agent.id }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Start/stop failed');
      await fetchAgents();
    } catch (err) {
      alert('Failed to start/stop agent: ' + (err as any).message);
    }
  };

  const handleArchive = async (id: number) => {
    if (!confirm('Archive this agent? It will be stopped and moved to the archive.')) return;
    try {
      const res = await fetch(`http://localhost:3000/api/agents/${id}/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Archive failed');
      await fetchAgents();
    } catch (err) {
      alert('Failed to archive agent: ' + (err as any).message);
    }
  };

  const openEditSheet = (agent: any) => {
    setSelectedAgent(agent);
    setIsEditOpen(true);
  };

  const stoppedCount = (summary?.totalAgents ?? 0) - (summary?.runningAgents ?? 0);

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Total Agents</p>
            <p className="text-2xl font-bold">
              {summary ? summary.totalAgents : '—'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Running</p>
            <p className="text-2xl font-bold text-green-500">
              {summary ? summary.runningAgents : '—'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Stopped</p>
            <p className="text-2xl font-bold text-muted-foreground">
              {summary ? stoppedCount : '—'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Total PnL</p>
            <p className="text-2xl font-bold">
              {summary ? '$' + summary.totalProfit : '—'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Roster Table */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div className="flex items-center gap-4">
            <CardTitle className="text-xl">AI Strategy Hub</CardTitle>
            <div className="flex bg-muted p-1 rounded-lg gap-1">
              <Button
                onClick={() => setView('active')}
                variant={view === 'active' ? 'primary' : 'outline'}
                className="text-xs px-3 h-7"
              >
                Active
              </Button>
              <Button
                onClick={() => setView('archive')}
                variant={view === 'archive' ? 'primary' : 'outline'}
                className="text-xs px-3 h-7"
              >
                Archive
              </Button>
            </div>
          </div>
          <Button onClick={() => setIsCreateOpen(true)} variant="primary" className="text-xs">
            + Create AI Agent
          </Button>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-muted-foreground text-xs uppercase tracking-wider border-b border-border">
                  <th className="pb-3 font-medium">Name</th>
                  <th className="pb-3 font-medium">Status</th>
                  <th className="pb-3 font-medium">Mode</th>
                  <th className="pb-3 font-medium">Timeframe</th>
                  <th className="pb-3 font-medium">Last Run</th>
                  <th className="pb-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {agents.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-muted-foreground">
                      No AI agents yet — create one.
                    </td>
                  </tr>
                ) : (
                  agents.map(a => (
                    <tr key={a.id} className="hover:bg-muted/50 transition-colors">
                      <td className="py-4 font-medium">
                        <Link to={`/ai/${a.id}`} className="text-primary hover:underline">
                          {a.name}
                        </Link>
                      </td>
                      <td className="py-4">
                        <Badge variant={a.status === 'running' ? 'success' : 'default'}>
                          {a.status}
                        </Badge>
                      </td>
                      <td className="py-4">
                        <Badge variant={a.paper_trading ? 'warning' : 'danger'}>
                          {a.paper_trading ? 'Paper' : 'Real'}
                        </Badge>
                      </td>
                      <td className="py-4 text-muted-foreground text-xs">{a.timeframe}</td>
                      <td className="py-4 text-muted-foreground text-xs">
                        {a.last_run ? new Date(a.last_run).toLocaleString() : 'Never'}
                      </td>
                      <td className="py-4 text-right">
                        {view === 'active' && (
                          <div className="flex justify-end gap-2">
                            <Button
                              onClick={() => openEditSheet(a)}
                              variant="outline"
                              className="text-xs"
                            >
                              Edit
                            </Button>
                            <Button
                              onClick={() => handleStartStop(a)}
                              variant={a.status === 'running' ? 'danger' : 'primary'}
                              className="text-xs"
                            >
                              {a.status === 'running' ? 'Stop' : 'Start'}
                            </Button>
                            <Button
                              onClick={() => handleArchive(a.id)}
                              variant="outline"
                              className="text-xs"
                            >
                              Archive
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Create Sheet */}
      <Sheet open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <SheetContent className="w-[500px]">
          <SheetHeader className="mb-6">
            <SheetTitle>Create AI Agent</SheetTitle>
            <SheetDescription>
              Configure a new AI trading agent using logic and risk templates.
            </SheetDescription>
          </SheetHeader>
          <AIAgentConfigForm
            agent={null}
            logicTemplates={logicTemplates}
            riskTemplates={riskTemplates}
            onSave={handleCreate}
            onCancel={() => setIsCreateOpen(false)}
            saveButtonText="Create"
          />
        </SheetContent>
      </Sheet>

      {/* Edit Sheet */}
      {isEditOpen && selectedAgent && (
        <Sheet open={isEditOpen} onOpenChange={setIsEditOpen}>
          <SheetContent className="w-[500px]">
            <SheetHeader className="mb-6">
              <SheetTitle>Edit {selectedAgent.name}</SheetTitle>
              <SheetDescription>
                Update the configuration for this AI agent.
              </SheetDescription>
            </SheetHeader>
            <AIAgentConfigForm
              agent={selectedAgent}
              logicTemplates={logicTemplates}
              riskTemplates={riskTemplates}
              onSave={handleUpdate}
              onCancel={() => setIsEditOpen(false)}
              saveButtonText="Save Changes"
            />
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
