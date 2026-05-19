/**
 * Claude + TradingView MCP — Automated Trading Bot
 * Modified for Smart Money Breakout Channels Strategy
 */

import "dotenv/config";
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "fs";
import crypto from "crypto";
import { execSync } from "child_process";

// ─── Onboarding ───────────────────────────────────────────────────────────────

function checkOnboarding() {
  const required = ["BITGET_API_KEY", "BITGET_SECRET_KEY", "BITGET_PASSPHRASE"];
  const missing = required.filter((k) => !process.env[k]);

  if (!existsSync(".env")) {
    console.log("\n⚠️  No .env file found — opening it for you to fill in...\n");
    writeFileSync(
      ".env",
      [
        "# BitGet credentials",
        "BITGET_API_KEY=",
        "BITGET_SECRET_KEY=",
        "BITGET_PASSPHRASE=",
        "",
        "# Trading config",
        "MAX_TRADE_SIZE_USD=100",
        "MAX_TRADES_PER_DAY=3",
        "PAPER_TRADING=true",
        "SYMBOL=BTCUSDT",
        "TIMEFRAME=4H",
      ].join("\n") + "\n",
    );
    try { execSync("open .env"); } catch {}
    process.exit(0);
  }

  if (missing.length > 0) {
    console.log(`\n⚠️  Missing credentials in .env: ${missing.join(", ")}`);
    try { execSync("open .env"); } catch {}
    process.exit(0);
  }

  const csvPath = new URL("trades.csv", import.meta.url).pathname;
  console.log(`\n📄 Trade log: ${csvPath}`);
}

// ─── Config ────────────────────────────────────────────────────────────────

const CONFIG = {
  symbol: process.env.SYMBOL || "BTCUSDT",
  timeframe: process.env.TIMEFRAME || "4H",
  maxTradeSizeUSD: parseFloat(process.env.MAX_TRADE_SIZE_USD || "100"),
  maxTradesPerDay: parseInt(process.env.MAX_TRADES_PER_DAY || "3"),
  paperTrading: process.env.PAPER_TRADING !== "false",
  tradeMode: process.env.TRADE_MODE || "spot",
  bitget: {
    apiKey: process.env.BITGET_API_KEY,
    secretKey: process.env.BITGET_SECRET_KEY,
    passphrase: process.env.BITGET_PASSPHRASE,
    baseUrl: process.env.BITGET_BASE_URL || "https://api.bitget.com",
  },
};

const LOG_FILE = "safety-check-log.json";

// ─── Logging ────────────────────────────────────────────────────────────────

function loadLog() {
  if (!existsSync(LOG_FILE)) return { trades: [] };
  return JSON.parse(readFileSync(LOG_FILE, "utf8"));
}

function saveLog(log) {
  writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
}

function countTodaysTrades(log) {
  const today = new Date().toISOString().slice(0, 10);
  return log.trades.filter((t) => t.timestamp.startsWith(today) && t.orderPlaced).length;
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

// ─── Indicator Calculations (Smart Money Breakout) ──────────────────────────────

function calcStdDev(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
  return Math.sqrt(variance);
}

function calcSmartMoneyChannels(candles, length_ = 100, length = 14) {
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
    else volArray.push(calcStdDev(normalizedPrices.slice(i - 13, i + 1), 14));
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
}

// ─── Safety Check ───────────────────────────────────────────────────────────────

function runSafetyCheck(price, open, channel, rules) {
  const results = [];
  const bodyMidpoint = (open + price) / 2;

  const check = (label, required, actual, pass) => {
    results.push({ label, required, actual, pass });
    const icon = pass ? "✅" : "🚫";
    console.log(`  ${icon} ${label}`);
    console.log(`     Required: ${required} | Actual: ${actual}`);
  };

  console.log("\n── Safety Check ─────────────────────────────────────────\n");

  if (!channel.active) {
    console.log("  Bias: NEUTRAL — No consolidation channel detected. No trade.\n");
    results.push({ label: "Channel Active", required: "True", actual: "False", pass: false });
    return { results, allPass: false };
  }

  const bullishBreakout = bodyMidpoint > channel.top;
  const bearishBreakout = bodyMidpoint < channel.bottom;

  if (bullishBreakout) {
    console.log("  Bias: BULLISH — checking long entry conditions\n");
    check("Strong Close above Channel Top", `> ${channel.top.toFixed(2)}`, `Midpoint: ${bodyMidpoint.toFixed(2)}`, true);
  } else if (bearishBreakout) {
    console.log("  Bias: BEARISH — checking short entry conditions\n");
    check("Strong Close below Channel Bottom", `< ${channel.bottom.toFixed(2)}`, `Midpoint: ${bodyMidpoint.toFixed(2)}`, true);
  } else {
    console.log("  Bias: NEUTRAL — Price is inside the channel. No trade.\n");
    results.push({ label: "Breakout", required: "Price outside channel", actual: "Inside channel", pass: false });
  }

  const allPass = results.length > 0 && results.every((r) => r.pass);
  return { results, allPass };
}

// ─── Trade Limits ────────────────────────────────────────────────────────────

function checkTradeLimits(log) {
  const todayCount = countTodaysTrades(log);
  console.log("\n── Trade Limits ─────────────────────────────────────────\n");
  if (todayCount >= CONFIG.maxTradesPerDay) {
    console.log(`🚫 Max trades per day reached: ${todayCount}/${CONFIG.maxTradesPerDay}`);
    return false;
  }
  console.log(`✅ Trades today: ${todayCount}/${CONFIG.maxTradesPerDay} — within limit`);
  return true;
}

// ─── BitGet Execution ────────────────────────────────────────────────────────

function signBitGet(timestamp, method, path, body = "") {
  const message = `${timestamp}${method}${path}${body}`;
  return crypto.createHmac("sha256", CONFIG.bitget.secretKey).update(message).digest("base64");
}

async function placeBitGetOrder(symbol, side, sizeUSD, price) {
  const quantity = (sizeUSD / price).toFixed(6);
  const timestamp = Date.now().toString();
  const path = CONFIG.tradeMode === "spot" ? "/api/v2/spot/trade/placeOrder" : "/api/v2/mix/order/placeOrder";
  const body = JSON.stringify({
    symbol, side, orderType: "market", quantity,
    ...(CONFIG.tradeMode === "futures" && { productType: "USDT-FUTURES", marginMode: "isolated", marginCoin: "USDT" }),
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

// ─── Tax CSV Logging ─────────────────────────────────────────────────────────

const CSV_FILE = "trades.csv";
const CSV_HEADERS = ["Date","Time (UTC)","Exchange","Symbol","Side","Quantity","Price","Total USD","Fee (est.)","Net Amount","Order ID","Mode","Notes"].join(",");

function initCsv() {
  if (!existsSync(CSV_FILE)) {
    writeFileSync(CSV_FILE, CSV_HEADERS + "\n");
  }
}

function writeTradeCsv(logEntry) {
  const now = new Date(logEntry.timestamp);
  const date = now.toISOString().slice(0, 10);
  const time = now.toISOString().slice(11, 19);
  let side = "BUY", quantity = "", totalUSD = "", fee = "", netAmount = "", orderId = "", mode = "", notes = "";

  if (!logEntry.allPass) {
    const failed = logEntry.conditions.filter((c) => !c.pass).map((c) => c.label).join("; ");
    mode = "BLOCKED"; orderId = "BLOCKED"; notes = `Failed: ${failed}`;
  } else if (logEntry.paperTrading) {
    quantity = (logEntry.tradeSize / logEntry.price).toFixed(6);
    totalUSD = logEntry.tradeSize.toFixed(2);
    fee = (logEntry.tradeSize * 0.001).toFixed(4);
    netAmount = (logEntry.tradeSize - parseFloat(fee)).toFixed(2);
    orderId = logEntry.orderId || ""; mode = "PAPER"; notes = "All conditions met";
  } else {
    quantity = (logEntry.tradeSize / logEntry.price).toFixed(6);
    totalUSD = logEntry.tradeSize.toFixed(2);
    fee = (logEntry.tradeSize * 0.001).toFixed(4);
    netAmount = (logEntry.tradeSize - parseFloat(fee)).toFixed(2);
    orderId = logEntry.orderId || ""; mode = "LIVE"; notes = logEntry.error ? `Error: ${logEntry.error}` : "All conditions met";
  }

  const row = [date, time, "BitGet", logEntry.symbol, side, quantity, logEntry.price.toFixed(2), totalUSD, fee, netAmount, orderId, mode, `"${notes}"`].join(",");
  appendFileSync(CSV_FILE, row + "\n");
}

function generateTaxSummary() {
  if (!existsSync(CSV_FILE)) return console.log("No trades.csv found.");
  const lines = readFileSync(CSV_FILE, "utf8").trim().split("\n");
  const rows = lines.slice(1).map((l) => l.split(","));
  const live = rows.filter((r) => r[11] === "LIVE");
  const totalVolume = live.reduce((sum, r) => sum + parseFloat(r[7] || 0), 0);
  console.log(`\n── Tax Summary ──\nTotal Live Volume: $${totalVolume.toFixed(2)}\n`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function run() {
  checkOnboarding();
  initCsv();
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Claude Trading Bot");
  console.log(`  ${new Date().toISOString()}`);
  console.log(`  Mode: ${CONFIG.paperTrading ? "📋 PAPER TRADING" : "🔴 LIVE TRADING"}`);
  console.log("═══════════════════════════════════════════════════════════");

  const rules = JSON.parse(readFileSync("rules.json", "utf8"));
  console.log(`\nStrategy: ${rules.strategy.name}`);
  console.log(`Symbol: ${CONFIG.symbol} | Timeframe: ${CONFIG.timeframe}`);

  const log = loadLog();
  if (!checkTradeLimits(log)) return;

  console.log("\n── Fetching market data from Binance ───────────────────\n");
  const candles = await fetchCandles(CONFIG.symbol, CONFIG.timeframe, 500);
  const lastCandle = candles[candles.length - 1];
  const price = lastCandle.close;
  const open = lastCandle.open;
  console.log(`  Current price: $${price.toFixed(2)}`);

  const channel = calcSmartMoneyChannels(candles);
  if (channel.active) {
    console.log(`  Channel Active: Top $${channel.top.toFixed(2)} | Bottom $${channel.bottom.toFixed(2)}`);
  } else {
    console.log(`  Channel: Not detected (price not in consolidation)`);
  }

  const { results, allPass } = runSafetyCheck(price, open, channel, rules);
  // Trade size is now handled by bot_engine.js via strategy configuration
  const tradeSize = 0; // Placeholder for logEntry, bot_engine handles actual size

  console.log("\n── Decision ─────────────────────────────────────────────\n");
  const logEntry = {
    timestamp: new Date().toISOString(),
    symbol: CONFIG.symbol,
    timeframe: CONFIG.timeframe,
    price,
    conditions: results,
    allPass,
    tradeSize,
    orderPlaced: false,
    orderId: null,
    paperTrading: CONFIG.paperTrading,
  };

  if (!allPass) {
    console.log(`🚫 TRADE BLOCKED`);
    results.filter(r => !r.pass).forEach(r => console.log(`   - ${r.label}`));
  } else {
    console.log(`✅ ALL CONDITIONS MET`);
    if (CONFIG.paperTrading) {
      console.log(`\n📋 PAPER TRADE — would buy ${CONFIG.symbol} ~$${tradeSize.toFixed(2)} at market`);
      logEntry.orderPlaced = true;
      logEntry.orderId = `PAPER-${Date.now()}`;
    } else {
      console.log(`\n🔴 PLACING LIVE ORDER — $${tradeSize.toFixed(2)} BUY ${CONFIG.symbol}`);
      try {
        const order = await placeBitGetOrder(CONFIG.symbol, "buy", tradeSize, price);
        logEntry.orderPlaced = true;
        logEntry.orderId = order.orderId;
        console.log(`✅ ORDER PLACED — ${order.orderId}`);
      } catch (err) {
        console.log(`❌ ORDER FAILED — ${err.message}`);
        logEntry.error = err.message;
      }
    }
  }

  log.trades.push(logEntry);
  saveLog(log);
  writeTradeCsv(logEntry);
  console.log("═══════════════════════════════════════════════════════════\n");
}

if (process.argv.includes("--tax-summary")) {
  generateTaxSummary();
} else {
  run().catch((err) => {
    console.error("Bot error:", err);
    process.exit(1);
  });
}
