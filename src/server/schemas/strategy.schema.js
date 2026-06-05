import { z } from 'zod';

export const LogicTemplateSchema = z.object({
  name: z.string().min(1),
  type: z.string(),
  indicators: z.record(z.any()),
  safety_checks: z.array(z.object({
    id: z.string(),
    description: z.string(),
  })).optional(),
});

export const RiskTemplateSchema = z.object({
  name: z.string().min(1),
  settings: z.object({
    riskPerTradePercent: z.number().positive(),
    maxTradeSizeUSD: z.number().positive(),
    stopLossPercent: z.number().min(0.1).max(100),
    takeProfitPercent: z.number().min(0.1).max(100),
    maxTradesPerDay: z.number().int().positive(),
  }),
});

export const RiskSettingsSchema = z.object({
  risk_per_trade_percent: z.number().positive().max(100),
  stop_loss_percent: z.number().min(0.1).max(100),
  take_profit_percent: z.number().min(0.1).max(100),
  min_risk_reward_ratio: z.number().positive(),
  max_portfolio_heat_percent: z.number().positive().max(100),
  max_open_positions: z.number().int().positive(),
  max_trades_per_day: z.number().int().positive(),
  daily_loss_limit_percent: z.number().positive().max(100),
  daily_profit_target_percent: z.number().positive().max(100),
});

export const LogicConfigSchema = z.record(z.any());