# Graph Report - .  (2026-05-17)

## Corpus Check
- Corpus is ~30,715 words - fits in a single context window. You may not need a graph.

## Summary
- 421 nodes · 480 edges · 33 communities (29 shown, 4 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 9 edges (avg confidence: 0.88)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 32|Community 32]]

## God Nodes (most connected - your core abstractions)
1. `dependencies` - 20 edges
2. `devDependencies` - 20 edges
3. `compilerOptions` - 18 edges
4. `compilerOptions` - 17 edges
5. `getDB()` - 13 edges
6. `run()` - 11 edges
7. `run()` - 11 edges
8. `Claude TradingView MCP Trading` - 9 edges
9. `dependencies` - 8 edges
10. `scripts` - 8 edges

## Surprising Connections (you probably didn't know these)
- `testDB()` --calls--> `initDB()`  [EXTRACTED]
  test-db.js → db.js
- `stopBot()` --calls--> `getDB()`  [EXTRACTED]
  server.js → db.js
- `Trading Lab Frontend` --implements--> `Trading Lab Dashboard UI`  [INFERRED]
  frontend/README.md → docs/superpowers/specs/2026-05-16-trading-lab-dashboard-design.md
- `Extract Strategy Prompt` --conceptually_related_to--> `Smart Money Breakout Channels Strategy`  [INFERRED]
  prompts/01-extract-strategy.md → strategy/Smart money Breakout Channels.txt
- `Extract Strategy Prompt` --conceptually_related_to--> `Smart Money Concepts Strategy`  [INFERRED]
  prompts/01-extract-strategy.md → strategy/Smart money Concepts pinechart.txt

## Hyperedges (group relationships)
- **Dashboard Design Core** — trading_lab_dashboard_ui, strategy_performance_metrics, real_time_position_monitoring [EXTRACTED 1.00]
- **Core Trading Pipeline** — config_rules_json, code_bot_engine_js, exchange_bitget, data_trades_csv [INFERRED 0.95]
- **Dashboard Monitoring Stack** — code_server_js, code_db_js, frontend_dashboard, data_trading_lab_db [INFERRED 0.95]

## Communities (33 total, 4 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (48): author, dependencies, autoprefixer, axios, clsx, lucide-react, postcss, react (+40 more)

### Community 1 - "Community 1"
Cohesion: 0.08
Nodes (40): checkActivePosition(), CONFIG, countTodaysTrades(), CSV_HEADERS, fetchCandles(), Indicators, logEvent(), LogicExecutors (+32 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (31): author, bugs, url, dependencies, cors, dotenv, express, node-fetch (+23 more)

### Community 3 - "Community 3"
Cohesion: 0.16
Nodes (17): LiveMonitor(), StrategyHub(), useSocket(), api, Strategy, strategyApi, Template, TemplatesResponse (+9 more)

### Community 4 - "Community 4"
Cohesion: 0.08
Nodes (25): bias_criteria, bearish, bullish, default_timeframe, entry_rules, long, short, exit_rules (+17 more)

### Community 5 - "Community 5"
Cohesion: 0.08
Nodes (24): length_, logic, id, indicators, name, safety_checks, type, maxTradeSizeUSD (+16 more)

### Community 6 - "Community 6"
Cohesion: 0.08
Nodes (24): length_, logic, id, indicators, name, safety_checks, type, maxTradeSizeUSD (+16 more)

### Community 7 - "Community 7"
Cohesion: 0.09
Nodes (20): default_timeframe, description, entry_rules, long, short, exit_rules, indicators, fvg (+12 more)

### Community 8 - "Community 8"
Cohesion: 0.11
Nodes (18): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection, moduleResolution (+10 more)

### Community 9 - "Community 9"
Cohesion: 0.11
Nodes (17): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, moduleResolution, noEmit (+9 more)

### Community 10 - "Community 10"
Cohesion: 0.2
Nodes (16): calcSmartMoneyChannels(), calcStdDev(), checkOnboarding(), checkTradeLimits(), CONFIG, countTodaysTrades(), CSV_HEADERS, fetchCandles() (+8 more)

### Community 11 - "Community 11"
Cohesion: 0.2
Nodes (10): Claude TradingView MCP Trading, Binance, Bitfinex, Bybit, Coinbase Advanced, Gate.io, Kraken, KuCoin (+2 more)

### Community 12 - "Community 12"
Cohesion: 0.2
Nodes (5): TradingView MCP Connection, BitGet, Trading Lab Dashboard, Cloud Execution Strategy, Safety Check Mechanism

### Community 13 - "Community 13"
Cohesion: 0.2
Nodes (9): id, indicators, fvg_detection, ob_detection, pivot_length, structure_detection, name, safety_checks (+1 more)

### Community 14 - "Community 14"
Cohesion: 0.2
Nodes (9): maxTradeSizeUSD, maxTradesPerDay, paperTrading, strategy, name, timeframe, tradeMode, type (+1 more)

### Community 15 - "Community 15"
Cohesion: 0.22
Nodes (8): build, builder, deploy, cronSchedule, restartPolicyMaxRetries, restartPolicyType, startCommand, $schema

### Community 16 - "Community 16"
Cohesion: 0.22
Nodes (8): id, name, settings, maxTradeSizeUSD, maxTradesPerDay, riskPerTradePercent, stopLossPercent, takeProfitPercent

### Community 17 - "Community 17"
Cohesion: 0.22
Nodes (8): id, name, settings, maxTradeSizeUSD, maxTradesPerDay, riskPerTradePercent, stopLossPercent, takeProfitPercent

### Community 18 - "Community 18"
Cohesion: 0.29
Nodes (6): id, indicators, length_, name, safety_checks, type

### Community 19 - "Community 19"
Cohesion: 0.4
Nodes (5): Trading Lab Dashboard Design Spec, Trading Lab Frontend, Real-time Position Monitoring, Strategy Performance Metrics, Trading Lab Dashboard UI

### Community 20 - "Community 20"
Cohesion: 0.4
Nodes (4): strategy, name, timeframe, watchlist

### Community 21 - "Community 21"
Cohesion: 0.4
Nodes (4): strategy, name, timeframe, watchlist

### Community 23 - "Community 23"
Cohesion: 1.0
Nodes (3): Extract Strategy Prompt, Smart Money Breakout Channels Strategy, Smart Money Concepts Strategy

## Knowledge Gaps
- **258 isolated node(s):** `CONFIG`, `CSV_HEADERS`, `CONFIG`, `CSV_HEADERS`, `LogicExecutors` (+253 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What connects `CONFIG`, `CSV_HEADERS`, `CONFIG` to the rest of the system?**
  _263 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._
- **Should `Community 4` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._
- **Should `Community 5` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._
- **Should `Community 6` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._