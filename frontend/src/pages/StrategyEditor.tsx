import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, strategyApi } from '../lib/api';
import { RiskForm } from '../components/StrategyEditor/RiskForm';

interface FullConfig {
  id: number;
  name: string;
  status: 'running' | 'stopped';
  risk_settings: any;
}

export const StrategyEditor: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [config, setConfig] = useState<FullConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingGeneral, setSavingGeneral] = useState(false);
  const [generalDirty, setGeneralDirty] = useState(false);
  const [generalValues, setGeneralValues] = useState({ name: '', status: 'stopped' as 'running' | 'stopped' });

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await api.get<FullConfig>(`/strategies/full-config/${id}`);
        const data = res.data;
        setConfig(data);
        setGeneralValues({ name: data.name, status: data.status });
      } catch (error) {
        console.error('Error fetching strategy config:', error);
        alert('Failed to load strategy configuration');
      } finally {
        setLoading(false);
      }
    };

    fetchConfig();
  }, [id]);

  const handleGeneralChange = (key: 'name' | 'status', value: any) => {
    setGeneralValues(prev => ({ ...prev, [key]: value }));
    setGeneralDirty(true);
  };

  const saveGeneral = async () => {
    setSavingGeneral(true);
    try {
      await api.patch(`/strategies/${id}`, generalValues);
      setConfig(prev => prev ? { ...prev, ...generalValues } : null);
      setGeneralDirty(false);
    } catch (error) {
      console.error('Error saving general settings:', error);
      alert('Failed to save general settings');
    } finally {
      setSavingGeneral(false);
    }
  };

  const archiveStrategy = async () => {
    if (!window.confirm('Are you sure you want to archive this strategy?')) return;
    try {
      await strategyApi.archiveStrategy(Number(id));
      alert('Strategy archived successfully');
      navigate('/strategies');
    } catch (error) {
      console.error('Error archiving strategy:', error);
      alert('Failed to archive strategy');
    }
  };

  const saveRiskSettings = async (riskValues: any) => {
    try {
      await api.patch(`/strategies/${id}/risk`, riskValues);
      setConfig(prev => prev ? { ...prev, risk_settings: riskValues } : null);
    } catch (error) {
      throw error;
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400">
      <div className="flex flex-col items-center gap-4">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        <p>Loading strategy configuration...</p>
      </div>
    </div>
  );

  if (!config) return <div className="text-white p-10">Strategy not found</div>;

  return (
    <div className="min-h-screen bg-slate-950 py-12 px-4">
      <div className="max-w-5xl mx-auto space-y-8">
        <div className="flex justify-between items-end border-b border-slate-800 pb-6">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Strategy Editor</h1>
            <p className="text-slate-400">Configure logic, risk parameters and operational status</p>
          </div>
          <button
            onClick={() => navigate('/strategies')}
            className="text-slate-400 hover:text-white transition-colors text-sm"
          >
            ← Back to Hub
          </button>
        </div>

        <div className="grid grid-cols-1 gap-8">
          {/* General Settings Section */}
          <section className="bg-slate-900 p-6 rounded-xl border border-slate-800 shadow-xl">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-semibold text-slate-100">General Information</h3>
              <div className="flex gap-3">
                <button
                  onClick={archiveStrategy}
                  className="px-4 py-2 text-sm font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-all"
                >
                  Archive Strategy
                </button>
                <button
                  onClick={saveGeneral}
                  disabled={!generalDirty || savingGeneral}
                  className={`px-4 py-2 rounded-lg font-medium transition-all ${
                    !generalDirty || savingGeneral
                      ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                      : 'bg-blue-600 text-white hover:bg-blue-500 active:scale-95'
                  }`}
                >
                  {savingGeneral ? 'Saving...' : 'Save General'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-slate-400">Strategy Name</label>
                <input
                  type="text"
                  value={generalValues.name}
                  onChange={(e) => handleGeneralChange('name', e.target.value)}
                  className="bg-slate-950 border border-slate-800 text-slate-100 px-3 py-2 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-slate-400">Operational Status</label>
                <div className="flex items-center gap-3 h-10">
                  <span className={`text-xs font-bold px-2 py-1 rounded ${generalValues.status === 'running' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                    {generalValues.status.toUpperCase()}
                  </span>
                  <button
                    onClick={() => handleGeneralChange('status', generalValues.status === 'running' ? 'stopped' : 'running')}
                    className="relative inline-flex h-6 w-11 items-center rounded-full bg-slate-700 transition-colors focus:outline-none"
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        generalValues.status === 'running' ? 'translate-x-6 bg-blue-400' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* Risk Profile Section */}
          <RiskForm
            initialValues={config.risk_settings}
            onSave={saveRiskSettings}
          />
        </div>
      </div>
    </div>
  );
};
