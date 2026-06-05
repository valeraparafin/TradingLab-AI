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
    minRiskRewardRatio: z.number().positive().optional(),
  }).superRefine((s, ctx) => {
    // Guard 1: minRiskRewardRatio must be reachable by the fixed TP/SL ratio.
    if (s.minRiskRewardRatio != null && s.minRiskRewardRatio > 0 && s.stopLossPercent > 0) {
      const ratio = s.takeProfitPercent / s.stopLossPercent;
      if (ratio < s.minRiskRewardRatio) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `minRiskRewardRatio ${s.minRiskRewardRatio} unreachable with TP ${s.takeProfitPercent} / SL ${s.stopLossPercent} (ratio ${ratio.toFixed(2)})`,
        });
      }
    }
  }),
});

export const RiskSettingsSchema = z.object({
  risk_per_trade_percent: z.number().positive().max(100),
  stop_loss_percent: z.number().min(0.1).max(100),
  take_profit_percent: z.number().min(0.1).max(100),
  min_risk_reward_ratio: z.number().positive().optional(),
  max_portfolio_heat_percent: z.number().positive().max(100),
  max_open_positions: z.number().int().positive(),
  max_trades_per_day: z.number().int().positive(),
  daily_loss_limit_percent: z.number().positive().max(100),
  daily_profit_target_percent: z.number().positive().max(100),
}).superRefine((s, ctx) => {
  // Guard 1: min_risk_reward_ratio must be reachable by the fixed TP/SL ratio.
  if (s.min_risk_reward_ratio != null && s.min_risk_reward_ratio > 0 && s.stop_loss_percent > 0) {
    const ratio = s.take_profit_percent / s.stop_loss_percent;
    if (ratio < s.min_risk_reward_ratio) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `min_risk_reward_ratio ${s.min_risk_reward_ratio} unreachable with take_profit ${s.take_profit_percent} / stop_loss ${s.stop_loss_percent} (ratio ${ratio.toFixed(2)})`,
      });
    }
  }
});

export const LogicConfigSchema = z.record(z.any());