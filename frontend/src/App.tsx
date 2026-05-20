import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import { StrategyHub } from './components/StrategyHub';
import { LiveMonitor } from './components/LiveMonitor';
import { TemplateManager } from './components/TemplateManager';
import { StrategyDetails } from './components/StrategyDetails';
import { Card } from './components/ui/components';
import { cn } from './lib/utils';
import { strategyApi } from './lib/api';

interface AnalyticsSummary {
  totalProfit: number;
  winRate: string;
  activeBots: string;
}

function App() {
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);

  const fetchAnalytics = async () => {
    try {
      const res = await strategyApi.getSummary();
      setAnalytics(res.data);
    } catch (err) {
      console.error('Failed to fetch analytics', err);
    }
  };
  
  useEffect(() => {
    fetchAnalytics();
    const interval = setInterval(fetchAnalytics, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <Router>
      <div className="min-h-screen bg-background text-foreground">
        <div className="max-w-7xl mx-auto p-6">
          <header className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight">Trading Lab</h1>
              <p className="text-muted-foreground">Multi-strategy Orchestration Dashboard</p>
            </div>
            <div className="flex gap-4">
              <nav className="flex gap-4 mr-4">
                <Link to="/" className="text-sm font-medium hover:text-primary transition-colors">Dashboard</Link>
                <Link to="/templates" className="text-sm font-medium hover:text-primary transition-colors">Templates</Link>
              </nav>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                Server Online
              </div>
            </div>
          </header>

          <Routes>
            <Route path="/" element={
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-8 space-y-6">
                  <StrategyHub />
                  <Card className="p-6">
                    <h2 className="text-xl font-bold mb-4">Quick Analytics</h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="p-4 rounded-lg bg-muted border border-border">
                        <div className="text-xs text-muted-foreground uppercase">Total Profit</div>
                        <div className={cn(
                          "text-2xl font-bold",
                          analytics?.totalProfit >= 0 ? "text-green-500" : "text-red-500"
                        )}>
                          {analytics ? `${analytics.totalProfit >= 0 ? '+' : ''}$${analytics.totalProfit.toLocaleString()}` : 'Loading...'}
                        </div>
                      </div>
                      <div className="p-4 rounded-lg bg-muted border border-border">
                        <div className="text-xs text-muted-foreground uppercase">Win Rate</div>
                        <div className="text-2xl font-bold">
                          {analytics ? analytics.winRate : 'Loading...'}
                        </div>
                      </div>
                      <div className="p-4 rounded-lg bg-muted border border-border">
                        <div className="text-xs text-muted-foreground uppercase">Active Bots</div>
                        <div className="text-2xl font-bold">
                          {analytics ? analytics.activeBots : 'Loading...'}
                        </div>
                      </div>
                    </div>
                  </Card>
                </div>
                <div className="lg:col-span-4">
                  <LiveMonitor />
                </div>
              </div>
            } />
            <Route path="/templates" element={<TemplateManager />} />
            <Route path="/strategy/:id" element={<StrategyDetails />} />
          </Routes>
        </div>
      </div>
    </Router>
  );
}

export default App;
