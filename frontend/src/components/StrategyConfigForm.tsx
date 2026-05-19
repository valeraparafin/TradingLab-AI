import React, { useState, useEffect } from 'react';
import { Button } from './ui/components';

interface StrategyConfigFormProps {
  strategy: any;
  templates: { logic: any[]; risk: any[] };
  onSave: (data: any) => Promise<void>;
  onCancel?: () => void;
  saveButtonText?: string;
}

export const StrategyConfigForm = ({
  strategy,
  templates,
  onSave,
  onCancel,
  saveButtonText = "Save Changes"
}: StrategyConfigFormProps) => {
  const [name, setName] = useState('');
  const [logicTemplateId, setLogicTemplateId] = useState('');
  const [riskTemplateId, setRiskTemplateId] = useState('');
  const [timeframe, setTimeframe] = useState('4H');
  const [watchlist, setWatchlist] = useState('BTCUSDT');
  const [paperTrading, setPaperTrading] = useState(true);
  const [tradeMode, setTradeMode] = useState('spot');
  const [portfolioValue, setPortfolioValue] = useState(10000);
  const [maxTradeSizeUSD, setMaxTradeSizeUSD] = useState(100);
  const [maxTradesPerDay, setMaxTradesPerDay] = useState(3);

  useEffect(() => {
    if (!strategy) return;
    try {
      const config = JSON.parse(strategy.config || '{}');
      setName(strategy.name);
      setLogicTemplateId(config.metadata?.logicTemplateId || '');
      setRiskTemplateId(config.metadata?.riskTemplateId || '');
      setTimeframe(config.timeframe || '4H');
      setWatchlist(Array.isArray(config.watchlist) ? config.watchlist.join(', ') : (config.watchlist || 'BTCUSDT'));
      setPaperTrading(config.paperTrading !== false);
      setTradeMode(config.tradeMode || 'spot');
      setPortfolioValue(config.riskOverrides?.portfolioValue || config.risk?.portfolioValue || 10000);
      setMaxTradeSizeUSD(config.riskOverrides?.maxTradeSizeUSD || config.risk?.maxTradeSizeUSD || 100);
      setMaxTradesPerDay(config.riskOverrides?.maxTradesPerDay || config.risk?.maxTradesPerDay || 3);
    } catch (e) {
      console.error('Error parsing strategy config for form', e);
    }
  }, [strategy]);

  const handleSubmit = async () => {
    const settings = {
      timeframe,
      watchlist: watchlist.split(',').map(s => s.trim()),
      paperTrading,
      tradeMode,
      portfolioValue: Number(portfolioValue),
      maxTradeSizeUSD: Number(maxTradeSizeUSD),
      maxTradesPerDay: Number(maxTradesPerDay)
    };

    await onSave({
      name,
      logicTemplateId,
      riskTemplateId,
      settings
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium mb-1">Strategy Name</label>
        <input
          className="w-full p-2 rounded border bg-background text-sm"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. SMC Aggressive"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium mb-1">Logic Template</label>
          <select
            className="w-full p-2 rounded border bg-background text-sm"
            value={logicTemplateId}
            onChange={e => setLogicTemplateId(e.target.value)}
          >
            <option value="">Select Logic...</option>
            {templates.logic.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium mb-1">Risk Template</label>
          <select
            className="w-full p-2 rounded border bg-background text-sm"
            value={riskTemplateId}
            onChange={e => setRiskTemplateId(e.target.value)}
          >
            <option value="">Select Risk...</option>
            {templates.risk.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1">Timeframe</label>
        <select
          className="w-full p-2 rounded border bg-background text-sm"
          value={timeframe}
          onChange={e => setTimeframe(e.target.value)}
        >
          {['1m', '5m', '15m', '1H', '4H', '1D'].map(tf => (
          <option key={tf} value={tf}>{tf}</option>
        ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1">Watchlist (comma separated)</label>
        <input
          className="w-full p-2 rounded border bg-background text-sm"
          value={watchlist}
          onChange={e => setWatchlist(e.target.value)}
          placeholder="BTCUSDT, ETHUSDT"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium mb-1">Trade Mode</label>
          <select
            className="w-full p-2 rounded border bg-background text-sm"
            value={tradeMode}
            onChange={e => setTradeMode(e.target.value)}
          >
            <option value="spot">Spot</option>
            <option value="futures">Futures</option>
          </select>
        </div>
        <div className="flex items-center gap-2 pt-5">
          <input
            type="checkbox"
            id="configFormPaperTrading"
            checked={paperTrading}
            onChange={e => setPaperTrading(e.target.checked)}
            className="w-4 h-4"
          />
          <label htmlFor="configFormPaperTrading" className="text-xs font-medium">Paper Trading</label>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium mb-1">Portfolio Value (USD)</label>
          <input
            type="number"
            className="w-full p-2 rounded border bg-background text-sm"
            value={portfolioValue}
            onChange={e => setPortfolioValue(Number(e.target.value))}
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">Max Trade Size (USD)</label>
          <input
            type="number"
            className="w-full p-2 rounded border bg-background text-sm"
            value={maxTradeSizeUSD}
            onChange={e => setMaxTradeSizeUSD(Number(e.target.value))}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium mb-1">Max Trades / Day</label>
          <input
            type="number"
            className="w-full p-2 rounded border bg-background text-sm"
            value={maxTradesPerDay}
            onChange={e => setMaxTradesPerDay(Number(e.target.value))}
          />
        </div>
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
