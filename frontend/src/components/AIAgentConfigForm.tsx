import React from 'react';
import { Button } from './ui/components';
import { FormInput } from './ui/FormInput';

interface AIAgentConfigFormProps {
  agent: any | null;
  logicTemplates: { id: any; name: string }[];
  riskTemplates: { id: any; name: string }[];
  onSave: (data: any) => Promise<void>;
  onCancel?: () => void;
  saveButtonText?: string;
}

interface AIAgentFormData {
  name: string;
  watchlist: string;
  timeframe: string;
  logicTemplateId: string;
  riskProfileId: string;
  tradeMode: string;
  paperTrading: boolean;
  portfolioValue: number;
  cycleIntervalMs: number;
}

export const AIAgentConfigForm = ({
  agent,
  logicTemplates,
  riskTemplates,
  onSave,
  onCancel,
  saveButtonText = 'Save',
}: AIAgentConfigFormProps) => {
  const [formData, setFormData] = React.useState<AIAgentFormData>(() => ({
    name: agent?.name ?? '',
    watchlist: agent?.watchlist ?? 'BTCUSDT',
    timeframe: agent?.timeframe ?? '4H',
    logicTemplateId: agent?.logic_template_id != null ? String(agent.logic_template_id) : '',
    riskProfileId: agent?.risk_profile_id != null ? String(agent.risk_profile_id) : '',
    tradeMode: agent?.trade_mode ?? 'spot',
    paperTrading: agent?.paper_trading != null ? Boolean(agent.paper_trading) : true,
    portfolioValue: agent?.portfolio_value ?? 10000,
    cycleIntervalMs: agent?.cycle_interval_ms ?? 300000,
  }));

  const setField = <K extends keyof AIAgentFormData>(key: K, value: AIAgentFormData[K]) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    await onSave({
      name: formData.name,
      watchlist: formData.watchlist,
      timeframe: formData.timeframe,
      logic_template_id: formData.logicTemplateId ? Number(formData.logicTemplateId) : null,
      risk_profile_id: formData.riskProfileId ? Number(formData.riskProfileId) : null,
      trade_mode: formData.tradeMode,
      paper_trading: formData.paperTrading ? 1 : 0,
      portfolio_value: Number(formData.portfolioValue),
      cycle_interval_ms: Number(formData.cycleIntervalMs),
    });
  };

  return (
    <div className="space-y-4">
      <FormInput
        label="Agent Name"
        value={formData.name}
        onChange={val => setField('name', val)}
        placeholder="e.g. BTC Trend Follower"
      />

      <div className="grid grid-cols-2 gap-4">
        <FormInput
          label="Trading Logic (Indicators)"
          type="select"
          value={formData.logicTemplateId}
          onChange={val => setField('logicTemplateId', val)}
          options={logicTemplates.map(t => ({ label: t.name, value: String(t.id) }))}
        />
        <FormInput
          label="Risk Strategy"
          type="select"
          value={formData.riskProfileId}
          onChange={val => setField('riskProfileId', val)}
          options={riskTemplates.map(t => ({ label: t.name, value: String(t.id) }))}
        />
      </div>

      <FormInput
        label="Timeframe"
        type="select"
        value={formData.timeframe}
        onChange={val => setField('timeframe', val)}
        options={['1m', '5m', '15m', '1H', '4H', '1D'].map(tf => ({ label: tf, value: tf }))}
      />

      <FormInput
        label="Watchlist (comma separated)"
        value={formData.watchlist}
        onChange={val => setField('watchlist', val)}
        placeholder="BTCUSDT, ETHUSDT"
      />

      <div className="grid grid-cols-2 gap-4">
        <FormInput
          label="Trade Mode"
          type="select"
          value={formData.tradeMode}
          onChange={val => setField('tradeMode', val)}
          options={[
            { label: 'Spot', value: 'spot' },
            { label: 'Futures', value: 'futures' },
          ]}
        />
        <FormInput
          label="Paper Trading"
          type="checkbox"
          value={formData.paperTrading}
          onChange={val => setField('paperTrading', val)}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormInput
          label="Portfolio Value (USD)"
          type="number"
          value={formData.portfolioValue}
          onChange={val => setField('portfolioValue', val)}
          tooltip="Total capital allocated to this agent"
        />
        <FormInput
          label="Cycle Interval (ms)"
          type="number"
          value={formData.cycleIntervalMs}
          onChange={val => setField('cycleIntervalMs', val)}
          tooltip="How often the agent runs its trading cycle in milliseconds"
        />
      </div>

      <div className="flex justify-end gap-2 pt-4">
        {onCancel && (
          <Button variant="outline" onClick={onCancel} className="text-xs">
            Cancel
          </Button>
        )}
        <Button variant="primary" onClick={handleSubmit} className="text-xs">
          {saveButtonText}
        </Button>
      </div>
    </div>
  );
};
