import { useState, useEffect } from 'react';

export function useFormState<T>(initialValues: T, strategy?: any) {
  const [formData, setFormData] = useState<T>(initialValues);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (strategy) {
      try {
        const config = JSON.parse(strategy.config || '{}');
        const updatedValues = {
          ...initialValues,
          name: strategy.name,
          logicTemplateId: config.metadata?.logicTemplateId || '',
          riskTemplateId: config.metadata?.riskTemplateId || '',
          timeframe: config.timeframe || '4H',
          watchlist: Array.isArray(config.watchlist) ? config.watchlist.join(', ') : (config.watchlist || 'BTCUSDT'),
          paperTrading: config.paperTrading !== false,
          tradeMode: config.tradeMode || 'spot',
          portfolioValue: config.riskOverrides?.portfolioValue || config.risk?.portfolioValue || 10000,
          maxTradeSizeUSD: config.riskOverrides?.maxTradeSizeUSD || config.risk?.maxTradeSizeUSD || 100,
          maxTradesPerDay: config.riskOverrides?.maxTradesPerDay || config.risk?.maxTradesPerDay || 3,
        };
        setFormData(updatedValues);
        setIsDirty(false);
      } catch (e) {
        console.error('Error parsing strategy config for form state', e);
      }
    }
  }, [strategy]);

  const setFieldValue = (field: keyof T, value: any) => {
    setFormData(prev => {
      if (prev[field] === value) return prev;
      setIsDirty(true);
      return { ...prev, [field]: value };
    });
  };

  return { formData, setFieldValue, isDirty, setFormData };
}
