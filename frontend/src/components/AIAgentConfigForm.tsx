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

interface ObConfig {
  imbThresh: number;
  aggThresh: number;
  minVelocity: number;
  maxSpreadBps: number;
  horizonMs: number;
  htfStep: number;
}

const OB_CONFIG_DEFAULTS: ObConfig = {
  imbThresh: 0.10,
  aggThresh: 0.15,
  minVelocity: 0.5,
  maxSpreadBps: 8,
  horizonMs: 60000,
  htfStep: 1,
};

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

  const [obConfig, setObConfig] = React.useState<ObConfig>(() => {
    if (agent?.ob_config) {
      try {
        const parsed = JSON.parse(agent.ob_config);
        return { ...OB_CONFIG_DEFAULTS, ...parsed };
      } catch {
        // fall through to defaults
      }
    }
    return { ...OB_CONFIG_DEFAULTS };
  });

  const setObField = <K extends keyof ObConfig>(key: K, value: ObConfig[K]) => {
    setObConfig(prev => ({ ...prev, [key]: value }));
  };

  const setField = <K extends keyof AIAgentFormData>(key: K, value: AIAgentFormData[K]) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const isOrderBook = (() => {
    const tpl = logicTemplates.find(t => String(t.id) === formData.logicTemplateId);
    if (!tpl) return false;
    return tpl.name === 'Order Book (Live)' || String(tpl.id) === 'orderbook';
  })();

  const handleSubmit = async () => {
    await onSave({
      name: formData.name,
      watchlist: formData.watchlist,
      timeframe: formData.timeframe,
      // Logic template ids are filename strings (e.g. "orderbook"); do NOT Number()-coerce
      // (that yields NaN→null and silently drops the selection). SQLite stores the string fine.
      logic_template_id: formData.logicTemplateId || null,
      risk_profile_id: formData.riskProfileId ? Number(formData.riskProfileId) : null,
      trade_mode: formData.tradeMode,
      paper_trading: formData.paperTrading ? 1 : 0,
      portfolio_value: Number(formData.portfolioValue),
      cycle_interval_ms: Number(formData.cycleIntervalMs),
      ob_config: isOrderBook
        ? JSON.stringify({
            imbThresh: Number(obConfig.imbThresh),
            aggThresh: Number(obConfig.aggThresh),
            minVelocity: Number(obConfig.minVelocity),
            maxSpreadBps: Number(obConfig.maxSpreadBps),
            horizonMs: Number(obConfig.horizonMs),
            htfStep: Number(obConfig.htfStep),
          })
        : null,
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

      {isOrderBook && (
        <div className="space-y-3 rounded border p-3">
          <div>
            <p className="text-xs font-semibold mb-0.5">Order-book signal thresholds</p>
            <p className="text-xs text-muted-foreground">Defaults are tuned; override per agent.</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormInput
              label="Imbalance Threshold (imbThresh)"
              type="number"
              value={obConfig.imbThresh}
              onChange={val => setObField('imbThresh', val)}
              tooltip="Bid/ask imbalance ratio to trigger a signal (e.g. 0.10 = 10%)"
            />
            <FormInput
              label="Aggression Threshold (aggThresh)"
              type="number"
              value={obConfig.aggThresh}
              onChange={val => setObField('aggThresh', val)}
              tooltip="Taker aggression ratio required to confirm (e.g. 0.15 = 15%)"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormInput
              label="Min Velocity (minVelocity)"
              type="number"
              value={obConfig.minVelocity}
              onChange={val => setObField('minVelocity', val)}
              tooltip="Minimum order-book velocity score (lots/sec)"
            />
            <FormInput
              label="Max Spread (maxSpreadBps)"
              type="number"
              value={obConfig.maxSpreadBps}
              onChange={val => setObField('maxSpreadBps', val)}
              tooltip="Maximum allowed spread in basis points before skipping signal"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormInput
              label="Horizon (horizonMs)"
              type="number"
              value={obConfig.horizonMs}
              onChange={val => setObField('horizonMs', val)}
              tooltip="Look-back window for aggregating OB events in milliseconds"
            />
            <FormInput
              label="HTF Step (htfStep)"
              type="number"
              value={obConfig.htfStep}
              onChange={val => setObField('htfStep', val)}
              tooltip="Higher-timeframe confirmation step size (candle count)"
            />
          </div>
        </div>
      )}

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
