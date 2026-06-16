import "dotenv/config";
import crypto from "crypto";
import { execSync } from "child_process";
import path from "path";
import { initDB, getDB } from "./db.js";
import { resolveConfig } from "./src/config_resolver.js";
import { riskProfileToGuardrails } from "./src/agents/riskProfileToGuardrails.js";
import { IndicatorManager } from "./src/indicators/index.js";
import { resolveEntrySide } from "./src/manual/resolveEntrySide.js";
import { SafetyValidator } from "./src/validators/index.js";
import { BitGetService } from "./src/services/exchange/bitget.js";
import { PrecisionManager } from "./src/utils/precision.js";
import { assetService } from "./src/server/services/asset.service.js";
import { toSnake, toCamel } from "./src/utils/casing.js";
import { timeframeToMinutes } from "./src/utils/timeframe.js";
import { marketDataService } from "./src/services/market-data.service.js";
import { Technicals } from "./src/indicators/technical.js";

// ─── Config ────────────────────────────────────────────────────────────────

const CONFIG = {
  portfolioValue: undefined,
  side: undefined, // Must be provided by decision via trading indicator
  tradeMode: process.env.TRADE_MODE, // Must be provided via environment or config
  bitget: {
    apiKey: process.env.BITGET_API_KEY,
    secretKey: process.env.BITGET_SECRET_KEY,
    passphrase: process.env.BITGET_PASSPHRASE,
    baseUrl: process.env.BITGET_BASE_URL || "https://api.bitget.com",
  },
};

const LOG_FILE = "safety-check-log.json";
const CSV_FILE = "trades.csv";
const CSV_HEADERS = [
  "Date",
  "Time (UTC)",
  "Exchange",
  "Symbol",
  "Side",
  "Quantity",
  "Price",
  "Total USD",
  "Fee (est.)",
  "Net Amount",
  "Order ID",
  "Mode",
  "Notes",
].join(",");

const precisionManager = new PrecisionManager();

// ─── Logging & Utils ──────────────────────────────────────────────────────────

async function logEvent(strategyId, type, payload) {
  const timestamp = Date.now();
  const snakePayload = typeof payload === 'object' ? toSnake(payload) : payload;

  try {
    await fetch("http://localhost:3000/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ strategyId, type, payload, timestamp }),
    });
  } catch (err) {
    console.error(
      `[Event Error] Failed to send event to server: ${err.message}`,
    );
  }
}

async function logEventSimple(strategyId, type, message) {
  await logEvent(strategyId, type, message);
}

async function recordTrade(strategyId, tradeData) {
  const db = getDB();
  const snakeTrade = toSnake(tradeData);
  console.log(`[DB Debug] Recording trade for strategy ${strategyId}:`, snakeTrade);
  await db.run(
    "INSERT INTO trades (strategy_id, symbol, side, price, size_usd, status, result, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [
      strategyId,
      snakeTrade.symbol,
      snakeTrade.side || "BUY",
      snakeTrade.price,
      snakeTrade.size_usd,
      snakeTrade.status,
      snakeTrade.result || 0,
      snakeTrade.notes,
    ],
  );
}

async function updateActivePosition(strategyId, positionData) {
  const db = getDB();
  const snakePos = toSnake(positionData);
  if (snakePos.action === "open") {
    await db.run(
      "INSERT OR REPLACE INTO active_positions (strategy_id, symbol, side, entry_price, size_usd, stop_loss, take_profit, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN')",
      [
        strategyId,
        snakePos.symbol,
        snakePos.side,
        snakePos.price,
        snakePos.size_usd,
        snakePos.stop_loss,
        snakePos.take_profit,
      ],
    );
  } else if (snakePos.action === "close") {
    await db.run(
      "UPDATE active_positions SET status = 'CLOSED', exit_price = ?, exit_timestamp = CURRENT_TIMESTAMP WHERE strategy_id = ? AND symbol = ? AND status = 'OPEN'",
      [snakePos.exit_price, strategyId, snakePos.symbol],
    );
  } else if (snakePos.action === "update_price") {
    await db.run(
      "UPDATE active_positions SET current_price = ?, current_pnl = ?, current_pnl_percent = ?, price_updated_at = CURRENT_TIMESTAMP WHERE strategy_id = ? AND symbol = ? AND status = 'OPEN'",
      [snakePos.current_price, snakePos.current_pnl, snakePos.current_pnl_percent, strategyId, snakePos.symbol],
    );
  }
}

async function checkActivePosition(strategyId, symbol) {
  const db = getDB();
  return await db.get(
    "SELECT * FROM active_positions WHERE strategy_id = ? AND symbol = ? AND status = 'OPEN'",
    [strategyId, symbol],
  );
}

async function countTodaysTrades(strategyId) {
  const db = getDB();
  const today = new Date().toISOString().slice(0, 10);
  const result = await db.get(
    "SELECT COUNT(*) as count FROM trades WHERE strategy_id = ? AND timestamp >= ? AND status IN ('LIVE', 'PAPER')",
    [strategyId, today],
  );
  return result.count;
}

async function calculateTotalOpenRisk(strategyId) {
  const db = getDB();
  const result = await db.get(
    "SELECT SUM(size_usd) as totalRisk FROM active_positions WHERE strategy_id = ? AND status = 'OPEN'",
    [strategyId],
  );
  return result?.totalRisk || 0;
}

// ─── Market Data ───────────────────────────────────────────────────────────────
// Market data fetching is now handled by marketDataService

// ─── Main Engine ────────────────────────────────────────────────────────────

async function run(inputStrategyId) {
  await initDB();
  await assetService.init();

  const strategyIdStr = inputStrategyId || process.env.STRATEGY_ID;
  if (!strategyIdStr) {
    throw new Error(
      "Strategy ID is required. Provide it as an argument or set STRATEGY_ID environment variable.",
    );
  }

  const response = await fetch(
    `http://localhost:3000/api/strategies/full-config/${strategyIdStr}`,
  );
  if (!response.ok) {
    throw new Error(
      `Failed to fetch strategy config: ${response.status} ${response.statusText}`,
    );
  }
  const rawStrategyConfig = await response.json();
  console.log(`[Engine] Loaded raw config from full-config endpoint for ID: ${strategyIdStr}`);
  console.log(`[Engine] Professional Risk Params:`, {
    riskPerTradePercent: rawStrategyConfig.riskSettings?.riskPerTradePercent,
    stopLossPercent: rawStrategyConfig.riskSettings?.stopLossPercent,
    takeProfitPercent: rawStrategyConfig.riskSettings?.takeProfitPercent,
    maxTradesPerDay: rawStrategyConfig.riskSettings?.maxTradesPerDay,
    portfolioValue: rawStrategyConfig.riskSettings?.portfolioValue,
  });

  const riskOverrides = {};
  if (rawStrategyConfig.riskPerTradePercent !== undefined) riskOverrides.riskPerTradePercent = rawStrategyConfig.riskPerTradePercent;
  if (rawStrategyConfig.stopLossPercent !== undefined) riskOverrides.stopLossPercent = rawStrategyConfig.stopLossPercent;
  if (rawStrategyConfig.takeProfitPercent !== undefined) riskOverrides.takeProfitPercent = rawStrategyConfig.takeProfitPercent;
  if (rawStrategyConfig.maxTradesPerDay !== undefined) riskOverrides.maxTradesPerDay = rawStrategyConfig.maxTradesPerDay;
  if (rawStrategyConfig.maxTradeSizeUSD !== undefined) riskOverrides.maxTradeSizeUSD = rawStrategyConfig.maxTradeSizeUSD;

  const normalizedConfig = {
    ...rawStrategyConfig,
    riskTemplateId:
      rawStrategyConfig.riskTemplateId ||
      rawStrategyConfig.metadata?.riskTemplateId,
    logicTemplateId:
      rawStrategyConfig.logicTemplateId ||
      rawStrategyConfig.metadata?.logicTemplateId,
    riskOverrides,
    logicOverrides: rawStrategyConfig.logicOverrides || rawStrategyConfig.logic,
  };

  const strategyConfig = resolveConfig(normalizedConfig);

  console.log(`[Engine] Resolved Strategy Config:`, JSON.stringify(strategyConfig, null, 2));
  console.log(
    `[Engine] Resolved Risk Limit: ${strategyConfig.risk.maxTradesPerDay}`,
  );

  const strategyName =
    rawStrategyConfig.strategy?.name || rawStrategyConfig.name;

  // Instantiate Modular Services
  const indicatorManager = new IndicatorManager(strategyConfig.logic || {});
  const safetyValidator = new SafetyValidator();
  const bitgetService = new BitGetService(CONFIG.bitget);

  const db = getDB();
  // Use the provided strategyId instead of looking it up by name
  const strategyId = parseInt(strategyIdStr);

  const watchlist = rawStrategyConfig.watchlist || rawStrategyConfig.watchlist_list;
  if (!watchlist || !Array.isArray(watchlist) || watchlist.length === 0) {
    throw new Error(
      `Watchlist is empty or missing. Strategy cannot be started.`,
    );
  }

  const timeframe =
    rawStrategyConfig.timeframe || rawStrategyConfig.default_timeframe;
  if (!timeframe) {
    throw new Error(`Timeframe is missing in strategy configuration.`);
  }

  await logEventSimple(
    strategyId,
    "INFO",
    `Bot started for strategy: ${strategyName}`,
  );

  while (true) {
    try {
      console.log(
        "═══════════════════════════════════════════════════════════",
      );
      const totalOpenRisk = await calculateTotalOpenRisk(strategyId);
      console.log(`  Total Open Risk: $${totalOpenRisk.toFixed(2)}`);
      await logEventSimple(
        strategyId,
        "INFO",
        `--- Cycle Start: ${new Date().toISOString()} | Total Risk: $${totalOpenRisk.toFixed(2)} ---`,
      );
      console.log(`  Strategy: ${strategyName}`);
      const isPaper = rawStrategyConfig.paperTrading !== false;
      console.log(
        `  Mode: ${isPaper ? "📋 PAPER TRADING" : "🔴 LIVE TRADING"}`,
      );
      console.log(
        "═══════════════════════════════════════════════════════════",
      );

      for (const symbol of watchlist) {
        try {
          console.log(`  Symbol: ${symbol} | Timeframe: ${timeframe}`);

          const todayCount = await countTodaysTrades(strategyId);
          const maxTradesDayLimit = strategyConfig.risk.maxTradesPerDay;
          if (todayCount >= maxTradesDayLimit) {
            const msg = `🚫 Max trades per day reached: ${todayCount}/${maxTradesDayLimit}`;
            console.log(msg);
            await logEventSimple(strategyId, "CHECK", msg);
          } else {
            await logEventSimple(
              strategyId,
              "INFO",
              `Fetching market data for ${symbol}...`,
            );
            const candles = await marketDataService.fetchCandles(symbol, timeframe, 500);
            const lastCandle = candles[candles.length - 1];
            const price = lastCandle.close;
            const open = lastCandle.open;

            const activePosition = await checkActivePosition(
              strategyId,
              symbol,
            );
            if (activePosition) {
              const msg = `ℹ️  Active position found: ${activePosition.side} at $${await precisionManager.format(activePosition.entry_price, symbol)}`;
              console.log(`\n${msg}`);
              console.log(
                `   Monitoring for exit (SL: $${activePosition.stop_loss ? await precisionManager.format(activePosition.stop_loss, symbol) : "N/A"}, TP: $${activePosition.take_profit ? await precisionManager.format(activePosition.take_profit, symbol) : "N/A"})...`,
              );

              let exitTriggered = false;
              let exitType = "";
              let exitPrice = price;

              if (activePosition.side === "BUY") {
                if (
                  activePosition.stop_loss &&
                  price <= activePosition.stop_loss
                ) {
                  exitTriggered = true;
                  exitType = "Stop Loss";
                } else if (
                  activePosition.take_profit &&
                  price >= activePosition.take_profit
                ) {
                  exitTriggered = true;
                  exitType = "Take Profit";
                }
              } else if (activePosition.side === "SELL") {
                if (
                  activePosition.stop_loss &&
                  price >= activePosition.stop_loss
                ) {
                  exitTriggered = true;
                  exitType = "Stop Loss";
                } else if (
                  activePosition.take_profit &&
                  price <= activePosition.take_profit
                ) {
                  exitTriggered = true;
                  exitType = "Take Profit";
                }
              }

              if (exitTriggered) {
                console.log(
                  `\n🚨 EXIT TRIGGERED: ${exitType} hit at $${await precisionManager.format(price, symbol)}`,
                );

                // 1. Update position status to CLOSED
                await updateActivePosition(strategyId, {
                  action: "close",
                  symbol,
                  exitPrice: price,
                });

                // 2. Record the closing trade
                const exitSide = activePosition.side === "BUY" ? "SELL" : "BUY";
                const pnl =
                  activePosition.side === "BUY"
                    ? activePosition.size_usd *
                      (price / activePosition.entry_price - 1)
                    : activePosition.size_usd *
                      (1 - price / activePosition.entry_price);

                await recordTrade(strategyId, {
                  symbol,
                  price,
                  sizeUSD: activePosition.size_usd,
                  side: exitSide,
                  status: "CLOSED",
                  result: pnl,
                  notes: `Closed via ${exitType}. PnL: $${await precisionManager.format(pnl, "USDT")}`,
                });

                await logEventSimple(
                  strategyId,
                  "TRADE",
                  `Position closed via ${exitType} at $${await precisionManager.format(price, symbol)}. PnL: $${await precisionManager.format(pnl, "USDT")}`,
                );
                console.log(
                  `✅ Position closed. PnL: $${await precisionManager.format(pnl, "USDT")}`,
                );
              } else {
                // Numeric PnL once; the socket payload + DB carry raw numbers and
                // the asset's price precision. The client formats at the view
                // (shared formatPrice) — no server-side string formatting.
                const pnlUsd = activePosition.side === "BUY"
                  ? activePosition.size_usd * (price / activePosition.entry_price - 1)
                  : activePosition.size_usd * (1 - price / activePosition.entry_price);
                const pnlPercent = activePosition.side === "BUY"
                  ? (price / activePosition.entry_price - 1) * 100
                  : (1 - price / activePosition.entry_price) * 100;

                await logEvent(strategyId, "position_active", {
                  symbol,
                  side: activePosition.side,
                  entry_price: activePosition.entry_price,
                  size_usd: activePosition.size_usd,
                  stop_loss: activePosition.stop_loss,
                  take_profit: activePosition.take_profit,
                  current_price: price,
                  pnl: pnlUsd,
                  pnl_percent: pnlPercent,
                  price_precision: precisionManager.getPrecision(symbol),
                  message: "Active position found, monitoring for exit.",
                });

                await updateActivePosition(strategyId, {
                  action: "update_price",
                  symbol,
                  current_price: price,
                  current_pnl: pnlUsd,
                  current_pnl_percent: pnlPercent,
                });
              }
            } else {
              console.log(
                `\n── Market Data: Current price: $${await precisionManager.format(price, symbol)} ───────────────────\n`,
              );

              // 1. Calculate Indicators using Modular Manager
              const logicType =
                strategyConfig.logic?.type ||
                (strategyConfig.name?.includes("Breakout") ||
                strategyConfig.strategy?.name?.includes("Breakout")
                  ? "Breakout"
                  : strategyConfig.name?.includes("Smart Money") ||
                      strategyConfig.strategy?.name?.includes("Smart Money")
                    ? "SMC"
                    : null);

              let strategyData = {};
              let side = "BUY"; // Default side
                if (logicType) {
                  const htfTf = strategyConfig.htf_timeframe || strategyConfig.htfTimeframe;
                  let htfCandles = null;
                  if (htfTf) {
                    try {
                      htfCandles = await marketDataService.fetchCandles(symbol, htfTf, 500);
                    } catch (error) {
                      console.error(`[Engine] HTF fetch failed for ${symbol} (${htfTf}): ${error.message}`);
                    }
                  }
                  strategyData = await indicatorManager.calculate(logicType, candles, { htfCandles });

                  // ATR Calculation for dynamic stops if configured
                  if (strategyConfig.stop_mode === "atr") {
                    const atrPeriod = strategyConfig.atr_period || 14;
                    const atrValues = Technicals.atr(candles, atrPeriod);
                    if (atrValues.length > 0) {
                      strategyData.currentAtr = atrValues[atrValues.length - 1];
                    } else {
                      console.warn(`[Engine] ATR calculation failed for ${symbol} (insufficient candles)`);
                      strategyData.currentAtr = null;
                    }
                  }

                // Operator-facing visibility (unchanged from legacy logging).
                if (logicType === "Breakout" && strategyData.channel?.active) {
                  console.log(
                    `  Channel Active: Top $${strategyData.channel.top.toFixed(2)} | Bottom $${strategyData.channel.bottom.toFixed(2)}`,
                  );
                } else if (logicType === "SMC") {
                  console.log(
                    `  Trend: ${strategyData.structure?.trend === 1 ? "BULLISH" : strategyData.structure?.trend === -1 ? "BEARISH" : "NEUTRAL"}`,
                  );
                  console.log(
                    `  OBs detected: ${strategyData.obs?.length || 0} | FVGs detected: ${strategyData.fvgs?.length || 0}`,
                  );
                }

                // Feature flag: per-strategy config overrides the global env (default OFF).
                const useSignalCore =
                  strategyConfig.useSignalCore ??
                  (process.env.USE_SIGNAL_CORE_MANUAL === "true");

                const entry = resolveEntrySide({
                  logicType,
                  strategyData,
                  price,
                  candles,
                  useSignalCore,
                });

                if (entry.skip) {
                  const skipMsg = `⏭️  No entry for ${symbol}: signal core skipped entry (${entry.reason})`;
                  console.log(skipMsg);
                  await logEventSimple(strategyId, "CHECK", skipMsg);
                  continue; // skip to next symbol in the watchlist — no spurious entry
                }

                side = entry.side;
              }

              // 2. Run Safety Checks using Modular Validator
              const { results, allPass, gci } = safetyValidator.run(
                price,
                open,
                strategyData,
                strategyConfig,
              );

              // Log checks to console
              results.forEach((result) => {
                const icon = result.pass ? "✅" : "🚫";
                console.log(
                  `  ${icon} ${result.label} | Required: ${result.required} | Actual: ${result.actual} | Score: ${result.score.toFixed(2)}`,
                );
              });

              console.log(`  Global Confidence Index (GCI): ${gci.toFixed(2)}`);

              // Log results to DB
              await logEvent(strategyId, "safety_check", {
                symbol,
                price,
                allPass,
                gci,
                results,
              });

  const risk = strategyConfig.risk;
  const guardrails = riskProfileToGuardrails(risk);
  const portfolioValue = guardrails.portfolioValue;
  const confidenceFloor = 0.8;

  const baseRiskUSD = portfolioValue * guardrails.riskPerTrade;

  let finalTradeSize = 0;
  if (gci >= confidenceFloor) {
    const scalingFactor = (gci - confidenceFloor) / (1.0 - confidenceFloor);
    const multiplier = 0.3 + (0.7 * scalingFactor);
    finalTradeSize = baseRiskUSD * multiplier;
  }
  const safeTradeSize = isNaN(finalTradeSize) ? 0 : finalTradeSize;

              console.log(
                "\n── Decision ─────────────────────────────────────────────\n",
              );

              if (!allPass) {
                const blockedMsg = `🚫 TRADE BLOCKED`;
                console.log(blockedMsg);
                console.log(`   Confidence: ${gci.toFixed(2)}`);
                results
                  .filter((r) => !r.pass)
                  .forEach((r) => console.log(`   - ${r.label}`));

                await logEventSimple(
                  strategyId,
                  "CHECK",
                  `${blockedMsg}: ${results
                    .filter((r) => !r.pass)
                    .map((r) => r.label)
                    .join("; ")} (GCI: ${gci.toFixed(2)})`,
                );
                await recordTrade(strategyId, {
                  symbol,
                  price,
                  sizeUSD: safeTradeSize,
                  status: "BLOCKED",
                  notes: `Failed: ${results
                    .filter((r) => !r.pass)
                    .map((r) => r.label)
                    .join("; ")} (GCI: ${gci.toFixed(2)})`,
                });
              } else if (gci < confidenceFloor) {
                const blockedMsg = `🚫 TRADE BLOCKED: Below Confidence Floor (GCI: ${gci.toFixed(2)})`;
                console.log(blockedMsg);
                await logEventSimple(strategyId, "CHECK", blockedMsg);
                await recordTrade(strategyId, {
                  symbol,
                  price,
                  sizeUSD: 0,
                  status: "BLOCKED",
                  notes: blockedMsg,
                });
              } else {
                console.log(`✅ ALL CONDITIONS MET`);
                console.log(`   Confidence: ${gci.toFixed(2)}`);
                console.log(
                  `   Dynamic Trade Size: $${finalTradeSize.toFixed(2)}`,
                );
                await logEventSimple(
                  strategyId,
                  "TRADE",
                  `All safety conditions met. GCI: ${gci.toFixed(2)}. Final Trade Size: $${finalTradeSize.toFixed(2)}. Preparing trade.`,
                );

                const isPaperBot = rawStrategyConfig.paperTrading !== false;
                if (isPaperBot) {
                  console.log(
                    `\n📋 PAPER TRADE — would ${side === "BUY" ? "buy" : "sell"} ${symbol} ~$${finalTradeSize.toFixed(2)} at market`,
                  );
                  await recordTrade(strategyId, {
                    symbol,
                    price,
                    sizeUSD: safeTradeSize,
                    status: "PAPER",
                    notes: "All conditions met",
                  });
                await updateActivePosition(strategyId, {
                  action: "open",
                  symbol,
                  side,
                  price,
                  sizeUSD: safeTradeSize,
                  stopLoss: precisionManager.format(
                    side === "BUY"
                      ? (strategyConfig.stop_mode === "atr" && strategyData.currentAtr
                          ? price - strategyData.currentAtr * (strategyConfig.atr_multiplier || 1.5)
                          : price * (1 - guardrails.stopLossPct))
                      : (strategyConfig.stop_mode === "atr" && strategyData.currentAtr
                          ? price + strategyData.currentAtr * (strategyConfig.atr_multiplier || 1.5)
                          : price * (1 + guardrails.stopLossPct)),
                    symbol
                  ),
                  takeProfit: precisionManager.format(
                    side === "BUY"
                      ? (strategyConfig.stop_mode === "atr" && strategyData.currentAtr
                          ? price + strategyData.currentAtr * (strategyConfig.tp_multiplier || 3)
                          : price * (1 + guardrails.takeProfitPct))
                      : (strategyConfig.stop_mode === "atr" && strategyData.currentAtr
                          ? price - strategyData.currentAtr * (strategyConfig.tp_multiplier || 3)
                          : price * (1 - guardrails.takeProfitPct)),
                    symbol
                  ),
                });
                } else {
                  console.log(
                    `\n🔴 PLACING LIVE ORDER — $${finalTradeSize.toFixed(2)} ${side} ${symbol}`,
                  );
                  try {
                    const tradeMode =
                      strategyConfig.tradeMode || CONFIG.tradeMode;
                    const order = await bitgetService.placeOrder(
                      symbol,
                      side.toLowerCase(),
                      finalTradeSize,
                      price,
                      tradeMode,
                    );

                    await recordTrade(strategyId, {
                      symbol,
                      price,
                      sizeUSD: safeTradeSize,
                      status: "LIVE",
                      notes: "Lived order placed",
                    });
                    await updateActivePosition(strategyId, {
                      action: "open",
                      symbol,
                      side,
                      price,
                      sizeUSD: safeTradeSize,
                      stopLoss: side === "BUY" ? price * (1 - guardrails.stopLossPct) : price * (1 + guardrails.stopLossPct),
                      takeProfit: side === "BUY" ? price * (1 + guardrails.takeProfitPct) : price * (1 - guardrails.takeProfitPct),
                    });
                    console.log(`✅ ORDER PLACED — ${order.orderId}`);
                    await logEventSimple(
                      strategyId,
                      "TRADE",
                      `LIVE Order placed: ${order.orderId}`,
                    );
                  } catch (err) {
                    console.log(`❌ ORDER FAILED — ${err.message}`);
                    await logEventSimple(
                      strategyId,
                      "ERROR",
                      `Order failed: ${err.message}`,
                    );
                    await recordTrade(strategyId, {
                      symbol,
                      price,
                      sizeUSD: safeTradeSize,
                      status: "FAILED",
                      notes: err.message,
                    });
                  }
                }
                console.log(
                  "═══════════════════════════════════════════════════════════\n",
                );
              }
            }
          }
        } catch (err) {
          const isBinanceError = err.message.includes("Binance API error");
          const errMsg = isBinanceError
            ? `⚠️  Skipping ${symbol}: ${err.message} (Token might not exist on Binance)`
            : `❌ Error processing ${symbol}: ${err.message}`;

          console.log(errMsg);
          await logEventSimple(strategyId, "ERROR", errMsg);
        }
      }
    } catch (err) {
      console.error(`\n❌ CRITICAL ENGINE ERROR: ${err.message}`);
      await logEventSimple(
        strategyId,
        "ERROR",
        `Critical error: ${err.message}`,
      );
    }

    let sleepMs = 60000;
    if (rawStrategyConfig.intervalSeconds) {
      sleepMs = rawStrategyConfig.intervalSeconds * 1000;
    } else {
      const minutes = timeframeToMinutes(timeframe);
      if (!minutes) {
        throw new Error(`Unsupported timeframe for sleep calculation: ${timeframe}`);
      }
      sleepMs = (minutes * 60 * 1000) / 10;
    }
    sleepMs = Math.max(sleepMs, 10000);
    await logEventSimple(
      strategyId,
      "INFO",
      `Sleeping for ${Math.round(sleepMs / 1000)}s...`,
    );
    await new Promise((resolve) => setTimeout(resolve, sleepMs));
  }
}

if (process.argv[2]) {
  run(process.argv[2]).catch((err) => {
    console.error("Bot error:", err);
    process.exit(1);
  });
} else if (process.env.STRATEGY_ID) {
  run(process.env.STRATEGY_ID).catch((err) => {
    console.error("Bot error:", err);
    process.exit(1);
  });
} else {
  console.error(
    "Error: No strategy ID provided. Use 'node bot_engine.js <id>' or set STRATEGY_ID env var.",
  );
  process.exit(1);
}

export { run, CONFIG };
