import React from 'react';
import { Button } from './ui/components';
import { FormInput } from './ui/FormInput';
import { useFormState } from '../hooks/useFormState';

interface StrategyConfigFormProps {
  strategy: any;
  templates: { logic: any[]; risk: any[] };
  onSave: (data: any) => Promise<void>;
  onCancel?: () => void;
  saveButtonText?: string;
}

interface StrategyFormData {
  name: string;
  logicTemplateId: string;
  riskTemplateId: string;
  timeframe: string;
  watchlist: string;
  paperTrading: boolean;
  tradeMode: string;
  portfolioValue: number;
  maxTradeSizeUSD: number;
  maxTradesPerDay: number;
}

const INITIAL_FORM_STATE: StrategyFormData = {
  name: '',
  logicTemplateId: '',
  riskTemplateId: '',
  timeframe: '4H',
  watchlist: 'BTCUSDT',
  paperTrading: true,
  tradeMode: 'spot',
  portfolioValue: 10000,
  maxTradeSizeUSD: 100,
  maxTradesPerDay: 3,
};

export const StrategyConfigForm = ({
  strategy,
  templates,
  onSave,
  onCancel,
  saveButtonText = "Save Changes"
}: StrategyConfigFormProps) => {
  const { formData, setFieldValue, isDirty } = useFormState(INITIAL_FORM_STATE, strategy);

  const handleSubmit = async () => {
    const settings = {
      timeframe: formData.timeframe,
      watchlist: formData.watchlist.split(',').map(s => s.trim()),
      paperTrading: formData.paperTrading,
      tradeMode: formData.tradeMode,
      portfolioValue: Number(formData.portfolioValue),
      maxTradeSizeUSD: Number(formData.maxTradeSizeUSD),
      maxTradesPerDay: Number(formData.maxTradesPerDay)
    };

    await onSave({
      name: formData.name,
      logicTemplateId: formData.logicTemplateId,
      riskTemplateId: formData.riskTemplateId,
      settings
    });
  };

  return (
    <div className="space-y-4">
      <FormInput
        label="Strategy Name"
        value={formData.name}
        onChange={val => setFieldValue('name', val)}
        placeholder="e.g. SMC Aggressive"
      />

      <div className="grid grid-cols-2 gap-4">
        <FormInput
          label="Logic Template"
          type="select"
          value={formData.logicTemplateId}
          onChange={val => setFieldValue('logicTemplateId', val)}
          options={templates.logic.map(t => ({ label: t.name, value: t.id }))}
        />
        <FormInput
          label="Risk Template"
          type="select"
          value={formData.riskTemplateId}
          onChange={val => setFieldValue('riskTemplateId', val)}
          options={templates.risk.map(t => ({ label: t.name, value: t.id }))}
        />
      </div>

      <FormInput
        label="Timeframe"
        type="select"
        value={formData.timeframe}
        onChange={val => setFieldValue('timeframe', val)}
        options={['1m', '5m', '15m', '1H', '4H', '1D'].map(tf => ({ label: tf, value: tf }))}
      />

      <FormInput
        label="Watchlist (comma separated)"
        value={formData.watchlist}
        onChange={val => setFieldValue('watchlist', val)}
        placeholder="BTCUSDT, ETHUSDT"
      />

      <div className="grid grid-cols-2 gap-4">
        <FormInput
          label="Trade Mode"
          type="select"
          value={formData.tradeMode}
          onChange={val => setFieldValue('tradeMode', val)}
          options={[
            { label: 'Spot', value: 'spot' },
            { label: 'Futures', value: 'futures' },
          ]}
        />
        <FormInput
          label="Paper Trading"
          type="checkbox"
          value={formData.paperTrading}
          onChange={val => setFieldValue('paperTrading', val)}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormInput
          label="Portfolio Value (USD)"
          type="number"
          value={formData.portfolioValue}
          onChange={val => setFieldValue('portfolioValue', val)}
        />
        <FormInput
          label="Max Trade Size (USD)"
          type="number"
          value={formData.maxTradeSizeUSD}
          onChange={val => setFieldValue('maxTradeSizeUSD', val)}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <FormInput
          label="Max Trades / Day"
          type="number"
          value={formData.maxTradesPerDay}
          onChange={val => setFieldValue('maxTradesPerDay', val)}
        />
      </div>

      <div className="flex justify-end gap-2 pt-4">
        {onCancel && (
          <Button variant="outline" onClick={onCancel} className="text-xs">
            Cancel
          </Button>
        )}
        <Button
          variant="primary"
          onClick={handleSubmit}
          className="text-xs"
          disabled={!isDirty}
        >
          {saveButtonText}
        </Button>
      </div>
    </div>
  );
};
