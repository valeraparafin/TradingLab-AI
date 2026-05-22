import React, { useState, useEffect } from "react";
import { Button, Tooltip } from "./ui/components";

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
  saveButtonText = "Save Changes",
}: StrategyConfigFormProps) => {
  console.log("[StrategyConfigForm] Received templates:", templates);
  const [name, setName] = useState("");
  const [logicTemplateId, setLogicTemplateId] = useState("");
  const [riskTemplateId, setRiskTemplateId] = useState("");
  const [timeframe, setTimeframe] = useState("4H");
  const [watchlist, setWatchlist] = useState("BTCUSDT");
  const [paperTrading, setPaperTrading] = useState(true);
  const [tradeMode, setTradeMode] = useState("spot");
  const [portfolioValue, setPortfolioValue] = useState(10000);
  const [maxTradeSizeUSD, setMaxTradeSizeUSD] = useState(100);
  const [maxTradesPerDay, setMaxTradesPerDay] = useState(3);
  const [riskPerTradePercent, setRiskPerTradePercent] = useState(1);
  const [stopLossPercent, setStopLossPercent] = useState(2);
  const [takeProfitPercent, setTakeProfitPercent] = useState(4);
  const [minRiskRewardRatio, setMinRiskRewardRatio] = useState(2);
  const [maxPortfolioHeatPercent, setMaxPortfolioHeatPercent] = useState(10);
  const [maxOpenPositions, setMaxOpenPositions] = useState(5);
  const [dailyLossLimitPercent, setDailyLossLimitPercent] = useState(3);
  const [dailyProfitTargetPercent, setDailyProfitTargetPercent] = useState(5);

  useEffect(() => {
    if (!strategy) return;
    try {
      const config = JSON.parse(strategy.config || "{}");
      setName(strategy.name);
      setLogicTemplateId(config.metadata?.logicTemplateId || "");
      setRiskTemplateId(config.metadata?.riskTemplateId || "");
      setTimeframe(config.timeframe || "4H");
      setWatchlist(
        Array.isArray(config.watchlist)
          ? config.watchlist.join(", ")
          : config.watchlist || "BTCUSDT",
      );
      setPaperTrading(config.paperTrading !== false);
      setTradeMode(config.tradeMode || "spot");
      setPortfolioValue(
        config.riskOverrides?.portfolioValue ||
          config.risk?.portfolioValue ||
          10000,
      );
      setMaxTradeSizeUSD(
        config.riskOverrides?.maxTradeSizeUSD ||
          config.risk?.maxTradeSizeUSD ||
          100,
      );
      setMaxTradesPerDay(
        config.riskOverrides?.maxTradesPerDay ||
          config.risk?.maxTradesPerDay ||
          3,
      );
      setRiskPerTradePercent(
        config.riskOverrides?.riskPerTradePercent ||
          config.risk?.risk_per_trade_percent ||
          1,
      );
      setStopLossPercent(
        config.riskOverrides?.stopLossPercent ||
          config.risk?.stop_loss_percent ||
          2,
      );
      setTakeProfitPercent(
        config.riskOverrides?.takeProfitPercent ||
          config.risk?.take_profit_percent ||
          4,
      );
      setMinRiskRewardRatio(
        config.riskOverrides?.minRiskRewardRatio ||
          config.risk?.min_risk_reward_ratio ||
          2,
      );
      setMaxPortfolioHeatPercent(
        config.riskOverrides?.maxPortfolioHeatPercent ||
          config.risk?.max_portfolio_heat_percent ||
          10,
      );
      setMaxOpenPositions(
        config.riskOverrides?.maxOpenPositions ||
          config.risk?.max_open_positions ||
          5,
      );
      setDailyLossLimitPercent(
        config.riskOverrides?.dailyLossLimitPercent ||
          config.risk?.daily_loss_limit_percent ||
          3,
      );
      setDailyProfitTargetPercent(
        config.riskOverrides?.dailyProfitTargetPercent ||
          config.risk?.daily_profit_target_percent ||
          5,
      );
    } catch (e) {
      console.error("Error parsing strategy config for form", e);
    }
  }, [strategy]);

  const handleSubmit = async () => {
    const settings = {
      timeframe,
      watchlist: watchlist.split(",").map((s) => s.trim()),
      paperTrading,
      tradeMode,
      portfolioValue: Number(portfolioValue),
      maxTradeSizeUSD: Number(maxTradeSizeUSD),
      maxTradesPerDay: Number(maxTradesPerDay),
      risk: {
        riskPerTradePercent: Number(riskPerTradePercent),
        stopLossPercent: Number(stopLossPercent),
        takeProfitPercent: Number(takeProfitPercent),
        minRiskRewardRatio: Number(minRiskRewardRatio),
        maxPortfolioHeatPercent: Number(maxPortfolioHeatPercent),
        maxOpenPositions: Number(maxOpenPositions),
        dailyLossLimitPercent: Number(dailyLossLimitPercent),
        dailyProfitTargetPercent: Number(dailyProfitTargetPercent),
      },
    };

    await onSave({
      name,
      logicTemplateId,
      riskTemplateId,
      settings,
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium mb-1">Strategy Name</label>
        <input
          className="w-full p-2 rounded border bg-background text-sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. SMC Aggressive"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium mb-1">
            Logic Template
          </label>
          <select
            className="w-full p-2 rounded border bg-background text-sm"
            value={logicTemplateId}
            onChange={(e) => setLogicTemplateId(e.target.value)}
          >
            <option value="">Select Logic...</option>
            {templates.logic.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium mb-1">
            Risk Template
          </label>
          <select
            className="w-full p-2 rounded border bg-background text-sm"
            value={riskTemplateId}
            onChange={(e) => setRiskTemplateId(e.target.value)}
          >
            <option value="">Select Risk...</option>
            {templates.risk.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1">Timeframe</label>
        <select
          className="w-full p-2 rounded border bg-background text-sm"
          value={timeframe}
          onChange={(e) => setTimeframe(e.target.value)}
        >
          {["1m", "5m", "15m", "1H", "4H", "1D"].map((tf) => (
            <option key={tf} value={tf}>
              {tf}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1">
          Watchlist (comma separated)
        </label>
        <input
          className="w-full p-2 rounded border bg-background text-sm"
          value={watchlist}
          onChange={(e) => setWatchlist(e.target.value)}
          placeholder="BTCUSDT, ETHUSDT"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium mb-1">Trade Mode</label>
          <select
            className="w-full p-2 rounded border bg-background text-sm"
            value={tradeMode}
            onChange={(e) => setTradeMode(e.target.value)}
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
            onChange={(e) => setPaperTrading(e.target.checked)}
            className="w-4 h-4"
          />
          <label
            htmlFor="configFormPaperTrading"
            className="text-xs font-medium"
          >
            Paper Trading
          </label>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="flex items-center gap-1">
            <label className="block text-xs font-medium mb-1">
              Portfolio Value (USD)
            </label>
            <Tooltip content="Total capital allocated to the strategy. Used to calculate position sizes." />
          </div>
          <input
            type="number"
            className="w-full p-2 rounded border bg-background text-sm"
            value={portfolioValue}
            onChange={(e) => setPortfolioValue(Number(e.target.value))}
          />
        </div>
        <div>
          <div className="flex items-center gap-1">
            <label className="block text-xs font-medium mb-1">
              Max Trade Size (USD)
            </label>
            <Tooltip content="Hard cap on the maximum size of a single trade in USD." />
          </div>
          <input
            type="number"
            className="w-full p-2 rounded border bg-background text-sm"
            value={maxTradeSizeUSD}
            onChange={(e) => setMaxTradeSizeUSD(Number(e.target.value))}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="flex items-center gap-1">
            <label className="block text-xs font-medium mb-1">
              Max Trades / Day
            </label>
            <Tooltip content="Maximum number of trades allowed per 24h period to prevent overtrading." />
          </div>
          <input
            type="number"
            className="w-full p-2 rounded border bg-background text-sm"
            value={maxTradesPerDay}
            onChange={(e) => setMaxTradesPerDay(Number(e.target.value))}
          />
        </div>
        <div>
          <div className="flex items-center gap-1">
            <label className="block text-xs font-medium mb-1">
              Risk per Trade (%)
            </label>
            <Tooltip content="Percentage of portfolio to risk per trade (based on stop loss)." />
          </div>
          <input
            type="number"
            className="w-full p-2 rounded border bg-background text-sm"
            value={riskPerTradePercent}
            onChange={(e) => setRiskPerTradePercent(Number(e.target.value))}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="flex items-center gap-1">
            <label className="block text-xs font-medium mb-1">
              Stop Loss (%)
            </label>
            <Tooltip content="Percentage drop from entry that triggers an automatic exit." />
          </div>
          <input
            type="number"
            className="w-full p-2 rounded border bg-background text-sm"
            value={stopLossPercent}
            onChange={(e) => setStopLossPercent(Number(e.target.value))}
          />
        </div>
        <div>
          <div className="flex items-center gap-1">
            <label className="block text-xs font-medium mb-1">
              Take Profit (%)
            </label>
            <Tooltip
              content="Percentage gain from entry that triggers an automatic exit to secure profits."              
            />
          </div>
          <input
            type="number"
            className="w-full p-2 rounded border bg-background text-sm"
            value={takeProfitPercent}
            onChange={(e) => setTakeProfitPercent(Number(e.target.value))}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="flex items-center gap-1">
            <label className="block text-xs font-medium mb-1">
              Min Risk/Reward
            </label>
            <Tooltip content="Minimum required ratio of potential profit to potential loss." />
          </div>
          <input
            type="number"
            className="w-full p-2 rounded border bg-background text-sm"
            value={minRiskRewardRatio}
            onChange={(e) => setMinRiskRewardRatio(Number(e.target.value))}
          />
        </div>
        <div>
          <div className="flex items-center gap-1">
            <label className="block text-xs font-medium mb-1">
              Max Portfolio Heat (%)
            </label>
            <Tooltip content="Maximum total risk across all open positions as % of portfolio." />
          </div>
          <input
            type="number"
            className="w-full p-2 rounded border bg-background text-sm"
            value={maxPortfolioHeatPercent}
            onChange={(e) => setMaxPortfolioHeatPercent(Number(e.target.value))}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="flex items-center gap-1">
            <label className="block text-xs font-medium mb-1">
              Max Open Positions
            </label>
            <Tooltip content="Maximum number of concurrent open trades." />
          </div>
          <input
            type="number"
            className="w-full p-2 rounded border bg-background text-sm"
            value={maxOpenPositions}
            onChange={(e) => setMaxOpenPositions(Number(e.target.value))}
          />
        </div>
        <div>
          <div className="flex items-center gap-1">
            <label className="block text-xs font-medium mb-1">
              Daily Loss Limit (%)
            </label>
            <Tooltip content="Maximum daily loss allowed before trading is suspended for the day." />
          </div>
          <input
            type="number"
            className="w-full p-2 rounded border bg-background text-sm"
            value={dailyLossLimitPercent}
            onChange={(e) => setDailyLossLimitPercent(Number(e.target.value))}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="flex items-center gap-1">
            <label className="block text-xs font-medium mb-1">
              Daily Profit Target (%)
            </label>
            <Tooltip content="Daily profit target; reaching this may trigger reduced risk or suspension." />
          </div>
          <input
            type="number"
            className="w-full p-2 rounded border bg-background text-sm"
            value={dailyProfitTargetPercent}
            onChange={(e) =>
              setDailyProfitTargetPercent(Number(e.target.value))
            }
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
