import React, { useState, useEffect } from 'react';

interface RiskParams {
  risk_per_trade_percent: number;
  stop_loss_percent: number;
  take_profit_percent: number;
  min_risk_reward_ratio: number;
  max_portfolio_heat_percent: number;
  max_open_positions: number;
  max_trades_per_day: number;
  daily_loss_limit_percent: number;
  daily_profit_target_percent: number;
}

interface RiskField {
  key: keyof RiskParams;
  label: string;
  description: string;
}

const RISK_FIELDS: RiskField[] = [
  { key: 'risk_per_trade_percent', label: 'Risk per Trade (%)', description: 'Percentage of total portfolio to risk on a single trade' },
  { key: 'stop_loss_percent', label: 'Stop Loss (%)', description: 'Fixed percentage stop loss from entry price' },
  { key: 'take_profit_percent', label: 'Take Profit (%)', description: 'Fixed percentage take profit target' },
  { key: 'min_risk_reward_ratio', label: 'Min Risk/Reward Ratio', description: 'Minimum acceptable R:R ratio to enter a trade' },
  { key: 'max_portfolio_heat_percent', label: 'Max Portfolio Heat (%)', description: 'Max total risk across all open positions' },
  { key: 'max_open_positions', label: 'Max Open Positions', description: 'Maximum number of concurrent open trades' },
  { key: 'max_trades_per_day', label: 'Max Trades Per Day', description: 'Hard limit on number of trades per 24h period' },
  { key: 'daily_loss_limit_percent', label: 'Daily Loss Limit (%)', description: 'Stop trading for the day if this % loss is reached' },
  { key: 'daily_profit_target_percent', label: 'Daily Profit Target (%)', description: 'Optional target to stop trading for the day' },
];

interface RiskFormProps {
  initialValues: Partial<RiskParams>;
  onSave: (values: RiskParams) => Promise<void>;
}

export const RiskForm: React.FC<RiskFormProps> = ({ initialValues, onSave }) => {
  const [values, setValues] = useState<RiskParams>(initialValues as RiskParams);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    setValues(initialValues as RiskParams);
    setIsDirty(false);
  }, [initialValues]);

  const handleChange = (key: keyof RiskParams, val: string) => {
    const numVal = parseFloat(val);
    setValues(prev => ({ ...prev, [key]: isNaN(numVal) ? 0 : numVal }));
    setIsDirty(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(values);
      setIsDirty(false);
    } catch (error) {
      console.error('Failed to save risk settings:', error);
      alert('Error saving risk settings');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="bg-slate-900 p-6 rounded-xl border border-slate-800 shadow-xl">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-xl font-semibold text-slate-100">Risk Profile</h3>
        <button
          onClick={handleSave}
          disabled={!isDirty || isSaving}
          className={`px-4 py-2 rounded-lg font-medium transition-all ${
            !isDirty || isSaving
              ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-500 active:scale-95'
          }`}
        >
          {isSaving ? 'Saving...' : 'Save Risk Settings'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {RISK_FIELDS.map(({ key, label, description }) => (
          <div key={key} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-slate-400">{label}</label>
              <div className="group relative cursor-help">
                <span className="text-slate-500 text-xs bg-slate-800 w-4 h-4 flex items-center justify-center rounded-full border border-slate-700">?</span>
                <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 w-48 p-2 bg-slate-800 text-slate-300 text-xs rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 border border-slate-700">
                  {description}
                </div>
              </div>
            </div>
            <input
              type="number"
              step="0.01"
              value={values[key]}
              onChange={(e) => handleChange(key, e.target.value)}
              className="bg-slate-950 border border-slate-800 text-slate-100 px-3 py-2 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
            />
          </div>
        ))}
      </div>
    </div>
  );
};
