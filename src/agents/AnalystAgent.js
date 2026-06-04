import { getDB } from '../../db.js';
import { ToolRegistry } from '../registry/ToolRegistry.js';
import { deriveAgentProposal } from './deriveAgentProposal.js';

const INDICATOR_DESCRIPTIONS = {
    SMC: 'Smart Money Concepts — institutional order flow, BOS/CHoCH structure shifts.',
    Breakout: 'Breakout Channels — price escaping a consolidation range.',
    OrderBlocks: 'Order Blocks — last opposing candle before an impulsive move.',
    FVG: 'Fair Value Gap — price imbalance / inefficiency to be filled.',
};

/**
 * AnalystAgent uses a 'Council of Experts' pattern to provide deep market analysis.
 * It employs a Reflection Loop (Thought -> Action -> Observation -> Reflection)
 * to refine its hypotheses before reaching a final decision.
 */
export class AnalystAgent {
    constructor(orchestrator) {
        this.orchestrator = orchestrator;
        this.tools = new ToolRegistry();
        this.indicators = (orchestrator?.llmContext?.indicators) || (orchestrator?.config?.indicators) || ['SMC'];
        this.capabilities = ['analysis', 'market-research', 'strategy-optimization'];
        this.experts = {
            macro: { weight: 0.3, name: 'Macro Analyst' },
            quant: { weight: 0.4, name: 'Quant Analyst' },
            orderFlow: { weight: 0.3, name: 'Order Flow Specialist' }
        };
        this.baselineSettings = {};
    }

    /**
     * Seeds the agent's baseline settings from the top-performing strategies in the DB.
     */
    async seedFromBestStrategies() {
        try {
            const db = getDB();
            // Query the strategy_stats view for top strategies by profit factor and win rate
            const topStrategies = await db.all(
                `SELECT strategy_id, netPnL, winRate, profitFactor
                 FROM strategy_stats
                 ORDER BY profitFactor DESC, winRate DESC
                 LIMIT 5`
            );

            if (topStrategies.length === 0) {
                this.emitThought("No historical strategy data found to seed from. Using default weights.");
                return;
            }

            // Extract logic_config from the best strategy to use as a baseline
            const bestStrategyId = topStrategies[0].strategy_id;
            const strategy = await db.get("SELECT logic_config FROM strategies WHERE id = ?", [bestStrategyId]);

            if (strategy && strategy.logic_config) {
                this.baselineSettings = JSON.parse(strategy.logic_config);
                this.emitThought(`Seeded baseline from top strategy ID ${bestStrategyId} (Profit Factor: ${topStrategies[0].profitFactor.toFixed(2)})`);
            }
        } catch (error) {
            console.error(`[AnalystAgent] Error seeding from best strategies:`, error);
            this.emitThought("Failed to seed from DB. Proceeding with default settings.");
        }
    }

    /**
     * Emits a thought to the orchestrator for UI feedback.
     */
    emitThought(thought, metadata = {}) {
        const thoughtPayload = {
            timestamp: new Date().toISOString(),
            thought,
            ...metadata
        };

        // Assuming Orchestrator has a method to broadcast events or we log it
        if (this.orchestrator && typeof this.orchestrator.broadcastThought === 'function') {
            this.orchestrator.broadcastThought(thoughtPayload);
        } else {
            console.log(`[AnalystAgent-Thought] ${thought}`);
        }
    }

    /**
     * The main processing loop implementing the Reflection Loop:
     * Thought -> Action -> Observation -> Reflection -> Final Decision.
     */
    async process(task) {
        const { symbol, timeframe = "1H" } = task;
        if (!symbol) throw new Error("Symbol is required for analysis.");

        // Phase 6b: when USE_SIGNAL_CORE is ON, derive the proposal from the shared
        // pure core instead of the simulated reflection loop. OFF (default) is unchanged.
        // `??` (not `||`) so an explicit `false` in per-agent config survives.
        const cfg = this.orchestrator?.config || {};
        const useSignalCore = cfg.useSignalCore ?? (process.env.USE_SIGNAL_CORE === "true");
        if (useSignalCore) {
            return this._coreProposal(symbol, timeframe);
        }

        this.emitThought(`Starting analysis for ${symbol}...`);

        let confidence = 0;
        let iterations = 0;
        const maxIterations = 3;
        let currentHypothesis = "Market is neutral.";
        let evidence = [];

        while (iterations < maxIterations && confidence < 0.8) {
            iterations++;
            this.emitThought(`Iteration ${iterations}: Current Hypothesis: ${currentHypothesis}`);

            // 1. THOUGHT: Formulate a request for the Council of Experts
            const expertAnalysis = await this._consultCouncil(symbol, timeframe, currentHypothesis);

            // 2. ACTION: Execute tools based on expert suggestions
            const observations = await this._gatherEvidence(symbol, timeframe, expertAnalysis);

            // 3. OBSERVATION: Combine tool outputs into a coherent state
            const state = this._synthesizeObservations(observations);

            // 4. REFLECTION: Compare observation with hypothesis
            const reflection = this._reflect(currentHypothesis, state, expertAnalysis);

            evidence.push({ iteration: iterations, reflection, state });

            if (reflection.confirmed) {
                confidence += 0.3;
                this.emitThought(`Hypothesis confirmed by ${reflection.source}. Confidence increasing.`);
            } else {
                confidence -= 0.1;
                currentHypothesis = reflection.newHypothesis;
                this.emitThought(`Hypothesis refuted. Pivoting to: ${currentHypothesis}`);
            }
        }

        // 5. FINAL DECISION: Synthesize all iterations into a final signal
        return this._finalizeDecision(symbol, evidence);
    }

    /**
     * Phase 6b ON path: derive the proposal from the shared pure core on real candles.
     * The shell (this method) does the I/O (candle fetch); deriveAgentProposal is pure.
     * HOLD / unsupported / empty-data all yield a HOLD proposal, which RiskPolicy then
     * DENYs (no trade) — the live loop never crashes.
     */
    async _coreProposal(symbol, timeframe) {
        this.emitThought(`Analyzing ${symbol} via signal core...`);
        const res = await this.tools.get_candles({ symbol, interval: timeframe, limit: 200 });
        if (!res?.success || !Array.isArray(res.data) || res.data.length === 0) {
            const reason = `No candle data for ${symbol}; holding.`;
            this.emitThought(reason);
            return { side: 'HOLD', conviction: 0, rationale: reason, invalidationIdea: null };
        }
        const candles = res.data;
        const price = candles[candles.length - 1].close;
        const proposal = deriveAgentProposal({ indicators: this.indicators, logicConfig: {}, candles, price });
        this.emitThought(`Core proposal: ${proposal.side} for ${symbol} (conviction ${proposal.conviction.toFixed(2)})`);
        return proposal;
    }

    async _consultCouncil(symbol, timeframe, hypothesis) {
        this.emitThought("Consulting Council of Experts (Macro, Quant, Order Flow)...");

        const indicatorContext = this.indicators
            .map(i => `${i}: ${INDICATOR_DESCRIPTIONS[i] || 'custom indicator'}`).join('; ');

        // In a real LLM-driven agent, these would be separate prompts.
        // Here we simulate the specialized reasoning of the experts.
        return {
            macro: {
                focus: "Higher timeframe trends and economic bias",
                suggestion: `Check 1D and 4H candles for ${symbol} to verify trend alignment with ${hypothesis}.`
            },
            quant: {
                focus: "Statistical indicators and volatility",
                suggestion: `Get indicators [${this.indicators.join(', ')}] for ${symbol} on ${timeframe}. Context: ${indicatorContext}`
            },
            orderFlow: {
                focus: "Volume and execution patterns",
                suggestion: `Analyze recent volume and order flow for ${symbol}.`
            }
        };
    }

    async _gatherEvidence(symbol, timeframe, expertAnalysis) {
        const observations = [];

        // Action based on Quant Expert — loop over configured indicators
        for (const indicatorType of this.indicators) {
            const indicator = await this.tools.get_indicator({ symbol, indicatorType, timeframe });
            observations.push({ source: 'quant', data: indicator });
        }

        // Action based on Macro Expert
        const macroCandles = await this.tools.get_candles({
            symbol,
            interval: "1D",
            limit: 20
        });
        observations.push({ source: 'macro', data: macroCandles });

        return observations;
    }

    _synthesizeObservations(observations) {
        return observations.map(obs => ({
            source: obs.source,
            success: obs.data.success,
            value: obs.data.data
        }));
    }

    _reflect(hypothesis, state, expertAnalysis) {
        // Simplified reflection logic simulating Agentic Engineering (Hypothesis -> Evidence -> Correction)
        const quantObs = state.filter(s => s.source === 'quant');
        const quantResults = quantObs.map(q => Number(q.value?.result) || 0);
        const quantScore = quantResults.length ? quantResults.reduce((a, b) => a + b, 0) / quantResults.length : 0;
        const quantSuccess = quantObs.length > 0 && quantObs.every(q => q.success);
        const macroData = state.find(s => s.source === 'macro');

        let confirmed = false;
        let newHypothesis = hypothesis;

        if (quantSuccess && macroData?.success) {
            // Simulate a simple check: if indicators are positive and trend is up, confirm bullish hypothesis
            if (hypothesis.includes("bullish") && quantScore > 0) {
                confirmed = true;
            } else if (hypothesis.includes("bearish") && quantScore < 0) {
                confirmed = true;
            } else {
                newHypothesis = quantScore > 0 ? "Market is turning bullish." : "Market is turning bearish.";
            }
        }

        return {
            confirmed,
            source: confirmed ? "Quant/Macro Consensus" : "Data Discrepancy",
            newHypothesis
        };
    }

    _finalizeDecision(symbol, evidence) {
        const finalIteration = evidence[evidence.length - 1];
        const fq = (finalIteration?.state || []).filter(s => s.source === 'quant');
        const fScore = fq.length ? fq.map(q => Number(q.value?.result) || 0).reduce((a, b) => a + b, 0) / fq.length : 0;

        const side = fScore > 0 ? 'BUY' : fScore < 0 ? 'SELL' : 'HOLD';
        const conviction = Math.min(0.95, 0.5 + (evidence.length * 0.1));
        const rationale = evidence.map(e => e.reflection.newHypothesis).join(' -> ');

        // QualitativeProposal contract — NO money numbers. (Future LLM returns this exact shape.)
        const proposal = {
            side,
            conviction,
            rationale,
            invalidationIdea: side === 'HOLD' ? null : `Invalidate if structure flips against ${side}.`,
        };

        this.emitThought(`Final Proposal: ${side} for ${symbol} (conviction ${conviction.toFixed(2)})`);
        return proposal;
    }
}
