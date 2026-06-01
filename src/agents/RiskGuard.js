export class RiskGuard {
    constructor() {
        this.limits = {
            maxRiskPerTrade: 0.02, // 2%
            maxOpenPositions: 5,
            safeList: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'],
            dailyLossLimit: 0.05 // 5%
        };
    }

    async validate(order, portfolio) {
        const { symbol, size_usd } = order;

        if (!this.limits.safeList.includes(symbol)) {
            throw new Error(`RiskGuard: Symbol ${symbol} is not in the SafeList.`);
        }

        if (portfolio.positions.length >= this.limits.maxOpenPositions) {
            throw new Error(`RiskGuard: Max open positions (${this.limits.maxOpenPositions}) reached.`);
        }

        const riskPercent = size_usd / portfolio.balance;
        if (riskPercent > this.limits.maxRiskPerTrade) {
            throw new Error(`RiskGuard: Trade size $${size_usd} exceeds max risk limit (${this.limits.maxRiskPerTrade * 100}%).`);
        }

        return { approved: true };
    }
}

export const riskGuard = new RiskGuard();
