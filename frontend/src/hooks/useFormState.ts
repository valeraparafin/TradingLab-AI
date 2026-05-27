import { useState, useEffect } from 'react';

export function useFormState<T>(initialValues: T, strategy?: any) {
  const [formData, setFormData] = useState<T>(initialValues);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (strategy) {
      try {
        const config = JSON.parse(strategy.logicConfig || strategy.config || '{}');
        const updatedValues = {
          ...initialValues,
          name: strategy.name,
          logicTemplateId: config.metadata?.logicTemplateId || config.logic_template_id || '',
          riskTemplateId: config.metadata?.riskTemplateId || config.risk_template_id || '',
          timeframe: config.timeframe || '4H',
          watchlist: Array.isArray(config.watchlist) ? config.watchlist.join(', ') : (config.watchlist || 'BTCUSDT'),
          paperTrading: config.paper_trading !== false,
          tradeMode: config.trade_mode || 'spot',
          portfolioValue: config.risk_overrides?.portfolio_value || config.risk?.portfolio_value || config.portfolio_value || 10000,
          maxTradeSizeUSD: config.risk_overrides?.max_trade_size_usd || config.risk?.max_trade_size_usd || config.max_trade_size_usd || 100,
          maxTradesPerDay: config.risk_overrides?.max_trades_per_day || config.risk?.max_trades_per_day || config.max_trades_per_day || 3,
          riskPerTradePercent: config.risk_overrides?.risk_per_trade_percent || config.risk?.risk_per_trade_percent || config.risk_per_trade_percent || 1,
          stopLossPercent: config.risk_overrides?.stop_loss_percent || config.risk?.stop_loss_percent || config.stop_loss_percent || 2,
          takeProfitPercent: config.risk_overrides?.take_profit_percent || config.risk?.take_profit_percent || config.take_profit_percent || 4,
          minRiskRewardRatio: config.risk_overrides?.min_risk_reward_ratio || config.risk?.min_risk_reward_ratio || config.min_risk_reward_ratio || 2,
          maxPortfolioHeatPercent: config.risk_overrides?.max_portfolio_heat_percent || config.risk?.max_portfolio_heat_percent || config.max_portfolio_heat_percent || 5,
          maxOpenPositions: config.risk_overrides?.max_open_positions || config.risk?.max_open_positions || config.max_open_positions || 3,
          dailyLossLimitPercent: config.risk_overrides?.daily_loss_limit_percent || config.risk?.daily_loss_limit_percent || config.daily_loss_limit_percent || 2,
          dailyProfitTargetPercent: config.risk_overrides?.daily_profit_target_percent || config.risk?.daily_profit_target_percent || config.daily_profit_target_percent || 5,
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
