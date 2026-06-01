import { useState, useEffect } from 'react';
import { Button } from './ui/components';
import { FormInput } from './ui/FormInput';

export interface AIRiskSettings {
  riskPerTradePercent: number;
  maxTradeSizeUSD: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  maxPortfolioHeatPercent: number;
  maxOpenPositions: number;
  dailyLossLimitPercent: number;
  dailyProfitTargetPercent: number;
}

interface Agent {
  id: number;
  name: string;
  status: string;
}

// DB rows arrive in snake_case; templates carry the same risk columns.
interface RiskTemplate {
  id: number;
  name: string;
  [key: string]: any;
}

interface AIRiskConfigFormProps {
  agents: Agent[];
  selectedAgentId: number | null;
  onAgentChange: (id: number) => void;
  riskTemplates: RiskTemplate[];
  initialConfig: Partial<Record<string, number>> | null;
  onSave: (settings: AIRiskSettings) => Promise<void>;
  onCancel?: () => void;
  showAgentPicker?: boolean;
}

interface RiskField {
  key: keyof AIRiskSettings;
  dbKey: string; // snake_case key as stored in ai_risk_profiles
  label: string;
  tooltip: string;
}

// Mirrors exactly the ai_risk_profiles columns. dbKey maps camelCase <-> snake_case
// so we can hydrate from server rows (snake) and emit settings (camel).
const RISK_FIELDS: RiskField[] = [
  { key: 'riskPerTradePercent', dbKey: 'risk_per_trade_percent', label: 'Risk per Trade (%)', tooltip: 'Percentage of portfolio to risk per trade' },
  { key: 'maxTradeSizeUSD', dbKey: 'max_trade_size_usd', label: 'Max Trade Size (USD)', tooltip: 'Absolute maximum USD per trade' },
  { key: 'stopLossPercent', dbKey: 'stop_loss_percent', label: 'Stop Loss (%)', tooltip: 'Percentage drop from entry to trigger Stop Loss' },
  { key: 'takeProfitPercent', dbKey: 'take_profit_percent', label: 'Take Profit (%)', tooltip: 'Percentage gain from entry to trigger Take Profit' },
  { key: 'maxPortfolioHeatPercent', dbKey: 'max_portfolio_heat_percent', label: 'Max Portfolio Heat (%)', tooltip: 'Maximum combined risk of all open positions' },
  { key: 'maxOpenPositions', dbKey: 'max_open_positions', label: 'Max Open Positions', tooltip: 'Maximum number of concurrent trades' },
  { key: 'dailyLossLimitPercent', dbKey: 'daily_loss_limit_percent', label: 'Daily Loss Limit (%)', tooltip: 'Daily loss threshold to stop trading' },
  { key: 'dailyProfitTargetPercent', dbKey: 'daily_profit_target_percent', label: 'Daily Profit Target (%)', tooltip: 'Daily profit threshold to stop trading' },
];

const EMPTY_SETTINGS: AIRiskSettings = {
  riskPerTradePercent: 0,
  maxTradeSizeUSD: 0,
  stopLossPercent: 0,
  takeProfitPercent: 0,
  maxPortfolioHeatPercent: 0,
  maxOpenPositions: 0,
  dailyLossLimitPercent: 0,
  dailyProfitTargetPercent: 0,
};

// Reads snake_case DB row into a camelCase settings object.
const fromDbRow = (row: Partial<Record<string, number>> | null): AIRiskSettings => {
  if (!row) return { ...EMPTY_SETTINGS };
  const result = { ...EMPTY_SETTINGS };
  for (const { key, dbKey } of RISK_FIELDS) {
    const val = row[dbKey];
    if (val !== undefined && val !== null) result[key] = Number(val);
  }
  return result;
};

export const AIRiskConfigForm = ({
  agents,
  selectedAgentId,
  onAgentChange,
  riskTemplates,
  initialConfig,
  onSave,
  onCancel,
  showAgentPicker = true,
}: AIRiskConfigFormProps) => {
  const [settings, setSettings] = useState<AIRiskSettings>(EMPTY_SETTINGS);
  const [templateId, setTemplateId] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Re-hydrate whenever the server config for the selected agent arrives.
  useEffect(() => {
    setSettings(fromDbRow(initialConfig));
    setTemplateId('');
    setIsDirty(false);
  }, [initialConfig]);

  const setField = (key: keyof AIRiskSettings, value: number) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setIsDirty(true);
  };

  // Picking a template prefills the fields locally; nothing is persisted until Save.
  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const tpl = riskTemplates.find(t => String(t.id) === id);
    if (tpl) {
      setSettings(fromDbRow(tpl));
      setIsDirty(true);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(settings);
      setIsDirty(false);
    } catch (err) {
      console.error('Failed to save AI risk settings', err);
      alert('Error saving AI risk settings');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {showAgentPicker && (
        <FormInput
          label="AI Agent"
          type="select"
          value={selectedAgentId ? String(selectedAgentId) : ''}
          onChange={val => onAgentChange(Number(val))}
          options={agents.map(a => ({ label: `${a.name} (${a.status})`, value: String(a.id) }))}
        />
      )}

      <FormInput
        label="Risk Template"
        type="select"
        value={templateId}
        onChange={applyTemplate}
        options={riskTemplates.map(t => ({ label: t.name, value: String(t.id) }))}
      />

      <div className="border-t pt-4 mt-4">
        <h4 className="text-sm font-semibold mb-4">Risk Settings</h4>
        <div className="grid grid-cols-2 gap-4">
          {RISK_FIELDS.map(({ key, label, tooltip }) => (
            <FormInput
              key={key}
              label={label}
              type="number"
              value={settings[key]}
              onChange={val => setField(key, Number(val))}
              tooltip={tooltip}
            />
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-4">
        {onCancel && (
          <Button variant="outline" onClick={onCancel} className="text-xs">
            Cancel
          </Button>
        )}
        <Button
          variant="primary"
          onClick={handleSave}
          className="text-xs"
          disabled={!isDirty || isSaving || !selectedAgentId}
        >
          {isSaving ? 'Saving...' : 'Apply to Agent'}
        </Button>
      </div>
    </div>
  );
};
