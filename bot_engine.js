import "dotenv/config";
import crypto from "crypto";
import { execSync } from "child_process";
import path from "path";
import { initDB, getDB } from "./db.js";
import { resolveConfig } from "./src/config_resolver.js";
import { IndicatorManager } from "./src/indicators/index.js";
import { SafetyValidator } from "./src/validators/index.js";
import { BitGetService } from "./src/services/exchange/bitget.js";
import { PrecisionManager } from "./src/utils/precision.js";

  // ─── Config ────────────────────────────────────────────────────────────────

  const CONFIG = {
    portfolioValue: undefined,
    tradeMode: "spot", // Default fallback
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
    const db = getDB();
    const timestamp = Date.now();
    await db.run(
      "INSERT INTO events (strategy_id, type, payload, timestamp) VALUES (?, ?, ?, ?)",
      [strategyId, type, JSON.stringify(payload), timestamp],
    );

    try {
      await fetch("http://localhost:3000/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategyId, type, payload, timestamp }),
      });
    } catch (err) {
      console.error(`[Event Error] Failed to send event to server: ${err.message}`);
    }
  }

  async function logEventSimple(strategyId, type, message) {
    await logEvent(strategyId, type, message);
  }

  async function recordTrade(strategyId, tradeData) {
    const db = getDB();
    await db.run(
      "INSERT INTO trades (strategy_id, symbol, side, price, size_usd, status, result, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        strategyId,
        tradeData.symbol,
        tradeData.side || "BUY",
        tradeData.price,
        tradeData.tradeSize,
        tradeData.status,
        tradeData.result || 0,
        tradeData.notes,
      ],
    );
  }

  async function updateActivePosition(strategyId, positionData) {
    const db = getDB();
    if (positionData.action === "open") {
      await db.run(
        "INSERT INTO active_positions (strategy_id, symbol, side, entry_price, size_usd, stop_loss, take_profit, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN')",
        [
          strategyId,
          positionData.symbol,
          positionData.side,
          positionData.price,
          positionData.sizeUSD,
          positionData.stopLoss,
          positionData.takeProfit,
        ],
      );
    } else if (positionData.action === "close") {
      await db.run(
        "UPDATE active_positions SET status = 'CLOSED', exit_price = ?, exit_timestamp = CURRENT_TIMESTAMP WHERE strategy_id = ? AND symbol = ? AND status = 'OPEN'",
        [positionData.exitPrice, strategyId, positionData.symbol],
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
      "SELECT COUNT(*) as count FROM trades WHERE strategy_id = ? AND timestamp >= ?",
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

  async function fetchCandles(symbol, interval, limit = 500) {
    const intervalMap = {
      "1m": "1m",
      "3m": "3m",
      "5m": "5m",
      "15m": "15m",
      "30m": "30m",
      "1H": "1h",
      "4H": "4h",
      "1D": "1d",
      "1W": "1w",
    };
    const binanceInterval = intervalMap[interval] || "1m";
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${binanceInterval}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Binance API error: ${res.status}`);
    const data = await res.json();
    return data.map((k) => ({
      time: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
  }

  // ─── Main Engine ────────────────────────────────────────────────────────────

  async function run(inputStrategyId) {
    await initDB();

    const strategyIdStr = inputStrategyId || process.env.STRATEGY_ID;
    if (!strategyIdStr) {
      throw new Error("Strategy ID is required. Provide it as an argument or set STRATEGY_ID environment variable.");
    }

    const response = await fetch(`http://localhost:3000/api/strategies/config/${strategyIdStr}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch strategy config: ${response.status} ${response.statusText}`);
    }
    const rawStrategyConfig = await response.json();

    const normalizedConfig = {
      ...rawStrategyConfig,
      riskTemplateId:
        rawStrategyConfig.riskTemplateId ||
        rawStrategyConfig.metadata?.riskTemplateId,
      logicTemplateId:
        rawStrategyConfig.logicTemplateId ||
        rawStrategyConfig.metadata?.logicTemplateId,
      riskOverrides: rawStrategyConfig.riskOverrides || rawStrategyConfig.risk,
      logicOverrides: rawStrategyConfig.logicOverrides || rawStrategyConfig.logic,
    };

    const strategyConfig = resolveConfig(normalizedConfig);

    if (!strategyConfig.portfolioValue || strategyConfig.portfolioValue <= 0) {
      throw new Error("CRITICAL ERROR: portfolioValue is missing or invalid. Please configure the deposit size in the Strategy Risk settings.");
    }

    console.log(`[Engine] Loaded strategy config for ID: ${strategyIdStr}`);
    console.log(`[Engine] Resolved Risk Limit: ${strategyConfig.risk.maxTradesPerDay}`);

    const strategyName = rawStrategyConfig.strategy?.name || rawStrategyConfig.name;

    // Instantiate Modular Services
    const indicatorManager = new IndicatorManager(strategyConfig.logic || {});
    const safetyValidator = new SafetyValidator();
    const bitgetService = new BitGetService(CONFIG.bitget);

    const db = getDB();
    // Use the provided strategyId instead of looking it up by name
    const strategyId = parseInt(strategyIdStr);

    const watchlist = rawStrategyConfig.watchlist;
    if (!watchlist || !Array.isArray(watchlist) || watchlist.length === 0) {
      throw new Error(`Watchlist is empty or missing. Strategy cannot be started.`);
    }

    const timeframe = rawStrategyConfig.default_timeframe || rawStrategyConfig.timeframe || "4H";

    await logEventSimple(strategyId, "INFO", `Bot started for strategy: ${strategyName}`);

    while (true) {
      try {
        console.log("═══════════════════════════════════════════════════════════");
        const totalOpenRisk = await calculateTotalOpenRisk(strategyId);
        console.log(`  Total Open Risk: $${totalOpenRisk.toFixed(2)}`);
        await logEventSimple(strategyId, "INFO", `--- Cycle Start: ${new Date().toISOString()} | Total Risk: $${totalOpenRisk.toFixed(2)} ---`);
        console.log(`  Strategy: ${strategyName}`);
        const isPaper = rawStrategyConfig.paperTrading !== false;
        console.log(`  Mode: ${isPaper ? "📋 PAPER TRADING" : "🔴 LIVE TRADING"}`);
        console.log("═══════════════════════════════════════════════════════════");

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
            await logEventSimple(strategyId, "INFO", `Fetching market data for ${symbol}...`);
            const candles = await fetchCandles(symbol, timeframe, 500);
            const lastCandle = candles[candles.length - 1];
            const price = lastCandle.close;
            const open = lastCandle.open;

            const activePosition = await checkActivePosition(strategyId, symbol);
            if (activePosition) {
              const msg = `ℹ️  Active position found: ${activePosition.side} at $${await precisionManager.format(activePosition.entry_price, symbol)}`;
              console.log(`\n${msg}`);
              console.log(`   Monitoring for exit (SL: $${activePosition.stop_loss ? await precisionManager.format(activePosition.stop_loss, symbol) : "N/A"}, TP: $${activePosition.take_profit ? await precisionManager.format(activePosition.take_profit, symbol) : "N/A"})...`);

              let exitTriggered = false;
              let exitType = "";
              let exitPrice = price;

              if (activePosition.side === "BUY") {
                if (activePosition.stop_loss && price <= activePosition.stop_loss) {
                  exitTriggered = true;
                  exitType = "Stop Loss";
                } else if (activePosition.take_profit && price >= activePosition.take_profit) {
                  exitTriggered = true;
                  exitType = "Take Profit";
                }
              } else if (activePosition.side === "SELL") {
                if (activePosition.stop_loss && price >= activePosition.stop_loss) {
                  exitTriggered = true;
                  exitType = "Stop Loss";
                } else if (activePosition.take_profit && price <= activePosition.take_profit) {
                  exitTriggered = true;
                  exitType = "Take Profit";
                }
              }

              if (exitTriggered) {
                console.log(`\n🚨 EXIT TRIGGERED: ${exitType} hit at $${await precisionManager.format(price, symbol)}`);

                // 1. Update position status to CLOSED
                await updateActivePosition(strategyId, {
                  action: "close",
                  symbol,
                  exitPrice: price
                });

                // 2. Record the closing trade
                const exitSide = activePosition.side === "BUY" ? "SELL" : "BUY";
                const pnl = activePosition.side === "BUY"
                  ? activePosition.size_usd * (price / activePosition.entry_price - 1)
                  : activePosition.size_usd * (1 - price / activePosition.entry_price);

                await recordTrade(strategyId, {
                  symbol,
                  price,
                  tradeSize: activePosition.size_usd,
                  side: exitSide,
                  status: "CLOSED",
                  result: pnl,
                  notes: `Closed via ${exitType}. PnL: $${await precisionManager.format(pnl, "USDT")}`,
                });


                await logEventSimple(strategyId, "TRADE", `Position closed via ${exitType} at $${await precisionManager.format(price, symbol)}. PnL: $${await precisionManager.format(pnl, "USDT")}`);
                console.log(`✅ Position closed. PnL: $${await precisionManager.format(pnl, "USDT")}`);
              } else {
                await logEvent(strategyId, "position_active", {
                  symbol,
                  side: activePosition.side,
                  entry_price: activePosition.entry_price,
                  size_usd: activePosition.size_usd,
                  stop_loss: activePosition.stop_loss,
                  take_profit: activePosition.take_profit,
                  current_price: price,
                  pnl: activePosition.side === "BUY"
                      ? activePosition.size_usd * (price / activePosition.entry_price - 1)
                      : activePosition.size_usd * (1 - price / activePosition.entry_price),
                  pnl_percent: activePosition.side === "BUY"
                      ? (price / activePosition.entry_price - 1) * 100
                      : (1 - price / activePosition.entry_price) * 100,
                  message: "Active position found, monitoring for exit.",
                });
              }
            } else {
              console.log(`\n── Market Data: Current price: $${await precisionManager.format(price, symbol)} ───────────────────\n`);

              // 1. Calculate Indicators using Modular Manager
              const logicType = strategyConfig.logic?.type ||
                                (strategyConfig.name?.includes("Breakout") || strategyConfig.strategy?.name?.includes("Breakout") ? "Breakout" :
                                 strategyConfig.name?.includes("Smart Money") || strategyConfig.strategy?.name?.includes("Smart Money") ? "SMC" : null);

              let strategyData = {};
              if (logicType) {
                strategyData = indicatorManager.calculate(logicType, candles);

                if (logicType === "Breakout" && strategyData.channel?.active) {
                  console.log(`  Channel Active: Top $${strategyData.channel.top.toFixed(2)} | Bottom $${strategyData.channel.bottom.toFixed(2)}`);
                } else if (logicType === "SMC") {
                  console.log(`  Trend: ${strategyData.structure?.trend === 1 ? "BULLISH" : strategyData.structure?.trend === -1 ? "BEARISH" : "NEUTRAL"}`);
                  console.log(`  OBs detected: ${strategyData.obs?.length || 0} | FVGs detected: ${strategyData.fvgs?.length || 0}`);
                }
              }

              // 2. Run Safety Checks using Modular Validator
              const { results, allPass, gci } = safetyValidator.run(price, open, strategyData, strategyConfig);

              // Log checks to console
              results.forEach(result => {
                const icon = result.pass ? "✅" : "🚫";
                console.log(`  ${icon} ${result.label} | Required: ${result.required} | Actual: ${result.actual} | Score: ${result.score.toFixed(2)}`);
              });

              console.log(`  Global Confidence Index (GCI): ${gci.toFixed(2)}`);

              // Log results to DB
              await logEvent(strategyId, "safety_check", { symbol, price, allPass, gci, results });

              const risk = strategyConfig.risk;
              const portfolioValue = strategyConfig.portfolioValue;

              // GCI Confidence Floor and Dynamic Scaling
              const confidenceFloor = 0.8;
              const baseRiskUSD = 2.0;
              let finalTradeSize = 0;

              if (gci >= confidenceFloor) {
                const scalingFactor = (gci - confidenceFloor) / (1.0 - confidenceFloor);
                finalTradeSize = baseRiskUSD * (0.5 + 0.5 * scalingFactor);
              }

              console.log("\n── Decision ─────────────────────────────────────────────\n");

              if (!allPass) {
                const blockedMsg = `🚫 TRADE BLOCKED`;
                console.log(blockedMsg);
                console.log(`   Confidence: ${gci.toFixed(2)}`);
                results.filter((r) => !r.pass).forEach((r) => console.log(`   - ${r.label}`));

                await logEventSimple(strategyId, "CHECK", `${blockedMsg}: ${results.filter((r) => !r.pass).map((r) => r.label).join("; ")} (GCI: ${gci.toFixed(2)})`);
                await recordTrade(strategyId, {
                  symbol,
                  price,
                  tradeSize: finalTradeSize || Math.min(portfolioValue * (risk.riskPerTradePercent / 100), risk.maxTradeSizeUSD),
                  status: "BLOCKED",
                  notes: `Failed: ${results.filter((r) => !r.pass).map((r) => r.label).join("; ")} (GCI: ${gci.toFixed(2)})`,
                });
              } else if (gci < confidenceFloor) {
                const blockedMsg = `🚫 TRADE BLOCKED: Below Confidence Floor (GCI: ${gci.toFixed(2)})`;
                console.log(blockedMsg);
                await logEventSimple(strategyId, "CHECK", blockedMsg);
                await recordTrade(strategyId, {
                  symbol,
                  price,
                  tradeSize: 0,
                  status: "BLOCKED",
                  notes: blockedMsg,
                });
              } else {
                console.log(`✅ ALL CONDITIONS MET`);
                console.log(`   Confidence: ${gci.toFixed(2)}`);
                console.log(`   Dynamic Trade Size: $${finalTradeSize.toFixed(2)}`);
                await logEventSimple(strategyId, "TRADE", `All safety conditions met. GCI: ${gci.toFixed(2)}. Final Trade Size: $${finalTradeSize.toFixed(2)}. Preparing trade.`);

                const isPaperBot = rawStrategyConfig.paperTrading !== false;
                if (isPaperBot) {
                  console.log(`\n📋 PAPER TRADE — would buy ${symbol} ~$${finalTradeSize.toFixed(2)} at market`);
                  await recordTrade(strategyId, {
                    symbol,
                    price,
                    tradeSize: finalTradeSize,
                    status: "PAPER",
                    notes: "All conditions met",
                  });
                  await updateActivePosition(strategyId, {
                    action: "open",
                    symbol,
                    side: "BUY",
                    price,
                    sizeUSD: finalTradeSize,
                    stopLoss: price * (1 - risk.stopLossPercent / 100),
                    takeProfit: price * (1 + risk.takeProfitPercent / 100),
                  });
                } else {
                  console.log(`\n🔴 PLACING LIVE ORDER — $${finalTradeSize.toFixed(2)} BUY ${symbol}`);
                  try {
                    const tradeMode = strategyConfig.tradeMode || CONFIG.tradeMode;
                    const order = await bitgetService.placeOrder(symbol, "buy", finalTradeSize, price, tradeMode);

                    await recordTrade(strategyId, {
                      symbol,
                      price,
                      tradeSize: finalTradeSize,
                      status: "LIVE",
                      notes: "Lived order placed",
                    });
                    await updateActivePosition(strategyId, {
                      action: "open",
                      symbol,
                      side: "BUY",
                      price,
                      sizeUSD: finalTradeSize,
                      stopLoss: price * (1 - risk.stopLossPercent),
                      takeProfit: price * (1 + risk.takeProfitPercent),
                    });
                    console.log(`✅ ORDER PLACED — ${order.orderId}`);
                    await logEventSimple(strategyId, "TRADE", `LIVE Order placed: ${order.orderId}`);
                  } catch (err) {
                    console.log(`❌ ORDER FAILED — ${err.message}`);
                    await logEventSimple(strategyId, "ERROR", `Order failed: ${err.message}`);
                    await recordTrade(strategyId, {
                      symbol,
                      price,
                      tradeSize: finalTradeSize,
                      status: "FAILED",
                      notes: err.message,
                    });
                  }
                }
              console.log("═══════════════════════════════════════════════════════════\n");
            }
          }
          } catch (err) {
            const isBinanceError = err.message.includes('Binance API error');
            const errMsg = isBinanceError
              ? `⚠️  Skipping ${symbol}: ${err.message} (Token might not exist on Binance)`
              : `❌ Error processing ${symbol}: ${err.message}`;

            console.log(errMsg);
            await logEventSimple(strategyId, "ERROR", errMsg);
          }
        }
      } catch (err) {
        console.error(`\n❌ CRITICAL ENGINE ERROR: ${err.message}`);
        await logEventSimple(strategyId, "ERROR", `Critical error: ${err.message}`);
      }

      let sleepMs = 60000;
      if (rawStrategyConfig.intervalSeconds) {
        sleepMs = rawStrategyConfig.intervalSeconds * 1000;
      } else {
        const timeframeMap = {
          "1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30, "1H": 60, "4H": 240, "1D": 1440, "1W": 10080,
          "1D": "1d",
        };
        const minutes = timeframeMap[timeframe] || 60;
        sleepMs = (minutes * 60 * 1000) / 10;
      }
      sleepMs = Math.max(sleepMs, 10000);
      await logEventSimple(strategyId, "INFO", `Sleeping for ${Math.round(sleepMs / 1000)}s...`);
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
    console.error("Error: No strategy ID provided. Use 'node bot_engine.js <id>' or set STRATEGY_ID env var.");
    process.exit(1);
  }

  export { run, CONFIG };
