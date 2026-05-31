import { toolRegistry } from '../registry/ToolRegistry.js';

export default class RiskAgent {
  constructor(config = {}) {
    this.state = 'NORMAL'; // NORMAL, CAUTION, PANIC
    this.limits = {
      maxDrawdown: config.daily_loss_limit_percent || 0.10,
      cautionThreshold: config.caution_threshold || 0.05,
      maxPortfolioHeat: config.max_portfolio_heat_percent || 0.20,
      maxPositionSize: config.risk_per_trade_percent || 0.02,
    };

    this.capabilities = ['risk', 'portfolio', 'veto', 'exposure', 'drawdown'];
    this.monitoringInterval = null;
    this.portfolioSnapshot = {
      equity: 100000, // Mock initial equity
      peakEquity: 100000,
      currentDrawdown: 0,
      totalExposure: 0,
    };
  }

  /**
   * Starts the background monitoring loop.
   */
  startMonitoring(intervalMs = 60000) {
    console.log('RiskAgent: Starting portfolio monitoring loop...');
    this.monitoringInterval = setInterval(() => this._evaluateRisk(), intervalMs);
  }

  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }

  /**
   * Transition the agent to a new risk state.
   */
  async setState(newState) {
    if (this.state === newState) return;

    console.log(`RiskAgent: Transitioning state ${this.state} -> ${newState}`);
    this.state = newState;

    if (newState === 'PANIC') {
      console.error('RiskAgent: PANIC STATE REACHED. Emergency liquidation initiated.');
      try {
        await toolRegistry.executeTool('closeAllPositions');
      } catch (error) {
        console.error('RiskAgent: Failed to execute emergency closeAllPositions:', error);
      }
    }
  }

  /**
   * Internal loop to monitor equity and drawdown.
   */
  async _evaluateRisk() {
    try {
      // In a real scenario, this would call toolRegistry.executeTool('getPortfolioStatus')
      const status = await this._mockGetPortfolioStatus();
      this.portfolioSnapshot = status;

      const drawdown = (status.peakEquity - status.equity) / status.peakEquity;
      this.portfolioSnapshot.currentDrawdown = drawdown;

      console.log(`RiskAgent: Monitoring - Equity: ${status.equity}, Drawdown: ${(drawdown * 100).toFixed(2)}%`);

      if (drawdown >= this.limits.maxDrawdown) {
        await this.setState('PANIC');
      } else if (drawdown >= this.limits.cautionThreshold) {
        await this.setState('CAUTION');
      } else {
        await this.setState('NORMAL');
      }
    } catch (error) {
      console.error('RiskAgent: Error during risk evaluation:', error);
    }
  }

  /**
   * Processes tasks from the Orchestrator.
   * Handles trade vetoes and risk assessments.
   */
  async process(task) {
    const { type, payload } = task;

    if (type === 'TRADE_RECOMMENDATION') {
      return this._handleTradeVeto(payload);
    }

    if (type === 'RISK_ASSESSMENT') {
      return this._handleRiskAssessment();
    }

    return {
      decision: 'IGNORED',
      reasoning: 'Task type not recognized by RiskAgent',
      state: this.state
    };
  }

  /**
   * Veto system: Evaluates if a trade recommendation should be allowed.
   */
  _handleTradeVeto(trade) {
    const { symbol, size, side } = trade;
    const reasoning = [];
    let decision = 'APPROVED';

    // 1. State Check
    if (this.state === 'PANIC') {
      decision = 'VETOED';
       reasoning.push('Agent is in PANIC state. All trading is halted.');
    } else if (this.state === 'CAUTION') {
      const reducedLimit = this.limits.maxPositionSize * 0.5;
      if (size > reducedLimit) {
        decision = 'VETOED';
        reasoning.push(`Agent is in CAUTION state. Position size ${size} exceeds reduced limit ${reducedLimit}.`);
      } else {
        reasoning.push('Agent is in CAUTION state. Reduced limits applied.');
      }
    }

    // 2. Portfolio Heat Check
    if (this.portfolioSnapshot.totalExposure > this.limits.maxPortfolioHeat) {
      decision = 'VETOED';
      reasoning.push(`Portfolio Heat too high: ${this.portfolioSnapshot.totalExposure} exceeds limit ${this.limits.maxPortfolioHeat}.`);
    }

    // 3. Individual Position Size Check
    if (size > this.limits.maxPositionSize) {
      decision = 'VETOED';
      reasoning.push(`Position size ${size} exceeds hard limit ${this.limits.maxPositionSize}.`);
    }

    return {
      decision,
      reasoning: reasoning.join(' '),
      symbol,
      state: this.state,
      timestamp: new Date().toISOString(),
      trace: `RiskAgent evaluation for ${symbol}: ${decision} - ${reasoning.join(' ')}`
    };
  }

  _handleRiskAssessment() {
    return {
      state: this.state,
      currentDrawdown: this.portfolioSnapshot.currentDrawdown,
      portfolioHeat: this.portfolioSnapshot.totalExposure,
      assessment: this.state === 'NORMAL' ? 'Portfolio is healthy' :
                  this.state === 'CAUTION' ? 'Portfolio is under stress' :
                  'CRITICAL: Portfolio in panic mode',
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Mocks portfolio data for demonstration.
   */
  async _mockGetPortfolioStatus() {
    // Simulate some random equity fluctuation
    const drift = (Math.random() - 0.5) * 1000;
    const newEquity = this.portfolioSnapshot.equity + drift;

    return {
      equity: newEquity,
      peakEquity: Math.max(this.portfolioSnapshot.peakEquity, newEquity),
      totalExposure: this.portfolioSnapshot.totalExposure + (Math.random() - 0.5) * 0.01,
    };
  }
}
