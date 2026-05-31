import { AnalystAgent } from './AnalystAgent.js';
import RiskAgent from './RiskAgent.js';
import { agentMemory } from './AgentMemory.js';
import { toolRegistry } from '../registry/ToolRegistry.js';
import { tradeExecutor } from './TradeExecutor.js';

/**
 * AgentOrchestrator manages the high-level adversarial loop between agents.
 * It coordinates the flow: Analyst (Proposal) -> Risk (Review) -> Execution.
 */
export default class AgentOrchestrator {
  constructor(io, config = {}) {
    this.io = io;
    this.config = config;
    this.memory = agentMemory;
    this.analyst = new AnalystAgent(this);
    this.risk = new RiskAgent(config);
    this.toolRegistry = toolRegistry;
    this.tradeExecutor = tradeExecutor;

    this.isRunning = false;
    this.loopInterval = null;
    this.symbolsToWatch = config.symbols || ['BTCUSDT', 'ETHUSDT'];
  }

  /**
   * Broadcasts an agent's thought to the frontend.
   */
  broadcastThought(payload) {
    console.log(`[Agent-Thought] ${payload.thought}`);
    this.io.emit('agent:thought', payload);
  }

  /**
   * Broadcasts a final decision to the frontend.
   */
  broadcastDecision(payload) {
    console.log(`[Agent-Decision] ${payload.decision} - ${payload.reasoning}`);
    this.io.emit('agent:decision', payload);
  }

  /**
   * Main Adversarial Loop: Analyst -> Risk -> Execution.
   */
  async runCycle() {
    if (!this.isRunning) return;

    for (const symbol of this.symbolsToWatch) {
      try {
        console.log(`\n--- Starting Agentic Cycle for ${symbol} ---`);

        // 1. Analyst proposes a trade
        const proposal = await this.analyst.process({ symbol });

        // Log Analyst episode to memory
        await this.memory.saveEpisode({
          agent_id: 'AnalystAgent',
          input: { symbol },
          reasoning: proposal.reasoning,
          action: 'PROPOSE_TRADE',
          observation: 'Market analysis complete',
          result: JSON.stringify(proposal)
        });

        // 2. RiskAgent reviews the proposal
        const riskReview = await this.risk.process({
          type: 'TRADE_RECOMMENDATION',
          payload: {
            symbol: proposal.symbol,
            size: (this.config.portfolioValue || 10000) * (this.config.risk_per_trade_percent || 0.01),
            side: proposal.signal,
            price: await this._getCurrentPrice(symbol)
          }
        });

        // Log Risk episode
        await this.memory.saveEpisode({
          agent_id: 'RiskAgent',
          input: proposal,
          reasoning: riskReview.reasoning,
          action: 'VETO_CHECK',
          observation: 'Risk limits evaluated',
          result: riskReview.decision
        });

        if (riskReview.decision === 'APPROVED') {
          const tradeParams = {
            symbol: proposal.symbol,
            side: proposal.signal.toLowerCase(),
            sizeUSD: (this.config.portfolioValue || 10000) * (this.config.risk_per_trade_percent || 0.01),
            price: await this._getCurrentPrice(symbol),
            stop_loss: proposal.stop_loss,
            take_profit: proposal.take_profit
          };

          this.broadcastDecision({
            symbol,
            decision: 'EXECUTE',
            reasoning: `Analyst proposed ${proposal.signal}, RiskAgent approved: ${riskReview.reasoning}`,
            details: tradeParams
          });

          // 3. Execute the trade
          const executionResult = await this.tradeExecutor.executeTrade(tradeParams);

          this.broadcastThought({
            agent: 'orchestrator',
            thought: `Trade Executed: ${executionResult.status === 'SUCCESS' ? 'Success' : 'Failed'}`
          });
        } else {
          this.broadcastDecision({
            symbol,
            decision: 'VETOED',
            reasoning: `Analyst proposed ${proposal.signal}, but RiskAgent vetoed: ${riskReview.reasoning}`
          });
        }

      } catch (error) {
        console.error(`Error in cycle for ${symbol}:`, error);
      }
    }
  }

  async _getCurrentPrice(symbol) {
    const res = await this.toolRegistry.executeTool('get_candles', { symbol, timeframe: '1m', limit: 1 });
    if (res.success && res.data.length > 0) {
      return res.data[0].close;
    }
    return 0;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('AgentOrchestrator: Starting adversarial loop...');
    this.loopInterval = setInterval(() => this.runCycle(), this.config.cycleInterval || 300000);
    this.runCycle();
  }

  stop() {
    this.isRunning = false;
    if (this.loopInterval) {
      clearInterval(this.loopInterval);
      this.loopInterval = null;
    }
    console.log('AgentOrchestrator: Stopped.');
  }
}
