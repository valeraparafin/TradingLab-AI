import "dotenv/config";
import { readFileSync } from "fs";
import crypto from "crypto";
import { execSync } from "child_process";
import path from "path";
import { initDB, getDB } from "./db.js";

// ─── Config ────────────────────────────────────────────────────────────────

const CONFIG = {
  portfolioValue: parseFloat(process.env.PORTFOLIO_VALUE_USD || "1000"),
  maxTradeSizeUSD: parseFloat(process.env.MAX_TRADE_SIZE_USD || "100"),
  paperTrading: process.env.PAPER_TRADING === "true",
  tradeMode: process.env.TRADE_MODE || "spot",
  bitget: {
    apiKey: process.env.BITGET_API_KEY,
    secretKey: process.env.BITGET_SECRET_KEY,
    passphrase: process.env.BITGET_PASSPHRASE,
    baseUrl: process.env.BITGET_BASE_URL || "https://api.bitget.com",
  },
};

const LOG_FILE = "safety-check-log.json";
const CSV_FILE = "trades.csv";
const CSV_HEADERS = ["Date","Time (UTC)","Exchange","Symbol","Side","Quantity","Price","Total USD","Fee (est.)","Net Amount","Order ID","Mode","Notes"].join(",");

// ─── Logging & Utils ──────────────────────────────────────────────────────────

async function logEvent(strategyId, type, payload) {
  const db = getDB();
  await db.run(
    "INSERT INTO events (strategy_id, type, payload) VALUES (?, ?, ?)",
    [strategyId, type, JSON.stringify(payload)]
  );

  // Send event to the orchestrator server for real-time UI updates
  try {
    await fetch('http://localhost:3000/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strategyId, type, payload, timestamp: new Date().toISOString() })
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
    "INSERT INTO trades (strategy_id, symbol, side, price, size_usd, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      strategyId,
      tradeData.symbol,
      tradeData.side || "BUY",
      tradeData.price,
      tradeData.tradeSize,
      tradeData.status,
      tradeData.notes
    ]
  );
}

async function updateActivePosition(strategyId, positionData) {
  const db = getDB();
  if (positionData.action === "open") {
    await db.run(
      "INSERT INTO active_positions (strategy_id, symbol, side, entry_price, size_usd, stop_loss, take_profit) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        strategyId,
        positionData.symbol,
        positionData.side,
        positionData.price,
        positionData.sizeUSD,
        positionData.stopLoss,
        positionData.takeProfit
      ]
    );
  } else if (positionData.action === "close") {
    await db.run("DELETE FROM active_positions WHERE strategy_id = ? AND symbol = ?", [strategyId, positionData.symbol]);
  }
}

async function checkActivePosition(strategyId, symbol) {
  const db = getDB();
  return await db.get("SELECT * FROM active_positions WHERE strategy_id = ? AND symbol = ?", [strategyId, symbol]);
}

async function countTodaysTrades(strategyId) {
  const db = getDB();
  const today = new Date().toISOString().slice(0, 10);
  const result = await db.get(
    "SELECT COUNT(*) as count FROM trades WHERE strategy_id = ? AND timestamp >= ?",
    [strategyId, today]
  );
  return result.count;
}

// ─── Market Data ───────────────────────────────────────────────────────────────

async function fetchCandles(symbol, interval, limit = 500) {
  const intervalMap = {
    "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m",
    "1H": "1h", "4H": "4h", "1D": "1d", "1W": "1w",
  };
  const binanceInterval = intervalMap[interval] || "1m";
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${binanceInterval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance API error: ${res.status}`);
  const data = await res.json();
  return data.map((k) => ({
    time: k[0], open: parseFloat(k[1]), high: parseFloat(k[2]),
    low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5]),
  }));
}

// ─── Indicator System ──────────────────────────────────────────────────────────

const LogicExecutors = {
  'SMC': (candles, config) => {
    const pivotLength = config.indicators?.pivot_length || 50;
    const pivots = Indicators.findPivots(candles, pivotLength);
    const structure = Indicators.detectStructure(candles, pivots);
    return {
      structure,
      obs: Indicators.detectOrderBlocks(candles, structure.structure),
      fvgs: Indicators.detectFVG(candles)
    };
  },
  'Breakout': (candles, config) => {
    const length_ = config.indicators?.length_ || 100;
    const length = config.indicators?.length || 14;
    return { channel: Indicators.calcBreakoutChannels(candles, length_, length) };
  }
};

const SafetyValidators = {
  'trend_filter': (price, open, data, config) => {
    const trend = data.structure?.trend;
    return {
      label: "Trend Detected",
      required: "Bullish or Bearish",
      actual: trend === 1 ? "Bullish" : trend === -1 ? "Bearish" : "Neutral",
      pass: trend !== 0
    };
  },
  'zone_filter': (price, open, data, config) => {
    const inOB = data.obs?.some(ob => price >= ob.range.bottom && price <= ob.range.top);
    const inFVG = data.fvgs?.some(fvg => price >= fvg.bottom && price <= fvg.top);
    return {
      label: "Price in OB or FVG",
      required: "True",
      actual: `${inOB || inFVG}`,
      pass: inOB || inFVG
    };
  },
  'channel_active': (price, open, data, config) => {
    const active = data.channel?.active;
    return {
      label: "Channel Active",
      required: "True",
      actual: `${active}`,
      pass: !!active
    };
  },
  'strong_close': (price, open, data, config) => {
    const bodyMidpoint = (open + price) / 2;
    const channel = data.channel;
    if (!channel) return { label: "Channel Data", required: "Exists", actual: "Missing", pass: false };

    const bullish = bodyMidpoint > channel.top;
    const bearish = bodyMidpoint < channel.bottom;

    return {
      label: "Strong Close Breakout",
      required: "Outside Channel",
      actual: bullish ? "Above Top" : bearish ? "Below Bottom" : "Inside",
      pass: bullish || bearish
    };
  }
};

const Indicators = {

  /**
   * Standard Deviation for Breakout strategy
   */
  calcStdDev(values, period) {
    if (values.length < period) return null;
    const slice = values.slice(-period);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
    return Math.sqrt(variance);
  },

  /**
   * Breakout Channel Logic
   */
  calcBreakoutChannels(candles, length_ = 100, length = 14) {
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);

    if (closes.length < length_) return { top: null, bottom: null, active: false };

    const lowestLow = Math.min(...lows.slice(-length_));
    const highestHigh = Math.max(...highs.slice(-length_));
    const normalizedPrices = closes.map(c => (c - lowestLow) / (highestHigh - lowestLow));

    const volArray = [];
    for (let i = 0; i < normalizedPrices.length; i++) {
      if (i < 14) volArray.push(null);
      else volArray.push(this.calcStdDev(normalizedPrices.slice(i - 13, i + 1), 14));
    }

    const window = volArray.slice(- (length + 1)).filter(v => v !== null);
    if (window.length < length) return { top: null, bottom: null, active: false };

    const currentVol = volArray[volArray.length - 1];
    const avgVol = window.reduce((a, b) => a + b, 0) / window.length;

    if (currentVol < avgVol) {
      const recentHigh = Math.max(...highs.slice(-length));
      const recentLow = Math.min(...lows.slice(-length));
      return { top: recentHigh, bottom: recentLow, active: true };
    }
    return { top: null, bottom: null, active: false };
  },

  /**
   * SMC Logic - Pivot detection
   */
  findPivots(candles, length) {
    const pivots = { high: [], low: [] };
    for (let i = length; i < candles.length - length; i++) {
      let isHigh = true;
      let isLow = true;
      for (let j = i - length; j <= i + length; j++) {
        if (i === j) continue;
        if (candles[j].high > candles[i].high) isHigh = false;
        if (candles[j].low < candles[i].low) isLow = false;
      }
      if (isHigh) pivots.high.push({ index: i, price: candles[i].high });
      if (isLow) pivots.low.push({ index: i, price: candles[i].low });
    }
    return pivots;
  },

  /**
   * SMC Logic - BOS / CHoCH detection
   */
  detectStructure(candles, pivots) {
    let trend = 0; // 1 bullish, -1 bearish
    const structure = [];
    let lastHigh = pivots.high.length > 0 ? pivots.high[pivots.high.length - 1].price : null;
    let lastLow = pivots.low.length > 0 ? pivots.low[pivots.low.length - 1].price : null;

    const currentClose = candles[candles.length - 1].close;

    // Simplified detection for the engine: check if current price broke the last pivot
    if (lastHigh && currentClose > lastHigh) {
      const type = trend === -1 ? "CHoCH" : "BOS";
      trend = 1;
      structure.push({ type, bias: "bullish", price: lastHigh });
    } else if (lastLow && currentClose < lastLow) {
      const type = trend === 1 ? "CHoCH" : "BOS";
      trend = -1;
      structure.push({ type, bias: "bearish", price: lastLow });
    }

    return { trend, structure };
  },

  /**
   * SMC Logic - Order Blocks (OB)
   * OB is the last opposite candle before a strong move that causes BOS/CHoCH
   */
  detectOrderBlocks(candles, structure) {
    if (structure.length === 0) return [];
    const lastBreak = structure[structure.length - 1];
    const ob = { type: lastBreak.bias, range: { top: 0, bottom: 0 }, index: 0 };

    // Search back from the break for the last opposing candle
    for (let i = candles.length - 1; i >= 0; i--) {
      if (lastBreak.bias === "bullish") {
        if (candles[i].close < candles[i].open) {
          ob.range = { top: candles[i].high, bottom: candles[i].low };
          ob.index = i;
          break;
        }
      } else {
        if (candles[i].close > candles[i].open) {
          ob.range = { top: candles[i].high, bottom: candles[i].low };
          ob.index = i;
          break;
        }
      }
    }
    return [ob];
  },

  /**
   * SMC Logic - Fair Value Gaps (FVG)
   */
  detectFVG(candles) {
    const fvgs = [];
    const len = candles.length;
    if (len < 3) return fvgs;

    const c1 = candles[len - 3];
    const c2 = candles[len - 2];
    const c3 = candles[len - 1];

    // Bullish FVG: Gap between Candle 1 High and Candle 3 Low
    if (c3.low > c1.high) {
      fvgs.push({ type: "bullish", top: c3.low, bottom: c1.high });
    }
    // Bearish FVG: Gap between Candle 1 Low and Candle 3 High
    if (c3.high < c1.low) {
      fvgs.push({ type: "bearish", top: c1.low, bottom: c3.high });
    }

    return fvgs;
  }
};

// ─── Safety Check ───────────────────────────────────────────────────────────────

async function runSafetyCheck(price, open, strategyData, strategyConfig, strategyId, symbol) {
  const results = [];

  console.log("\n── Safety Check ─────────────────────────────────────────\n");

  const logic = strategyConfig.logic;
  if (!logic || !logic.safety_checks) {
    // Legacy Support: Fallback to old string matching if logic section is missing
    if (strategyConfig?.name?.includes("Breakout") || strategyConfig.strategy?.name?.includes("Breakout")) {
      const channel = strategyData.channel;
      if (!channel || !channel.active) {
        results.push({ label: "Channel Active", required: "True", actual: "False", pass: false });
        return { results, allPass: false };
      }
      const bodyMidpoint = (open + price) / 2;
      const pass = bodyMidpoint > channel.top || bodyMidpoint < channel.bottom;
      results.push({ label: "Strong Close", required: "Outside Channel", actual: "Price", pass });
    } else if (strategyConfig?.name?.includes("Smart Money") || strategyConfig.strategy?.name?.includes("Smart Money")) {
      const { trend } = strategyData.structure || {};
      if (trend === 0) {
        results.push({ label: "Trend Detected", required: "Bullish/Bearish", actual: "Neutral", pass: false });
        return { results, allPass: false };
      }
      const inOB = strategyData.obs?.some(ob => price >= ob.range.bottom && price <= ob.range.top);
      const inFVG = strategyData.fvgs?.some(fvg => price >= fvg.bottom && price <= fvg.top);
      results.push({ label: "Price in OB or FVG", required: "True", actual: `${inOB || inFVG}`, pass: inOB || inFVG });
    } else {
      return { results, allPass: false };
    }
  } else {
    // Modular Execution: Iterate through rules defined in the template
    for (const check of logic.safety_checks) {
      const validator = SafetyValidators[check.id];
      if (validator) {
        const result = validator(price, open, strategyData, strategyConfig);
        results.push(result);
        const icon = result.pass ? "✅" : "🚫";
        console.log(`  ${icon} ${result.label}`);
        console.log(`     Required: ${result.required} | Actual: ${result.actual}`);
      }
    }
  }

  const allPass = results.length > 0 && results.every((r) => r.pass);

  // Log safety check result to DB
  await logEvent(strategyId, "safety_check", {
    symbol,
    price,
    allPass,
    results
  });

  return { results, allPass };
}

// ─── BitGet Execution ────────────────────────────────────────────────────────

function signBitGet(timestamp, method, path, body = "") {
  const message = `${timestamp}${method}${path}${body}`;
  return crypto.createHmac("sha256", CONFIG.bitget.secretKey).update(message).digest("base64");
}

async function placeBitGetOrder(symbol, side, sizeUSD, price, tradeMode) {
  const quantity = (sizeUSD / price).toFixed(6);
  const timestamp = Date.now().toString();
  const path = tradeMode === "spot" ? "/api/v2/spot/trade/placeOrder" : "/api/v2/mix/order/placeOrder";
  const body = JSON.stringify({
    symbol, side, orderType: "market", quantity,
    ...(tradeMode === "futures" && { productType: "USDT-FUTURES", marginMode: "isolated", marginCoin: "USDT" }),
  });
  const signature = signBitGet(timestamp, "POST", path, body);
  const res = await fetch(`${CONFIG.bitget.baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "ACCESS-KEY": CONFIG.bitget.apiKey, "ACCESS-SIGN": signature, "ACCESS-TIMESTAMP": timestamp, "ACCESS-PASSPHRASE": CONFIG.bitget.passphrase },
    body,
  });
  const data = await res.json();
  if (data.code !== "00000") throw new Error(`BitGet order failed: ${data.msg}`);
  return data.data;
}

// ─── Main Engine ────────────────────────────────────────────────────────────

async function run(strategyPath) {
  await initDB();

  const strategyConfig = JSON.parse(readFileSync(strategyPath, "utf8"));
  const strategyName = strategyConfig.strategy?.name || strategyConfig.name;

  // Ensure strategy exists in DB to get strategyId
  const db = getDB();
  await db.run("INSERT OR IGNORE INTO strategies (name) VALUES (?)", [strategyName]);
  const strategy = await db.get("SELECT id FROM strategies WHERE name = ?", [strategyName]);
  const strategyId = strategy.id;

  const symbol = strategyConfig.watchlist ? strategyConfig.watchlist[0] : "BTCUSDT";
  const timeframe = strategyConfig.default_timeframe || strategyConfig.timeframe || "4H";

  await logEventSimple(strategyId, "INFO", `Bot started for strategy: ${strategyName}`);

  while (true) {
    try {
      console.log("═══════════════════════════════════════════════════════════");
      await logEventSimple(strategyId, "INFO", `--- Cycle Start: ${new Date().toISOString()} ---`);
      console.log(`  Strategy: ${strategyName}`);
      const isPaper = strategyConfig.paperTrading !== false;
      console.log(`  Mode: ${isPaper ? "📋 PAPER TRADING" : "🔴 LIVE TRADING"}`);
      console.log("═══════════════════════════════════════════════════════════");
      console.log(`  Symbol: ${symbol} | Timeframe: ${timeframe}`);

      const todayCount = await countTodaysTrades(strategyId);
      const maxTradesDayLimit = strategyConfig.risk?.maxTradesPerDay || 3;
      if (todayCount >= maxTradesDayLimit) {
        const msg = `🚫 Max trades per day reached: ${todayCount}/${maxTradesDayLimit}`;
        console.log(msg);
        await logEventSimple(strategyId, "CHECK", msg);
      } else {
        const activePosition = await checkActivePosition(strategyId, symbol);
        if (activePosition) {
          const msg = `ℹ️  Active position found: ${activePosition.side} at $${activePosition.entry_price.toFixed(2)}`;
          console.log(`\n${msg}`);
          console.log(`   Monitoring for exit (SL: $${activePosition.stop_loss || 'N/A'}, TP: $${activePosition.take_profit || 'N/A'})...`);

          await logEvent(strategyId, "position_active", {
            symbol,
            side: activePosition.side,
            entry_price: activePosition.entry_price,
            message: "Active position found, monitoring for exit."
          });

          // In a real bot, we'd check for exit here. For this engine, we skip new entries.
        } else {
          console.log("\n── Fetching market data from Binance ───────────────────\n");
          await logEventSimple(strategyId, "INFO", "Fetching market data...");
          const candles = await fetchCandles(symbol, timeframe, 500);
          const lastCandle = candles[candles.length - 1];
          const price = lastCandle.close;
          const open = lastCandle.open;
          console.log(`  Current price: $${price.toFixed(2)}`);

          // Prepare strategy data
          const strategyData = {};
          const logicType = strategyConfig.logic?.type || (strategyConfig.name?.includes("Breakout") || strategyConfig.strategy?.name?.includes("Breakout") ? "Breakout" : strategyConfig.name?.includes("Smart Money") || strategyConfig.strategy?.name?.includes("Smart Money") ? "SMC" : null);

          if (logicType && LogicExecutors[logicType]) {
            const data = LogicExecutors[logicType](candles, strategyConfig.logic || {});
            Object.assign(strategyData, data);

            if (logicType === 'Breakout' && strategyData.channel?.active) {
              console.log(`  Channel Active: Top $${strategyData.channel.top.toFixed(2)} | Bottom $${strategyData.channel.bottom.toFixed(2)}`);
            } else if (logicType === 'SMC') {
              console.log(`  Trend: ${strategyData.structure?.trend === 1 ? "BULLISH" : strategyData.structure?.trend === -1 ? "BEARISH" : "NEUTRAL"}`);
              console.log(`  OBs detected: ${strategyData.obs?.length || 0} | FVGs detected: ${strategyData.fvgs?.length || 0}`);
            }
          } else {
            console.log(`  Warning: No valid logic executor found for type ${logicType}`);
          }

          const { results, allPass } = await runSafetyCheck(price, open, strategyData, strategyConfig, strategyId, symbol);

          const riskDefaults = {
            riskPerTradePercent: 0.01,
            maxTradeSizeUSD: CONFIG.maxTradeSizeUSD,
            stopLossPercent: 0.02,
            takeProfitPercent: 0.05
          };
          const risk = { ...riskDefaults, ...strategyConfig.risk };

          const portfolioValue = strategyConfig.portfolioValue || CONFIG.portfolioValue;
          const tradeSize = Math.min(portfolioValue * risk.riskPerTradePercent, risk.maxTradeSizeUSD);

          console.log("\n── Decision ─────────────────────────────────────────────\n");

          if (!allPass) {
            const blockedMsg = `🚫 TRADE BLOCKED`;
            console.log(blockedMsg);
            results.filter(r => !r.pass).forEach(r => console.log(`   - ${r.label}`));
            await logEventSimple(strategyId, "CHECK", `${blockedMsg}: ${results.filter(r => !r.pass).map(r => r.label).join("; ")}`);
            await recordTrade(strategyId, {
              symbol,
              price,
              tradeSize,
              status: "BLOCKED",
              notes: `Failed: ${results.filter(r => !r.pass).map(r => r.label).join("; ")}`
            });
          } else {
            console.log(`✅ ALL CONDITIONS MET`);
            await logEventSimple(strategyId, "TRADE", "All safety conditions met. Preparing trade.");
            const isPaperBot = strategyConfig.paperTrading !== false;
            if (isPaperBot) {
              console.log(`\n📋 PAPER TRADE — would buy ${symbol} ~$${tradeSize.toFixed(2)} at market`);
              const orderId = `PAPER-${Date.now()}`;
              await recordTrade(strategyId, {
                symbol,
                price,
                tradeSize,
                status: "PAPER",
                notes: "All conditions met"
              });
              await updateActivePosition(strategyId, {
                action: "open",
                symbol,
                side: "BUY",
                price,
                sizeUSD: tradeSize,
                stopLoss: price * (1 - risk.stopLossPercent),
                takeProfit: price * (1 + risk.takeProfitPercent),
              });
            } else {
              console.log(`\n🔴 PLACING LIVE ORDER — $${tradeSize.toFixed(2)} BUY ${symbol}`);
              try {
                const tradeMode = strategyConfig.tradeMode || CONFIG.tradeMode;
                const order = await placeBitGetOrder(symbol, "buy", tradeSize, price, tradeMode);
                await recordTrade(strategyId, {
                  symbol,
                  price,
                  tradeSize,
                  status: "LIVE",
                  notes: "All conditions met"
                });
                await updateActivePosition(strategyId, {
                  action: "open",
                  symbol,
                  side: "BUY",
                  price,
                  sizeUSD: tradeSize,
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
                  tradeSize,
                  status: "FAILED",
                  notes: err.message
                });
              }
            }
          }
          console.log("═══════════════════════════════════════════════════════════\n");
        }
      }
    } catch (err) {
      console.error(`\n❌ CRITICAL ENGINE ERROR: ${err.message}`);
      await logEventSimple(strategyId, "ERROR", `Critical error: ${err.message}`);
    }

    // Sleep logic
    let sleepMs = 60000; // Default 1 min
    if (strategyConfig.intervalSeconds) {
      sleepMs = strategyConfig.intervalSeconds * 1000;
    } else {
      // Adaptive Mode: (timeframe_in_minutes * 60 * 1000) / 10
      const timeframeMap = { "1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30, "1H": 60, "4H": 240, "1D": 1440, "1W": 10080 };
      const minutes = timeframeMap[timeframe] || 60;
      sleepMs = (minutes * 60 * 1000) / 10;
    }

    // Minimum sleep of 10 seconds to prevent API spam
    sleepMs = Math.max(sleepMs, 10000);

    await logEventSimple(strategyId, "INFO", `Sleeping for ${Math.round(sleepMs/1000)}s...`);
    await new Promise(resolve => setTimeout(resolve, sleepMs));
  }
}

// Support for direct execution
if (process.argv[2]) {
  run(process.argv[2]).catch((err) => {
    console.error("Bot error:", err);
    process.exit(1);
  });
}

export { run, CONFIG };
