import { getDB } from '../../db.js';
import { BitGetService } from '../services/exchange/bitget.js';
import { IndicatorManager } from '../indicators/index.js';
import { PrecisionManager } from '../utils/precision.js';

export class ToolRegistry {
    constructor() {
        this.bitgetService = new BitGetService(process.env.BITGET_CONFIG || {});
        this.indicatorManager = new IndicatorManager({});
        this.precision = new PrecisionManager();
    }

    async executeTool(toolName, args) {
        console.log(`[ToolRegistry] Executing ${toolName} with args:`, args);

        try {
            switch (toolName) {
                case 'get_candles':
                    return await this.get_candles(args);
                case 'get_indicator':
                    return await this.get_indicator(args);
                case 'get_portfolio_status':
                    return await this.get_portfolio_status(args);
                case 'get_trade_history':
                    return await this.get_trade_history(args);
                case 'place_order':
                    return {
                        success: false,
                        error: 'Use TradeExecutor for order placement to ensure RiskGuard validation.'
                    };
                default:
                    throw new Error(`Tool ${toolName} not found in registry.`);
            }
        } catch (e) {
            return this._response(false, null, e);
        }
    }

    _response(success, data, error = null) {
        return {
            success,
            data,
            error: error ? String(error) : null,
            timestamp: new Date().toISOString()
        };
    }

    async get_candles({ symbol, interval, limit = 100 }) {
        const intervalMap = {
            "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m",
            "30m": "30m", "1H": "1h", "4H": "4h", "1D": "1d", "1W": "1w",
        };
        const binanceInterval = intervalMap[interval] || "1m";
        const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${binanceInterval}&limit=${limit}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Binance API error: ${res.status}`);
        const data = await res.json();
        return this._response(true, data.map(k => ({
            time: k[0], open: parseFloat(k[1]), high: parseFloat(k[2]),
            low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5])
        })));
    }

    async get_indicator({ symbol, indicatorType, timeframe = "1H" }) {
        const candles = await this.get_candles({ symbol, interval: timeframe, limit: 500 });
        if (!candles.success) throw new Error(candles.error);
        const result = this.indicatorManager.calculate(indicatorType, candles.data);
        return this._response(true, { symbol, indicatorType, result });
    }

    async get_portfolio_status({ strategyId }) {
        const db = getDB();
        const positions = await db.all(
            "SELECT * FROM active_positions WHERE strategy_id = ? AND status = 'OPEN'",
            [strategyId]
        );
        return this._response(true, { activePositions: positions, balance: 10000 });
    }

    async get_trade_history({ strategyId, limit = 50 }) {
        const db = getDB();
        const trades = await db.all(
            "SELECT * FROM trades WHERE strategy_id = ? ORDER BY timestamp DESC LIMIT ?",
            [strategyId, limit]
        );
        return this._response(true, { trades });
    }

    getToolsDefinition() {
        return [
            {
                name: "get_candles",
                description: "Fetch historical candle data for a symbol",
                parameters: {
                    type: "object",
                    properties: {
                        symbol: { type: "string" },
                        interval: { type: "string" },
                        limit: { type: "number" }
                    },
                    required: ["symbol", "interval"]
                }
            },
            {
                name: "get_indicator",
                description: "Get technical indicator values",
                parameters: {
                    type: "object",
                    properties: {
                        symbol: { type: "string" },
                        indicatorType: { type: "string" },
                        timeframe: { type: "string" }
                    },
                    required: ["symbol", "indicatorType"]
                }
            }
        ];
    }
}

export const toolRegistry = new ToolRegistry();
