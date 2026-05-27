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
  riskPerTradePercent: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  minRiskRewardRatio: number;
  maxPortfolioHeatPercent: number;
  maxOpenPositions: number;
  dailyLossLimitPercent: number;
  dailyProfitTargetPercent: number;
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
  riskPerTradePercent: 1,
  stopLossPercent: 2,
  takeProfitPercent: 4,
  minRiskRewardRatio: 2,
  maxPortfolioHeatPercent: 5,
  maxOpenPositions: 3,
  dailyLossLimitPercent: 2,
  dailyProfitTargetPercent: 5,
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
      paper_trading: formData.paperTrading,
      trade_mode: formData.tradeMode,
      portfolio_value: Number(formData.portfolioValue),
      max_trade_size_usd: Number(formData.maxTradeSizeUSD),
      max_trades_per_day: Number(formData.maxTradesPerDay),
      risk_per_trade_percent: Number(formData.riskPerTradePercent),
      stop_loss_percent: Number(formData.stopLossPercent),
      take_profit_percent: Number(formData.takeProfitPercent),
      min_risk_reward_ratio: Number(formData.minRiskRewardRatio),
      max_portfolio_heat_percent: Number(formData.maxPortfolioHeatPercent),
      max_open_positions: Number(formData.maxOpenPositions),
      daily_loss_limit_percent: Number(formData.dailyLossLimitPercent),
      daily_profit_target_percent: Number(formData.dailyProfitTargetPercent),
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

      <div className="border-t pt-4 mt-4">
        <h4 className="text-sm font-semibold mb-4">Risk Settings</h4>
        <div className="grid grid-cols-2 gap-4">
          <FormInput
            label="Portfolio Value (USD)"
            type="number"
            value={formData.portfolioValue}
            onChange={val => setFieldValue('portfolioValue', val)}
            tooltip="Total capital allocated to this strategy"
          />
          <FormInput
            label="Max Trade Size (USD)"
            type="number"
            value={formData.maxTradeSizeUSD}
            onChange={val => setFieldValue('maxTradeSizeUSD', val)}
            tooltip="Absolute maximum USD per trade"
          />
          <FormInput
            label="Risk per Trade (%)"
            type="number"
            value={formData.riskPerTradePercent}
            onChange={val => setFieldValue('riskPerTradePercent', val)}
            tooltip="Percentage of portfolio to risk per trade"
          />
          <FormInput
            label="Stop Loss (%)"
            type="number"
            value={formData.stopLossPercent}
            onChange={val => setFieldValue('stopLossPercent', val)}
            tooltip="Percentage drop from entry to trigger Stop Loss"
          />
          <FormInput
            label="Take Profit (%)"
            type="number"
            value={formData.takeProfitPercent}
            onChange={val => setFieldValue('takeProfitPercent', val)}
            tooltip="Percentage gain from entry to trigger Take Profit"
          />
          <FormInput
            label="Min Risk/Reward"
            type="number"
            value={formData.minRiskRewardRatio}
            onChange={val => setFieldValue('minRiskRewardRatio', val)}
            tooltip="Minimum acceptable Reward-to-Risk ratio"
          />
          <FormInput
            label="Max Portfolio Heat (%)"
            type="number"
            value={formData.maxPortfolioHeatPercent}
            onChange={val => setFieldValue('maxPortfolioHeatPercent', val)}
            tooltip="Maximum combined risk of all open positions"
          />
          <FormInput
            label="Max Open Positions"
            type="number"
            value={formData.maxOpenPositions}
            onChange={val => setFieldValue('maxOpenPositions', val)}
            tooltip="Maximum number of concurrent trades"
          />
          <FormInput
            label="Max Trades / Day"
            type="number"
            value={formData.maxTradesPerDay}
            onChange={val => setFieldValue('maxTradesPerDay', val)}
            tooltip="Limit on total trades executed per 24h"
          />
          <FormInput
            label="Daily Loss Limit (%)"
            type="number"
            value={formData.dailyLossLimitPercent}
            onChange={val => setFieldValue('dailyLossLimitPercent', val)}
            tooltip="Daily loss threshold to stop trading"
          />
          <FormInput
            label="Daily Profit Target (%)"
            type="number"
            value={formData.dailyProfitTargetPercent}
            onChange={val => setFieldValue('dailyProfitTargetPercent', val)}
            tooltip="Daily profit threshold to stop trading"
          />
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
